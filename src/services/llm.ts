import { DEFAULT_BASE_URLS } from '../config';

const NO_MODEL_ERROR = '未设置模型，请先在设置中「自动获取可用模型」或手动填写模型';

export interface LLMCallParams {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  jsonOutput?: boolean;
  signal?: AbortSignal;
  /** Extra attempts after the first, for transient 429/503 errors (linear backoff). */
  retries?: number;
}

const DEFAULT_BASE_URL_MAP = DEFAULT_BASE_URLS as Record<string, string>;

function resolveBaseUrl(baseUrl: string | undefined, provider: string): string {
  return (baseUrl || DEFAULT_BASE_URL_MAP[provider] || '').replace(/\/+$/, '');
}

function requireModel(model: string | undefined): string {
  if (!model) throw new Error(NO_MODEL_ERROR);
  return model;
}

/**
 * Gemini-native path: explicit `gemini`, or any provider without a key that
 * isn't `custom` (the legacy "fall back to Gemini" behavior).
 */
function isGeminiPath(provider: string, apiKey: string): boolean {
  return provider === 'gemini' || (!apiKey && provider !== 'custom');
}

function isTransientError(err: unknown): boolean {
  const s = String((err as any)?.message || err);
  return (
    s.includes('503') ||
    s.includes('429') ||
    s.includes('UNAVAILABLE') ||
    s.includes('high demand') ||
    s.includes('RESOURCE_EXHAUSTED')
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------
// Request/response helpers (shared by Gemini and OpenAI-compatible providers)
// ---------------------------

interface ResolvedParams {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  systemInstruction: string;
  jsonOutput: boolean;
  signal?: AbortSignal;
}

function geminiBody(prompt: string, systemInstruction: string, jsonOutput: boolean) {
  const body: any = { contents: [{ parts: [{ text: prompt }] }] };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (jsonOutput) body.generationConfig = { responseMimeType: 'application/json' };
  return body;
}

function geminiPartsText(data: any): string {
  return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
}

function openaiMessages(prompt: string, systemInstruction: string): any[] {
  const messages: any[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function openaiHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

function openaiPayload(model: string, messages: any[], jsonOutput: boolean, stream: boolean): any {
  const payload: any = { model, messages, temperature: 0.3 };
  if (stream) payload.stream = true;
  if (jsonOutput) payload.response_format = { type: 'json_object' };
  return payload;
}

// ---------------------------
// Gemini native REST (no SDK — works in the browser, service worker, and Node)
// ---------------------------

async function geminiGenerate(p: ResolvedParams): Promise<string> {
  const url = `${p.baseUrl}/v1beta/models/${encodeURIComponent(p.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey },
    body: JSON.stringify(geminiBody(p.prompt, p.systemInstruction, p.jsonOutput)),
    signal: p.signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const parsed = JSON.parse(errText);
      detail = parsed.error?.message || parsed.message || errText;
    } catch {}
    throw new Error(`Gemini API error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`Gemini API error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return geminiPartsText(data);
}

async function* geminiGenerateStream(p: ResolvedParams): AsyncGenerator<string> {
  const url = `${p.baseUrl}/v1beta/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey },
    body: JSON.stringify(geminiBody(p.prompt, p.systemInstruction, p.jsonOutput)),
    signal: p.signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }
  if (!res.body) throw new Error('Gemini API returned no stream body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let allRaw = '';
  let yielded = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (p.signal?.aborted) break;
    const chunk = decoder.decode(value, { stream: true });
    allRaw += chunk;
    buffer += chunk;
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const text = geminiPartsText(parsed);
        if (text) {
          yielded = true;
          yield text;
        }
      } catch {
        // ignore partial events
      }
    }
  }
  // Some models respond with a plain JSON body (no SSE framing), or the final
  // SSE event lacks the trailing blank line and stayed in `buffer`. Handle only
  // UNPROCESSED data — parsing `allRaw` again would duplicate yielded text.
  const tail = buffer.trim();
  if (tail) {
    const dataLine = tail.split('\n').find((l) => l.startsWith('data:'));
    const payload = dataLine ? dataLine.slice(5).trim() : tail;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.error) {
        throw new Error(`Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
      }
      const text = geminiPartsText(parsed);
      if (text) yield text;
    } catch (e: any) {
      // Re-throw API errors, but swallow harmless JSON parse failures
      // (e.g. a partial SSE event whose text was already yielded).
      if (e?.message?.startsWith('Gemini API error')) throw e;
    }
  }
  // Whole-body fallback for pretty-printed JSON bodies (multi-line, with blank
  // lines) that the newline-newline split may have fragmented.
  if (!yielded && allRaw.trim()) {
    try {
      const parsed = JSON.parse(allRaw.trim());
      if (parsed?.error) {
        throw new Error(`Gemini API error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
      }
      const text = geminiPartsText(parsed);
      if (text) yield text;
    } catch (e: any) {
      if (e?.message?.startsWith('Gemini API error')) throw e;
    }
  }
}

// ---------------------------
// OpenAI-compatible REST
// ---------------------------

async function openaiGenerate(p: ResolvedParams): Promise<string> {
  const endpoint = `${p.baseUrl}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: openaiHeaders(p.apiKey),
    body: JSON.stringify(openaiPayload(p.model, openaiMessages(p.prompt, p.systemInstruction), p.jsonOutput, false)),
    signal: p.signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const parsed = JSON.parse(errText);
      detail = parsed.error?.message || parsed.message || errText;
    } catch {}
    throw new Error(`${p.provider.toUpperCase()} API error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function* openaiGenerateStream(p: ResolvedParams): AsyncGenerator<string> {
  const endpoint = `${p.baseUrl}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: openaiHeaders(p.apiKey),
    body: JSON.stringify(openaiPayload(p.model, openaiMessages(p.prompt, p.systemInstruction), p.jsonOutput, true)),
    signal: p.signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const parsed = JSON.parse(errText);
      detail = parsed.error?.message || parsed.message || errText;
    } catch {}
    throw new Error(`${p.provider.toUpperCase()} API error (${res.status}): ${detail}`);
  }
  if (!res.body) throw new Error(`${p.provider.toUpperCase()} API returned no stream body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (p.signal?.aborted) break;
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

// ---------------------------
// Public API
// ---------------------------

/**
 * Non-streaming LLM call: returns the full response text. Supports Gemini and
 * OpenAI-compatible providers, and optionally retries transient 429/503 errors.
 */
export async function callLLM(params: LLMCallParams): Promise<string> {
  const provider = params.provider || 'gemini';
  const apiKey = params.apiKey || '';
  const geminiPath = isGeminiPath(provider, apiKey);
  if (geminiPath && !apiKey) {
    // A keyless non-gemini provider still lands on the Gemini path (legacy
    // fallback) — name the provider so the user knows which key to set.
    throw new Error(`${provider === 'gemini' ? 'Gemini' : provider} API Key is required. Please set it in Settings.`);
  }

  const resolved: ResolvedParams = {
    provider,
    apiKey,
    baseUrl: resolveBaseUrl(params.baseUrl, provider),
    model: requireModel(params.model),
    prompt: params.prompt,
    systemInstruction: params.systemInstruction || '',
    jsonOutput: !!params.jsonOutput,
    signal: params.signal,
  };

  const attempts = (params.retries ?? 0) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (resolved.signal?.aborted) break;
    try {
      return geminiPath ? await geminiGenerate(resolved) : await openaiGenerate(resolved);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt >= attempts - 1) break;
      if (resolved.signal?.aborted) break;
      await sleep((attempt + 1) * 600);
    }
  }
  throw lastError;
}

/**
 * Streaming LLM call: yields text deltas as they arrive. Gemini uses the REST
 * `streamGenerateContent` SSE endpoint; everything else uses the
 * OpenAI-compatible `chat/completions` stream. No retry (retrying mid-stream
 * would duplicate text).
 */
export async function* callLLMStream(params: LLMCallParams): AsyncGenerator<string> {
  const provider = params.provider || 'gemini';
  const apiKey = params.apiKey || '';
  const geminiPath = isGeminiPath(provider, apiKey);
  if (geminiPath && !apiKey) {
    throw new Error(`${provider === 'gemini' ? 'Gemini' : provider} API Key is required. Please set it in Settings.`);
  }

  const resolved: ResolvedParams = {
    provider,
    apiKey,
    baseUrl: resolveBaseUrl(params.baseUrl, provider),
    model: requireModel(params.model),
    prompt: params.prompt,
    systemInstruction: params.systemInstruction || '',
    jsonOutput: !!params.jsonOutput,
    signal: params.signal,
  };

  if (geminiPath) {
    yield* geminiGenerateStream(resolved);
  } else {
    yield* openaiGenerateStream(resolved);
  }
}
