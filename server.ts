import express from "express";
import path from "path";
import dns from "node:dns";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { DEFAULT_BASE_URLS } from "./src/config";
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildExplainPrompt,
  buildTranslatePrompt,
  parseLLMJson,
} from "./src/services/prompts";
import { callLLM as llmCallLLM, callLLMStream as llmCallLLMStream } from "./src/services/llm";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "10mb" }));

// Helper to get GoogleGenAI instance
function getGeminiClient(customApiKey?: string) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// ---------------------------
// Security: SSRF guard & rate limiting
// ---------------------------

// The API accepts client-supplied `baseUrl` (needed for custom providers). When
// deployed publicly that is an SSRF vector: without checks an attacker could
// point the server at internal hosts (cloud metadata, Redis, …). We therefore
// reject non-http(s) URLs and, in production, URLs resolving to private/
// link-local addresses unless ALLOW_PRIVATE_LLM=1 (for people who deliberately
// proxy through localhost).
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  return false;
}

const privateHostCache = new Map<string, { private: boolean; at: number }>();

async function isPrivateHost(hostname: string): Promise<boolean> {
  const cached = privateHostCache.get(hostname);
  if (cached && Date.now() - cached.at < 60_000) return cached.private;
  // Bound the cache: evict expired entries once it grows large.
  if (privateHostCache.size > 500) {
    const now = Date.now();
    for (const [h, v] of privateHostCache) {
      if (now - v.at >= 60_000) privateHostCache.delete(h);
    }
  }
  const hosts = await dns.promises.lookup(hostname, { all: true });
  const privateHost = hosts.some((h) => isPrivateIp(h.address));
  privateHostCache.set(hostname, { private: privateHost, at: Date.now() });
  return privateHost;
}

async function assertSafeBaseUrl(baseUrl: string | undefined, provider: string): Promise<string> {
  if (!baseUrl) return (DEFAULT_BASE_URLS[provider] || "").replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http:// or https://");
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRIVATE_LLM !== "1") {
    if (await isPrivateHost(url.hostname)) {
      throw new Error(`Base URL "${baseUrl}" resolves to a private/internal address and was blocked`);
    }
  }
  return url.toString().replace(/\/+$/, "");
}

// Simple in-memory rate limiter for the paid endpoints. The server may hold
// its own API keys (env vars); when deployed publicly a limiter stops third
// parties from burning them. Tune with RATE_LIMIT_PER_MIN (0 disables).
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const rateBuckets = new Map<string, number[]>();

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (RATE_LIMIT_PER_MIN <= 0) return next();
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - 60_000;
  // Opportunistically drop expired buckets so the map can't grow unbounded.
  if (rateBuckets.size > 1000) {
    for (const [k, arr] of rateBuckets) {
      if (!arr.some((t) => t > windowStart)) rateBuckets.delete(k);
    }
  }
  const hits = (rateBuckets.get(key) || []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_PER_MIN) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded, please slow down." });
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  next();
}

/**
 * Resolves the server's own API key when the client didn't supply one, so a
 * self-hosted deployment can hold keys server-side (Gemini's env key is also
 * used for the legacy "no key → Gemini" fallback).
 */
function resolveServerApiKey(provider: string, apiKey: string | undefined): string | undefined {
  const geminiPath = provider === "gemini" || (!apiKey && provider !== "custom");
  return geminiPath ? apiKey || process.env.GEMINI_API_KEY : apiKey;
}

// Universal LLM caller supporting Google Gemini & OpenAI-compatible APIs.
// Wraps the shared llm module with the server's SSRF guard and env-key
// fallback; transient 429/503 errors are retried (matching the old SDK path).
async function callLLM({
  provider = "gemini",
  apiKey,
  baseUrl,
  model,
  prompt,
  systemInstruction,
  jsonOutput = false,
}: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  jsonOutput?: boolean;
}): Promise<string> {
  const safeBaseUrl = await assertSafeBaseUrl(baseUrl, provider);
  return llmCallLLM({
    provider,
    apiKey: resolveServerApiKey(provider, apiKey),
    baseUrl: safeBaseUrl,
    model,
    prompt,
    systemInstruction,
    jsonOutput,
    retries: 2,
  });
}

/**
 * Streaming variant of callLLM. Yields text deltas as they arrive (Gemini and
 * OpenAI-compatible providers). Same SSRF guard and env-key fallback as
 * callLLM; no retry, since retrying mid-stream would duplicate text.
 */
async function* callLLMStream({
  provider = "gemini",
  apiKey,
  baseUrl,
  model,
  prompt,
  systemInstruction,
  jsonOutput = false,
  signal,
}: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  jsonOutput?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const safeBaseUrl = await assertSafeBaseUrl(baseUrl, provider);
  yield* llmCallLLMStream({
    provider,
    apiKey: resolveServerApiKey(provider, apiKey),
    baseUrl: safeBaseUrl,
    model,
    prompt,
    systemInstruction,
    jsonOutput,
    signal,
  });
}

// ---------------------------
// Streaming TTS (yields base64 audio chunks as they are generated)
// ---------------------------
async function* callTTSStream({
  engine,
  text,
  voice,
  apiKey,
  providerConfigs,
  signal,
}: {
  engine: string;
  text: string;
  voice?: string;
  apiKey?: string;
  providerConfigs?: any;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  // MiMo-V2.5-TTS: OpenAI-compatible chat completions with stream:true and
  // pcm16 audio — each SSE event carries a base64 PCM16 chunk at 24kHz.
  if (engine === "mimo") {
    const mimoConfig = providerConfigs?.mimo || {};
    const key = apiKey || mimoConfig.apiKey || process.env.MIMO_API_KEY;
    if (!key) {
      throw new Error("MiMo API Key is required for MiMo TTS. Please configure it in Settings.");
    }
    const res = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mimo-v2.5-tts",
        messages: [{ role: "assistant", content: text }],
        audio: { format: "pcm16", voice: voice || "冰糖" },
        stream: true,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`MiMo TTS Error (${res.status}): ${await res.text()}`);
    if (!res.body) throw new Error("MiMo TTS returned no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const audio = parsed?.choices?.[0]?.delta?.audio;
          if (audio?.data) yield audio.data;
        } catch {
          // ignore partial lines
        }
      }
    }
    return;
  }

  // Gemini TTS: generateContentStream with AUDIO modality — each chunk's
  // inlineData.data is a base64 slice of the 24kHz PCM audio.
  if (engine === "gemini") {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Missing GEMINI_API_KEY");
    const ai = getGeminiClient(key);
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || "Kore" },
          },
        },
      },
    });
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const part = chunk?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (part?.inlineData?.data) yield part.inlineData.data;
    }
    return;
  }

  throw new Error(`Engine ${engine} does not support streaming TTS`);
}

// ---------------------------
// 0. Auto Fetch Models Endpoint
// ---------------------------
app.post("/api/models", rateLimit, async (req, res) => {
  try {
    const { provider = "gemini", apiKey, baseUrl: customUrl } = req.body;
    const baseUrl = await assertSafeBaseUrl(customUrl, provider);

    // Gemini: fetch the live list when a key is available (user key or server env key).
    if (provider === "gemini" && (apiKey || process.env.GEMINI_API_KEY)) {
      try {
        const key = apiKey || process.env.GEMINI_API_KEY;
        const response = await fetch(`${baseUrl}/v1beta/models?pageSize=1000`, {
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        });
        if (response.ok) {
          const data: any = await response.json();
          const modelIds = (data?.models || [])
            .map((m: any) => (typeof m === "string" ? m : String(m.name || "").replace(/^models\//, "")))
            .filter((n: string) => n && /^gemini/i.test(n));
          if (modelIds.length > 0) {
            return res.json({ models: modelIds, source: "live" });
          }
        }
      } catch (err: any) {
        console.warn("Could not fetch live Gemini model list:", err.message);
      }
    }

    // No usable key for this provider: cannot verify — return an empty list.
    if (provider === "gemini" || (!apiKey && provider !== "custom")) {
      return res.json({ models: [], source: "default" });
    }

    try {
      const endpoint = `${baseUrl}/models`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch(endpoint, { method: "GET", headers });
      if (response.ok) {
        const data = await response.json();
        let rawList: any[] = [];
        if (Array.isArray(data)) rawList = data;
        else if (Array.isArray(data?.data)) rawList = data.data;
        else if (Array.isArray(data?.models)) rawList = data.models;

        const modelIds = rawList
          .map((m: any) => typeof m === "string" ? m : m.id || m.name || m.model)
          .filter(Boolean);

        if (modelIds.length > 0) {
          return res.json({ models: modelIds, source: "live" });
        }
      }
    } catch (err: any) {
      console.warn(`Could not fetch live model list for ${provider}:`, err.message);
    }

    // Could not fetch a live list — return an empty list.
    res.json({ models: [], source: "default" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch models" });
  }
});

// ---------------------------
// 1. Translation Endpoint
// ---------------------------
app.post("/api/translate", rateLimit, async (req, res) => {
  try {
    const {
      text,
      sourceLang = "auto",
      targetLang = "zh-CN",
      provider = "gemini",
      apiKey,
      baseUrl,
      model,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    try {
      const rawResponse = await callLLM({
        provider,
        apiKey,
        baseUrl,
        model,
        prompt: buildTranslatePrompt(text, sourceLang, targetLang),
        systemInstruction: TRANSLATE_SYSTEM_PROMPT,
        jsonOutput: true,
      });

      const parsed = parseLLMJson(rawResponse);
      const result = {
        translation: parsed.translation || "Translation unavailable.",
        detectedLang: parsed.detectedLang || "Auto",
        tokens: parsed.tokens || [],
      };

      res.json(result);
    } catch (err: any) {
      console.error(`${provider} translation error:`, err);
      res.status(500).json({ error: err.message || "Translation request failed" });
    }
  } catch (err: any) {
    console.error("Translation server error:", err);
    res.status(500).json({ error: err.message || "Translation failed" });
  }
});

// ---------------------------
// 1b. Translation Endpoint (Server-Sent Events streaming)
// ---------------------------
app.post("/api/translate/stream", rateLimit, async (req, res) => {
  const {
    text,
    sourceLang = "auto",
    targetLang = "zh-CN",
    provider = "gemini",
    apiKey,
    baseUrl,
    model,
  } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (payload: any) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  // Stop the upstream LLM call as soon as the client disconnects so we don't
  // keep burning tokens on a stream nobody is listening to.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    let raw = "";
    const stream = callLLMStream({
      provider,
      apiKey,
      baseUrl,
      model,
      prompt: buildTranslatePrompt(text, sourceLang, targetLang),
      systemInstruction: TRANSLATE_SYSTEM_PROMPT,
      jsonOutput: true,
      signal: abort.signal,
    });

    for await (const delta of stream) {
      raw += delta;
      send({ delta });
    }

    const parsed = parseLLMJson(raw);
    send({
      done: true,
      result: {
        translation: parsed.translation || "Translation unavailable.",
        detectedLang: parsed.detectedLang || "Auto",
      },
    });
    res.end();
  } catch (err: any) {
    console.error(`${provider} translation stream error:`, err);
    send({ error: err.message || "Translation stream failed" });
    res.end();
  }
});

// ---------------------------
// 2. Word Contextual Analysis Endpoint
// ---------------------------
app.post("/api/explain-word", rateLimit, async (req, res) => {
  const {
    sentence,
    selectedWord,
    targetLang = "zh-CN",
    provider = "gemini",
    apiKey,
    baseUrl,
    model,
  } = req.body;

  if (!selectedWord || !selectedWord.trim()) {
    return res.status(400).json({ error: "Selected word is required" });
  }

  try {
    const rawResponse = await callLLM({
      provider,
      apiKey,
      baseUrl,
      model,
      prompt: buildExplainPrompt(selectedWord, sentence, targetLang),
      systemInstruction: EXPLAIN_SYSTEM_PROMPT,
      jsonOutput: true,
    });

    const parsed = parseLLMJson(rawResponse);
    return res.json({
      word: parsed.word || selectedWord,
      phonetic: parsed.phonetic || "",
      pos: parsed.pos || "Word",
      cefrLevel: parsed.cefrLevel || "",
      literalMeaning: parsed.literalMeaning || selectedWord,
      contextualMeaning: parsed.contextualMeaning || selectedWord,
      contextExplanation: parsed.contextExplanation || `Contextual meaning of "${selectedWord}" in sentence: "${sentence}".`,
      rootOrLemma: parsed.rootOrLemma || "",
      collocations: parsed.collocations || [],
      antonyms: parsed.antonyms || [],
      synonymsInContext: parsed.synonymsInContext || [],
      examples: parsed.examples || [],
    });
  } catch (err: any) {
    console.error("Word explanation error:", err);
    return res.json({
      word: selectedWord,
      phonetic: "",
      pos: "Word",
      literalMeaning: selectedWord,
      contextualMeaning: selectedWord,
      contextExplanation: `Contextual analysis for "${selectedWord}".`,
      examples: [],
    });
  }
});

// ---------------------------
// 3. TTS (Text-To-Speech) Endpoint
// ---------------------------
app.post("/api/tts", rateLimit, async (req, res) => {
  try {
    const {
      text,
      lang = "en",
      engine = "gemini",
      voice,
      apiKey: userKey,
      baseUrl: userBaseUrl,
      providerConfigs,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const cleanText = text.trim();

    // 1. Google Gemini Neural TTS
    if (engine === "gemini") {
      const geminiConfig = providerConfigs?.gemini || {};
      const key = userKey || geminiConfig.apiKey;
      const ai = getGeminiClient(key);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || "Kore" },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        return res.status(500).json({ error: "No audio generated from Gemini TTS model" });
      }

      return res.json({
        audioBase64: base64Audio,
        mimeType: "audio/pcm;rate=24000",
        sampleRate: 24000,
      });
    }

    // 2. Microsoft Edge Neural TTS (Free High-Quality Audio Stream)
    if (engine === "edge") {
      const cleanLang = lang.split("-")[0] || "en";
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText.slice(0, 300))}&tl=${cleanLang}&client=tw-ob`;

      const audioRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!audioRes.ok) {
        throw new Error(`Edge/Google TTS request failed with status ${audioRes.status}`);
      }

      const arrayBuffer = await audioRes.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      return res.json({
        audioBase64: base64Audio,
        mimeType: "audio/mp3",
      });
    }

    // 3. OpenAI / Compatible Audio Speech API
    if (engine === "openai") {
      const openaiConfig = providerConfigs?.openai || {};
      const key = userKey || openaiConfig.apiKey || process.env.OPENAI_API_KEY;
      const baseUrl = await assertSafeBaseUrl(userBaseUrl || openaiConfig.baseUrl, "openai");

      if (!key) {
        return res.status(400).json({ error: "OpenAI API Key is required for OpenAI TTS. Please configure it in Settings." });
      }

      const openaiRes = await fetch(`${baseUrl.replace(/\/+$/, "")}/audio/speech`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: cleanText,
          voice: voice || "alloy",
          response_format: "mp3",
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        throw new Error(`OpenAI TTS Error (${openaiRes.status}): ${errText}`);
      }

      const arrayBuffer = await openaiRes.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      return res.json({
        audioBase64: base64Audio,
        mimeType: "audio/mp3",
      });
    }

    // 4. MiniMax Speech Synthesis API (Supports T2A v2 / speech-2.8 / speech-02)
    if (engine === "minimax") {
      const mmConfig = providerConfigs?.minimax || {};
      const key = userKey || mmConfig.apiKey || process.env.MINIMAX_API_KEY;

      if (!key) {
        return res.status(400).json({ error: "MiniMax API Key is required for MiniMax TTS. Please configure it in Settings." });
      }

      const [modelFromVoice, realVoice] = (voice || "").includes(":") ? (voice || "").split(":") : [null, voice];
      const model = modelFromVoice || mmConfig.model || "speech-2.8-hd";
      const voiceId = realVoice || "female-shaonv";

      const mmRes = await fetch("https://api.minimax.chat/v1/t2a_v2", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          text: cleanText,
          stream: false,
          voice_setting: {
            voice_id: voiceId,
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
          },
        }),
      });

      if (!mmRes.ok) {
        const errText = await mmRes.text();
        throw new Error(`MiniMax TTS Error (${mmRes.status}): ${errText}`);
      }

      const mmData: any = await mmRes.json();
      if (mmData?.data?.audio) {
        const hex = mmData.data.audio;
        const base64Audio = Buffer.from(hex, "hex").toString("base64");
        return res.json({ audioBase64: base64Audio, mimeType: "audio/mp3" });
      }
      if (mmData?.audio) {
        return res.json({ audioBase64: mmData.audio, mimeType: "audio/mp3" });
      }
      throw new Error("No audio returned from MiniMax TTS");
    }

    // 5. Aliyun DashScope (Qwen / CosyVoice v3.5 / v2.0)
    if (engine === "qwen") {
      const qwenConfig = providerConfigs?.qwen || {};
      const key = userKey || qwenConfig.apiKey || process.env.DASHSCOPE_API_KEY;

      if (!key) {
        return res.status(400).json({ error: "DashScope API Key is required for Aliyun TTS. Please configure it in Settings." });
      }

      const [modelFromVoice, realVoice] = (voice || "").includes(":") ? (voice || "").split(":") : [null, voice];
      const model = modelFromVoice || "cosyvoice-v3.5-plus";
      const voiceId = realVoice || "longxiaochun";

      const qwenRes = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/text-to-speech/speech-synthesis", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model,
          input: { text: cleanText },
          parameters: { voice: voiceId },
        }),
      });

      if (!qwenRes.ok) {
        const errText = await qwenRes.text();
        throw new Error(`Aliyun CosyVoice Error (${qwenRes.status}): ${errText}`);
      }

      const qwenData: any = await qwenRes.json();
      if (qwenData?.output?.audio_url) {
        const audioRes = await fetch(qwenData.output.audio_url);
        const ab = await audioRes.arrayBuffer();
        return res.json({ audioBase64: Buffer.from(ab).toString("base64"), mimeType: "audio/mp3" });
      }
      throw new Error("No audio URL returned from Aliyun CosyVoice");
    }

    // 6. Volcengine / Doubao Speech Synthesis
    if (engine === "doubao") {
      const dbConfig = providerConfigs?.doubao || {};
      const key = userKey || dbConfig.apiKey || process.env.DOUBAO_API_KEY;

      if (!key) {
        return res.status(400).json({ error: "Doubao API Key is required for Doubao TTS." });
      }

      const [modelFromVoice, realVoice] = (voice || "").includes(":") ? (voice || "").split(":") : [null, voice];
      const voiceType = realVoice || "zh_female_shuangkuai";

      const dbRes = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app: { appid: "default", token: key, cluster: "volcano_tts" },
          user: { uid: "freetranslate_user" },
          audio: { voice_type: voiceType, encoding: "mp3", speed_ratio: 1.0 },
          request: { reqid: String(Date.now()), text: cleanText, operation: "query" },
        }),
      });

      if (!dbRes.ok) {
        const errText = await dbRes.text();
        throw new Error(`Doubao TTS Error (${dbRes.status}): ${errText}`);
      }

      const dbData: any = await dbRes.json();
      if (dbData?.data) {
        return res.json({ audioBase64: dbData.data, mimeType: "audio/mp3" });
      }
      throw new Error("No audio returned from Doubao TTS");
    }

    // 7. Fish Audio (Fish Speech 1.5)
    if (engine === "fishaudio") {
      const fishConfig = providerConfigs?.fishaudio || {};
      const key = userKey || fishConfig.apiKey || req.body.ttsApiKey || process.env.FISH_AUDIO_API_KEY;

      if (!key) {
        return res.status(400).json({ error: "Fish Audio API Key is required for Fish Audio TTS. Please configure it in Settings." });
      }

      const [modelFromVoice, realVoice] = (voice || "").includes(":") ? (voice || "").split(":") : [null, voice];
      const referenceId = realVoice || "preset-female";

      const fishRes = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleanText,
          reference_id: referenceId,
          format: "mp3",
        }),
      });

      if (!fishRes.ok) {
        const errText = await fishRes.text();
        throw new Error(`Fish Audio TTS Error (${fishRes.status}): ${errText}`);
      }

      const ab = await fishRes.arrayBuffer();
      return res.json({ audioBase64: Buffer.from(ab).toString("base64"), mimeType: "audio/mp3" });
    }

    // 8. Xiaomi MiMo-V2.5 TTS (OpenAI-compatible chat completions with audio output)
    if (engine === "mimo") {
      const mimoConfig = providerConfigs?.mimo || {};
      const key = userKey || mimoConfig.apiKey || process.env.MIMO_API_KEY;

      if (!key) {
        return res.status(400).json({ error: "MiMo API Key is required for MiMo TTS. Please configure it in Settings." });
      }

      // Text to synthesize goes in the assistant message; an optional user
      // message can steer style. See https://mimo.mi.com/docs (MiMo-V2.5-TTS).
      const mimoRes = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mimo-v2.5-tts",
          messages: [{ role: "assistant", content: cleanText }],
          audio: {
            format: "wav",
            voice: voice || "冰糖",
          },
        }),
      });

      if (!mimoRes.ok) {
        const errText = await mimoRes.text();
        throw new Error(`MiMo TTS Error (${mimoRes.status}): ${errText}`);
      }

      const mimoData: any = await mimoRes.json();
      const base64Audio = mimoData?.choices?.[0]?.message?.audio?.data;
      if (!base64Audio) {
        throw new Error("No audio returned from MiMo TTS");
      }
      return res.json({ audioBase64: base64Audio, mimeType: "audio/wav" });
    }

    return res.status(400).json({ error: `Unsupported TTS engine: ${engine}` });
  } catch (err: any) {
    console.error("TTS API error:", err);
    res.status(500).json({ error: err.message || "TTS generation failed" });
  }
});

// ---------------------------
// 3b. TTS Endpoint (Server-Sent Events streaming — MiMo / Gemini PCM chunks)
// ---------------------------
app.post("/api/tts/stream", rateLimit, async (req, res) => {
  const { text, engine = "gemini", voice, apiKey, providerConfigs } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (payload: any) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    const stream = callTTSStream({ engine, text, voice, apiKey, providerConfigs, signal: abort.signal });
    for await (const delta of stream) {
      if (abort.signal.aborted) break;
      send({ delta });
    }
    send({ done: true, sampleRate: 24000 });
    res.end();
  } catch (err: any) {
    console.error(`${engine} TTS stream error:`, err.message);
    send({ error: err.message || "TTS stream failed" });
    res.end();
  }
});

// ---------------------------
// 4. "Ask AI" Webpage Assistant Endpoint
// ---------------------------
app.post("/api/ask-ai", rateLimit, async (req, res) => {
  try {
    const {
      prompt,
      selectedText,
      pageContext,
      mode = "explain",
      provider = "gemini",
      apiKey,
      baseUrl,
      model,
    } = req.body;

    const systemPrompt = `You are FreeTranslate AI, an intelligent contextual translation and reading assistant.
Provide clear, visually formatted responses in Markdown format.`;

    const userPrompt = `Mode: ${mode}
Selected Text: "${selectedText || ""}"
Question / Task: "${prompt || "Please explain this selected text in detail."}"
Page Context: "${pageContext || ""}"`;

    const answer = await callLLM({
      provider,
      apiKey,
      baseUrl,
      model,
      prompt: userPrompt,
      systemInstruction: systemPrompt,
      jsonOutput: false,
    });

    res.json({ answer: answer || "No response generated." });
  } catch (err: any) {
    console.error("Ask AI error:", err);
    res.status(500).json({ error: err.message || "Ask AI request failed" });
  }
});

// ---------------------------
// Vite Middleware & Start Server
// ---------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Note: "vite build --outDir dist-web" writes the web app here (NOT dist,
    // which is the Chrome-extension build output).
    const distPath = path.join(process.cwd(), "dist-web");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
