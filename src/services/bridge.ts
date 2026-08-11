import { AppSettings, WordExplanation } from '../types';
import { DEFAULT_SETTINGS, parseSavedSettings } from '../config';

export const BRIDGE_PORT_NAME = 'ft-bridge';
export const SETTINGS_STORAGE_KEY = 'freetranslate_settings';

/** True when running inside the Chrome extension (content script / popup / SW). */
export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

/** Reads saved settings from chrome.storage.local (extension) or localStorage (web app). */
export async function getExtensionSettings(): Promise<AppSettings> {
  if (isExtensionContext()) {
    try {
      const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
      if (result[SETTINGS_STORAGE_KEY]) {
        return parseSavedSettings(result[SETTINGS_STORAGE_KEY]);
      }
    } catch (e) {
      // ignore
    }
  }
  try {
    const local = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (local) return parseSavedSettings(local);
  } catch (e) {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

// ---------------------------
// Long-lived port RPC client
// ---------------------------

interface BridgeReply {
  id: number;
  type: 'delta' | 'done' | 'error';
  text?: string;
  result?: any;
  error?: string;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onDelta?: (text: string) => void;
}

class BridgeClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: BRIDGE_PORT_NAME });
    port.onMessage.addListener((msg: BridgeReply) => {
      const p = this.pending.get(msg?.id);
      if (!p) return;
      if (msg.type === 'delta') {
        p.onDelta?.(msg.text ?? '');
      } else if (msg.type === 'done') {
        this.pending.delete(msg.id);
        p.resolve(msg.result);
      } else if (msg.type === 'error') {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.error || 'Bridge request failed'));
      }
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      const err = new Error('Background bridge disconnected');
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    });
    this.port = port;
    return port;
  }

  /** Sends a request to the background and resolves when `done` arrives. */
  call<T = any>(kind: string, payload: Record<string, any>, onDelta?: (text: string) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onDelta });
      try {
        this.ensurePort().postMessage({ id, kind, type: 'request', payload });
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }
}

export const bridgeClient = new BridgeClient();

// ---------------------------
// Typed helpers (extension context only — the background resolves keys itself)
// ---------------------------

export interface BridgeTranslatePayload {
  text: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  model?: string;
  baseUrl?: string;
}

export function bridgeTranslate(
  payload: BridgeTranslatePayload,
  onDelta?: (text: string) => void,
): Promise<{ translation: string; detectedLang?: string }> {
  return bridgeClient.call('translate', payload, onDelta);
}

export function bridgeExplain(payload: {
  sentence: string;
  selectedWord: string;
  targetLang: string;
  provider: string;
  model?: string;
  baseUrl?: string;
}): Promise<WordExplanation> {
  return bridgeClient.call('explain', payload);
}

export function bridgeTts(payload: {
  text: string;
  lang: string;
  engine: string;
  voice?: string;
  rate?: number;
}): Promise<{ audioBase64: string; mimeType: string; sampleRate?: number }> {
  return bridgeClient.call('tts', payload);
}

export function bridgeModels(payload: { provider: string; baseUrl?: string }): Promise<{ models: string[] }> {
  return bridgeClient.call('models', payload);
}
