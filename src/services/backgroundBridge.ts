import { AppSettings, WordExplanation } from '../types';
import { DEFAULT_BASE_URLS, DEFAULT_SETTINGS, mergeKnownFreeModels, parseSavedSettings } from '../config';
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildExplainPrompt,
  buildTranslatePrompt,
  parseLLMJson,
} from './prompts';
import { BRIDGE_PORT_NAME, SETTINGS_STORAGE_KEY } from './bridge';
import { callLLM, callLLMStream } from './llm';

// ---------------------------
// Settings (keys live only here, in the extension's own context)
// ---------------------------

async function getBridgeSettings(): Promise<AppSettings> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    if (result[SETTINGS_STORAGE_KEY]) {
      return parseSavedSettings(result[SETTINGS_STORAGE_KEY]);
    }
  } catch (e) {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

function resolveProviderConfig(settings: AppSettings, provider: string) {
  const cfg = (settings.providerConfigs as any)?.[provider] || {};
  return {
    apiKey: cfg.apiKey || (provider === 'gemini' ? settings.geminiApiKey : ''),
    baseUrl: (cfg.baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, ''),
    model: cfg.model || '',
  };
}

// ---------------------------
// TTS executors (keys from storage; mirrored from server.ts behavior)
// ---------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytesToBase64(bytes);
}

async function runTts({
  text,
  lang,
  engine,
  voice,
  settings,
}: {
  text: string;
  lang: string;
  engine: string;
  voice?: string;
  settings: AppSettings;
}): Promise<{ audioBase64: string; mimeType: string; sampleRate?: number }> {
  const cfg = resolveProviderConfig(settings, engine);

  // 1. Gemini neural TTS (REST)
  if (engine === 'gemini') {
    const url = `${cfg.baseUrl || DEFAULT_BASE_URLS.gemini}/v1beta/models/gemini-3.1-flash-tts-preview:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini TTS Error (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error('No audio generated from Gemini TTS model');
    return { audioBase64: base64Audio, mimeType: 'audio/pcm;rate=24000', sampleRate: 24000 };
  }

  // 2. OpenAI / compatible audio speech
  if (engine === 'openai') {
    if (!cfg.apiKey) throw new Error('OpenAI API Key is required for OpenAI TTS. Please configure it in Settings.');
    const res = await fetch(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: voice || 'alloy', response_format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS Error (${res.status}): ${await res.text()}`);
    const ab = await res.arrayBuffer();
    return { audioBase64: bytesToBase64(new Uint8Array(ab)), mimeType: 'audio/mp3' };
  }

  // 3. MiniMax T2A
  if (engine === 'minimax') {
    if (!cfg.apiKey) throw new Error('MiniMax API Key is required for MiniMax TTS. Please configure it in Settings.');
    const [modelFromVoice, realVoice] = (voice || '').includes(':') ? (voice || '').split(':') : [null, voice];
    const res = await fetch('https://api.minimax.chat/v1/t2a_v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelFromVoice || cfg.model || 'speech-2.8-hd',
        text,
        stream: false,
        voice_setting: { voice_id: realVoice || 'female-shaonv', speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
      }),
    });
    if (!res.ok) throw new Error(`MiniMax TTS Error (${res.status}): ${await res.text()}`);
    const mmData: any = await res.json();
    if (mmData?.data?.audio) return { audioBase64: hexToBase64(mmData.data.audio), mimeType: 'audio/mp3' };
    if (mmData?.audio) return { audioBase64: mmData.audio, mimeType: 'audio/mp3' };
    throw new Error('No audio returned from MiniMax TTS');
  }

  // 4. Aliyun DashScope (Qwen / CosyVoice)
  if (engine === 'qwen') {
    if (!cfg.apiKey) throw new Error('DashScope API Key is required for Aliyun TTS. Please configure it in Settings.');
    const [modelFromVoice, realVoice] = (voice || '').includes(':') ? (voice || '').split(':') : [null, voice];
    const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/text-to-speech/speech-synthesis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: modelFromVoice || 'cosyvoice-v3.5-plus',
        input: { text },
        parameters: { voice: realVoice || 'longxiaochun' },
      }),
    });
    if (!res.ok) throw new Error(`Aliyun CosyVoice Error (${res.status}): ${await res.text()}`);
    const qwenData: any = await res.json();
    if (qwenData?.output?.audio_url) {
      const audioRes = await fetch(qwenData.output.audio_url);
      const ab = await audioRes.arrayBuffer();
      return { audioBase64: bytesToBase64(new Uint8Array(ab)), mimeType: 'audio/mp3' };
    }
    throw new Error('No audio URL returned from Aliyun CosyVoice');
  }

  // 5. Volcengine / Doubao
  if (engine === 'doubao') {
    if (!cfg.apiKey) throw new Error('Doubao API Key is required for Doubao TTS.');
    const [_, realVoice] = (voice || '').includes(':') ? (voice || '').split(':') : [null, voice];
    const res = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: { appid: 'default', token: cfg.apiKey, cluster: 'volcano_tts' },
        user: { uid: 'freetranslate_user' },
        audio: { voice_type: realVoice || 'zh_female_shuangkuai', encoding: 'mp3', speed_ratio: 1.0 },
        request: { reqid: String(Date.now()), text, operation: 'query' },
      }),
    });
    if (!res.ok) throw new Error(`Doubao TTS Error (${res.status}): ${await res.text()}`);
    const dbData: any = await res.json();
    if (dbData?.data) return { audioBase64: dbData.data, mimeType: 'audio/mp3' };
    throw new Error('No audio returned from Doubao TTS');
  }

  // 6. Fish Audio
  if (engine === 'fishaudio') {
    if (!cfg.apiKey) throw new Error('Fish Audio API Key is required for Fish Audio TTS. Please configure it in Settings.');
    const [_, realVoice] = (voice || '').includes(':') ? (voice || '').split(':') : [null, voice];
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, reference_id: realVoice || 'preset-female', format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`Fish Audio TTS Error (${res.status}): ${await res.text()}`);
    const ab = await res.arrayBuffer();
    return { audioBase64: bytesToBase64(new Uint8Array(ab)), mimeType: 'audio/mp3' };
  }

  // 7. Xiaomi MiMo-V2.5 TTS (OpenAI-compatible chat completions with audio output)
  if (engine === 'mimo') {
    if (!cfg.apiKey) throw new Error('MiMo API Key is required for MiMo TTS. Please configure it in Settings.');
    const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mimo-v2.5-tts',
        messages: [{ role: 'assistant', content: text }],
        audio: { format: 'wav', voice: voice || '冰糖' },
      }),
    });
    if (!res.ok) throw new Error(`MiMo TTS Error (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    const base64Audio = data?.choices?.[0]?.message?.audio?.data;
    if (!base64Audio) throw new Error('No audio returned from MiMo TTS');
    return { audioBase64: base64Audio, mimeType: 'audio/wav' };
  }

  throw new Error(`Unsupported TTS engine: ${engine}`);
}

// Streaming TTS — yields base64 PCM16 24kHz chunks (pure fetch, SW-friendly).
async function* callTTSStreamRaw({
  engine,
  text,
  voice,
  settings,
}: {
  engine: string;
  text: string;
  voice?: string;
  settings: AppSettings;
}): AsyncGenerator<string> {
  if (engine === 'mimo') {
    const cfg = resolveProviderConfig(settings, 'mimo');
    if (!cfg.apiKey) throw new Error('MiMo API Key is required for MiMo TTS. Please configure it in Settings.');
    const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mimo-v2.5-tts',
        messages: [{ role: 'assistant', content: text }],
        audio: { format: 'pcm16', voice: voice || '冰糖' },
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(`MiMo TTS Error (${res.status}): ${await res.text()}`);
    if (!res.body) throw new Error('MiMo TTS returned no stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
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

  if (engine === 'gemini') {
    const cfg = resolveProviderConfig(settings, 'gemini');
    if (!cfg.apiKey) throw new Error('Missing GEMINI_API_KEY');
    const url = `${cfg.baseUrl || DEFAULT_BASE_URLS.gemini}/v1beta/models/gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini TTS Error (${res.status}): ${await res.text()}`);
    if (!res.body) throw new Error('Gemini TTS returned no stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          const part = parsed?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
          if (part?.inlineData?.data) yield part.inlineData.data;
        } catch {
          // ignore partial lines
        }
      }
    }
    return;
  }

  throw new Error(`Engine ${engine} does not support streaming TTS`);
}

// ---------------------------
// Page translation (batched, numbered segments)
// ---------------------------

const PAGE_BATCH_MAX_SEGS = 8;
const PAGE_BATCH_MAX_CHARS = 2400;

/**
 * Translates an array of paragraphs in batches. Each batch asks the model for
 * numbered translations (`1: ...`), and the output is parsed back into an
 * array aligned with the input. A segment the model skipped stays an empty
 * string so the content script can keep the original text for it.
 */
async function translatePageParagraphs({
  paragraphs,
  targetLang,
  provider,
  apiKey,
  baseUrl,
  model,
}: {
  paragraphs: string[];
  targetLang: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<string[]> {
  const out: string[] = new Array(paragraphs.length).fill('');

  // Group consecutive paragraphs into batches under the char/segment budget.
  const batches: number[][] = [];
  let current: number[] = [];
  let currentChars = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const seg = paragraphs[i];
    const segChars = seg.length + 8; // room for the "N: " prefix
    if (
      current.length > 0 &&
      (current.length >= PAGE_BATCH_MAX_SEGS || currentChars + segChars > PAGE_BATCH_MAX_CHARS)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(i);
    currentChars += segChars;
  }
  if (current.length > 0) batches.push(current);

  for (const batch of batches) {
    const parts = batch.map((idx, j) => `${j + 1}: ${paragraphs[idx]}`).join('\n');
    const prompt = `Translate each numbered segment into ${targetLang}. Return ONLY the numbered translations, one per line, in the same order and with the same numbers. Never merge, skip, or reorder segments. Preserve formatting like line breaks inside a segment as-is.

${parts}`;
    const raw = await callLLM({
      provider,
      apiKey,
      baseUrl,
      model,
      prompt,
      retries: 1,
    });

    // Parse numbered lines, tolerating "1: ...", "1. ...", "[1] ...", "(1) ...",
    // and even "1 ..." (no separator). Continuation lines that don't start
    // with a number are appended to the previous segment.
    const parsed = new Array<string>(batch.length).fill('');
    let lastIdx = -1;
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*[\[\(]?(\d+)[\]\)]?\s*[:.)、-]?\s*(.*)$/);
      if (m && line.trim().length > 0) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && idx < batch.length) {
          lastIdx = idx;
          parsed[idx] = m[2];
        }
      } else if (lastIdx >= 0 && parsed[lastIdx]) {
        parsed[lastIdx] += '\n' + line;
      }
    }
    for (let j = 0; j < batch.length; j++) {
      if (parsed[j]) out[batch[j]] = parsed[j].trim();
    }
  }
  return out;
}

// ---------------------------
// Models listing
// ---------------------------

async function fetchModels({ provider, baseUrl, apiKey, settings }: { provider: string; baseUrl?: string; apiKey?: string; settings: AppSettings }): Promise<{ models: string[]; source: 'live' | 'default' }> {
  const cfg = resolveProviderConfig(settings, provider);
  const effectiveKey = apiKey || cfg.apiKey;
  const effectiveBaseUrl = (baseUrl || cfg.baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '');
  // When the caller explicitly passes a key (typed in the settings form but not
  // yet saved), surface request failures instead of silently falling back to
  // the preset list — otherwise a wrong key looks like "no key configured".
  const explicitKey = Boolean(apiKey);

  // Gemini: fetch the live list when a key is available.
  if (provider === 'gemini' && effectiveKey) {
    try {
      const endpoint = `${effectiveBaseUrl}/v1beta/models?pageSize=1000`;
      const res = await fetch(endpoint, { headers: { 'x-goog-api-key': effectiveKey, 'Content-Type': 'application/json' } });
      if (res.ok) {
        const data: any = await res.json();
        const ids = (data?.models || [])
          .map((m: any) => (typeof m === 'string' ? m : String(m.name || '').replace(/^models\//, '')))
          .filter((n: string) => n && /^gemini/i.test(n));
        if (ids.length > 0) return { models: ids, source: 'live' };
      } else if (explicitKey) {
        throw new Error(`Gemini models API error (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e: any) {
      if (explicitKey) throw e;
      // transient failure without a typed key → fall through to defaults
    }
  }

  if (provider === 'gemini' || (!effectiveKey && provider !== 'custom')) {
    return { models: [], source: 'default' };
  }
  try {
    const endpoint = `${effectiveBaseUrl}/models`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (effectiveKey) headers['Authorization'] = `Bearer ${effectiveKey}`;
    const res = await fetch(endpoint, { method: 'GET', headers });
    if (res.ok) {
      const data: any = await res.json();
      const rawList: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const ids = rawList.map((m: any) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean);
      if (ids.length > 0) return { models: mergeKnownFreeModels(provider as any, ids), source: 'live' };
    } else if (explicitKey) {
      throw new Error(`${provider} models API error (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e: any) {
    if (explicitKey) throw e;
    // fall through to defaults
  }
  return { models: [], source: 'default' };
}

// ---------------------------
// Port handler
// ---------------------------

export function handleBridgePort(port: chrome.runtime.Port) {
  if (port.name !== BRIDGE_PORT_NAME) return;

  // Abort controllers for in-flight streaming requests, keyed by request id.
  // The client posts a `cancel` message when its AbortSignal fires, and we
  // abort the matching upstream fetch so aborted streams stop burning tokens.
  const inFlight = new Map<number, AbortController>();
  port.onDisconnect.addListener(() => {
    for (const ctrl of inFlight.values()) ctrl.abort();
    inFlight.clear();
  });

  port.onMessage.addListener(async (msg: any) => {
    if (msg?.type !== 'request' || typeof msg.id !== 'number') return;
    const reply = (type: 'delta' | 'done' | 'error', extra: Record<string, any> = {}) => {
      try {
        port.postMessage({ id: msg.id, type, ...extra });
      } catch {
        // port closed
      }
    };

    if (msg.kind === 'cancel') {
      inFlight.get(msg.id)?.abort();
      inFlight.delete(msg.id);
      return;
    }

    try {
      const settings = await getBridgeSettings();

      if (msg.kind === 'translate') {
        const { text, sourceLang, targetLang, provider, model, baseUrl } = msg.payload || {};
        if (!text || !text.trim()) throw new Error('Text is required');
        const cfg = resolveProviderConfig(settings, provider);
        console.log('[bg:translate]', { provider, model: model || cfg.model, baseUrl: baseUrl || cfg.baseUrl, hasKey: !!cfg.apiKey, textLen: text.length });
        const ctrl = new AbortController();
        inFlight.set(msg.id, ctrl);
        try {
          let raw = '';
          for await (const delta of callLLMStream({
            provider,
            apiKey: cfg.apiKey,
            baseUrl: baseUrl || cfg.baseUrl,
            model: model || cfg.model,
            prompt: buildTranslatePrompt(text, sourceLang, targetLang),
            systemInstruction: TRANSLATE_SYSTEM_PROMPT,
            jsonOutput: true,
            signal: ctrl.signal,
          })) {
            raw += delta;
            reply('delta', { text: delta });
          }
          if (ctrl.signal.aborted) return; // client cancelled — no reply
          const parsed = parseLLMJson(raw);
          console.log('[bg:translate] rawLen', raw.length, 'rawHead', raw.slice(0, 200));
          if (!raw.trim() || !parsed.translation) {
            // A silent empty response usually means the model name doesn't exist
            // (the provider returns 200 with an empty stream) — surface it
            // instead of showing a confusing "Translation unavailable.".
            reply('error', {
              error: '模型未返回有效内容，可能模型名不存在。请在设置中重新「自动获取可用模型」并选择一个模型。',
            });
            return;
          }
          reply('done', {
            result: {
              translation: parsed.translation,
              detectedLang: parsed.detectedLang || 'Auto',
            },
          });
        } catch (err: any) {
          if (ctrl.signal.aborted) return; // cancelled — no error reply
          throw err;
        } finally {
          inFlight.delete(msg.id);
        }
        return;
      }

      if (msg.kind === 'explain') {
        const { sentence, selectedWord, targetLang, provider, model, baseUrl } = msg.payload || {};
        if (!selectedWord || !selectedWord.trim()) throw new Error('Selected word is required');
        const cfg = resolveProviderConfig(settings, provider);
        const raw = await callLLM({
          provider,
          apiKey: cfg.apiKey,
          baseUrl: baseUrl || cfg.baseUrl,
          model: model || cfg.model,
          prompt: buildExplainPrompt(selectedWord, sentence, targetLang),
          systemInstruction: EXPLAIN_SYSTEM_PROMPT,
          jsonOutput: true,
        });
        const parsed = parseLLMJson(raw);
        const result: WordExplanation = {
          word: parsed.word || selectedWord,
          phonetic: parsed.phonetic || '',
          pos: parsed.pos || '',
          cefrLevel: parsed.cefrLevel || '',
          literalMeaning: parsed.literalMeaning || '',
          contextualMeaning: parsed.contextualMeaning || '',
          contextExplanation: parsed.contextExplanation || '',
          rootOrLemma: parsed.rootOrLemma || '',
          collocations: parsed.collocations || [],
          antonyms: parsed.antonyms || [],
          synonymsInContext: parsed.synonymsInContext || [],
          examples: parsed.examples || [],
        };
        reply('done', { result });
        return;
      }

      if (msg.kind === 'tts') {
        const { text, lang, engine, voice, rate } = msg.payload || {};
        if (!text || !text.trim()) throw new Error('Text is required');
        const result = await runTts({ text, lang: lang || 'en', engine, voice, settings });
        reply('done', { result });
        return;
      }

      if (msg.kind === 'tts-stream') {
        const { text, lang, engine, voice, rate } = msg.payload || {};
        if (!text || !text.trim()) throw new Error('Text is required');
        for await (const delta of callTTSStreamRaw({ engine, text, voice, settings })) {
          reply('delta', { text: delta });
        }
        reply('done', { result: { sampleRate: 24000 } });
        return;
      }

      if (msg.kind === 'page-translate') {
        const { paragraphs, targetLang, provider, model, baseUrl } = msg.payload || {};
        if (!Array.isArray(paragraphs) || paragraphs.length === 0) throw new Error('paragraphs are required');
        const cfg = resolveProviderConfig(settings, provider);
        const translations = await translatePageParagraphs({
          paragraphs,
          targetLang: targetLang || 'zh-CN',
          provider,
          apiKey: cfg.apiKey,
          baseUrl: baseUrl || cfg.baseUrl,
          model: model || cfg.model,
        });
        reply('done', { result: { translations } });
        return;
      }

      if (msg.kind === 'models') {
        const { provider, baseUrl, apiKey } = msg.payload || {};
        const { models, source } = await fetchModels({ provider: provider || 'gemini', baseUrl, apiKey, settings });
        reply('done', { result: { models, source } });
        return;
      }

      throw new Error(`Unknown bridge request kind: ${msg.kind}`);
    } catch (err: any) {
      reply('error', { error: err?.message || 'Bridge request failed' });
    }
  });
}
