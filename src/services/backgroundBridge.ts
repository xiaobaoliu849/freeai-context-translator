import { AppSettings, WordExplanation } from '../types';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, DEFAULT_SETTINGS, parseSavedSettings } from '../config';
import {
  EXPLAIN_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  buildExplainPrompt,
  buildTranslatePrompt,
  parseLLMJson,
} from './prompts';
import { BRIDGE_PORT_NAME, SETTINGS_STORAGE_KEY } from './bridge';

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
    model: cfg.model || DEFAULT_MODELS[provider]?.[0] || '',
  };
}

// ---------------------------
// Raw-fetch LLM streaming (works in the service worker, no SDK needed)
// ---------------------------

/**
 * Yields text deltas from the LLM provider. Gemini uses the REST
 * streamGenerateContent SSE endpoint; everything else uses the OpenAI-compatible
 * chat completions stream.
 */
async function* callLLMStreamRaw({
  provider,
  apiKey,
  baseUrl,
  model,
  prompt,
  systemInstruction,
  jsonOutput = false,
}: {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  jsonOutput?: boolean;
}): AsyncGenerator<string> {
  const effectiveBaseUrl = (baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '');
  const effectiveModel = model || DEFAULT_MODELS[provider]?.[0] || 'gemini-3.6-flash';

  if (provider === 'gemini' || (!apiKey && provider !== 'custom')) {
    if (!apiKey) {
      throw new Error('Gemini API Key is required. Please set it in Settings.');
    }
    const url = `${effectiveBaseUrl}/v1beta/models/${encodeURIComponent(effectiveModel)}:streamGenerateContent?alt=sse`;
    const body: any = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (jsonOutput) body.generationConfig = { responseMimeType: 'application/json' };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }
    if (!res.body) throw new Error('Gemini API returned no stream body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
          if (text) yield text;
        } catch {
          // ignore partial events
        }
      }
    }
    return;
  }

  // OpenAI-compatible SSE
  const endpoint = `${effectiveBaseUrl}/chat/completions`;
  const messages: any[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const payload: any = { model: effectiveModel, messages, temperature: 0.3, stream: true };
  if (jsonOutput) payload.response_format = { type: 'json_object' };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider.toUpperCase()} API error (${res.status}): ${errText}`);
  }
  if (!res.body) throw new Error(`${provider.toUpperCase()} API returned no stream body`);

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
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore partial lines
      }
    }
  }
}

async function collectRaw(params: Parameters<typeof callLLMStreamRaw>[0]): Promise<string> {
  let raw = '';
  for await (const delta of callLLMStreamRaw(params)) {
    raw += delta;
  }
  return raw;
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

  throw new Error(`Unsupported TTS engine: ${engine}`);
}

// ---------------------------
// Models listing
// ---------------------------

async function fetchModels({ provider, baseUrl, settings }: { provider: string; baseUrl?: string; settings: AppSettings }) {
  const cfg = resolveProviderConfig(settings, provider);
  if (provider === 'gemini' || (!cfg.apiKey && provider !== 'custom')) {
    return DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
  }
  try {
    const endpoint = `${(baseUrl || cfg.baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const res = await fetch(endpoint, { method: 'GET', headers });
    if (res.ok) {
      const data: any = await res.json();
      const rawList: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const ids = rawList.map((m: any) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean);
      if (ids.length > 0) return ids;
    }
  } catch (e) {
    // fall through to defaults
  }
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
}

// ---------------------------
// Port handler
// ---------------------------

export function handleBridgePort(port: chrome.runtime.Port) {
  if (port.name !== BRIDGE_PORT_NAME) return;

  port.onMessage.addListener(async (msg: any) => {
    if (msg?.type !== 'request' || typeof msg.id !== 'number') return;
    const reply = (type: 'delta' | 'done' | 'error', extra: Record<string, any> = {}) => {
      try {
        port.postMessage({ id: msg.id, type, ...extra });
      } catch {
        // port closed
      }
    };

    try {
      const settings = await getBridgeSettings();

      if (msg.kind === 'translate') {
        const { text, sourceLang, targetLang, provider, model, baseUrl } = msg.payload || {};
        if (!text || !text.trim()) throw new Error('Text is required');
        const cfg = resolveProviderConfig(settings, provider);
        let raw = '';
        for await (const delta of callLLMStreamRaw({
          provider,
          apiKey: cfg.apiKey,
          baseUrl: baseUrl || cfg.baseUrl,
          model: model || cfg.model,
          prompt: buildTranslatePrompt(text, sourceLang, targetLang),
          systemInstruction: TRANSLATE_SYSTEM_PROMPT,
          jsonOutput: true,
        })) {
          raw += delta;
          reply('delta', { text: delta });
        }
        const parsed = parseLLMJson(raw);
        reply('done', {
          result: {
            translation: parsed.translation || 'Translation unavailable.',
            detectedLang: parsed.detectedLang || 'Auto',
          },
        });
        return;
      }

      if (msg.kind === 'explain') {
        const { sentence, selectedWord, targetLang, provider, model, baseUrl } = msg.payload || {};
        if (!selectedWord || !selectedWord.trim()) throw new Error('Selected word is required');
        const cfg = resolveProviderConfig(settings, provider);
        const raw = await collectRaw({
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

      if (msg.kind === 'models') {
        const { provider, baseUrl } = msg.payload || {};
        const models = await fetchModels({ provider: provider || 'gemini', baseUrl, settings });
        reply('done', { result: { models } });
        return;
      }

      throw new Error(`Unknown bridge request kind: ${msg.kind}`);
    } catch (err: any) {
      reply('error', { error: err?.message || 'Bridge request failed' });
    }
  });
}
