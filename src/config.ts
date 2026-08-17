import { AppSettings, ProviderConfig, ProviderType } from './types';

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
];

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  moonshot: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimaxi.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  fishaudio: 'https://api.fish.audio/v1',
  mimo: 'https://api.xiaomimimo.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  cerebras: 'https://api.cerebras.ai/v1',
  custom: 'http://localhost:11434/v1',
};

// 首次使用时的默认模型（免费端点优先，方便开箱即用）。完整模型列表仍可
// 通过各服务商的 /models 接口实时获取（见 SettingsModal「自动获取可用模型」）。
export const DEFAULT_MODELS: Partial<Record<ProviderType, string>> = {
  glm: 'glm-4.7-flash',
  cerebras: 'llama-3.3-70b',
};

// 智谱 /models 接口不返回免费的 flash 系列模型（上游已知行为，见
// https://github.com/liliMozi/openhanako/issues/1266），但直接调用是有效的。
// 「自动获取可用模型」时把已知免费 flash 模型合并进列表，保证免费模型可被发现。
export const GLM_FLASH_MODELS = ['glm-4.7-flash', 'glm-4-flash'];

/** 合并已知免费模型到拉取结果（目前仅智谱需要）；其余 provider 原样返回。 */
export function mergeKnownFreeModels(provider: ProviderType, models: string[]): string[] {
  if (provider !== 'glm') return models;
  const extra = GLM_FLASH_MODELS.filter((m) => !models.includes(m));
  return extra.length ? [...extra, ...models] : models;
}

// 模型列表不再内置预设：一律通过各服务商的 /models 接口实时获取（见
// SettingsModal「自动获取可用模型」与 server /api/models）。
export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = Object.fromEntries(
  (Object.keys(DEFAULT_BASE_URLS) as ProviderType[]).map((p) => [
    p,
    {
      apiKey: '',
      baseUrl: DEFAULT_BASE_URLS[p],
      model: DEFAULT_MODELS[p] || '',
      availableModels: [],
    },
  ]),
) as Record<ProviderType, ProviderConfig>;

// Version of the stored settings schema. Increment + add a one-time migration
// in migrateSettings whenever a default changes so existing installs are
// brought in line instead of keeping stale values forever.
export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: 'gemini',
  providerConfigs: DEFAULT_PROVIDER_CONFIGS,
  // Legacy compatibility fields (kept so old saved settings keep working)
  geminiApiKey: '',
  deepseekApiKey: '',
  openaiApiKey: '',
  customEndpoint: '',
  apiModel: '',
  defaultSourceLang: 'auto',
  defaultTargetLang: 'zh-CN',
  ttsEngine: 'gemini',
  ttsVoice: 'Kore',
  ttsRate: 1.0,
  wordHoverMode: 'click',
  selectInputElementsText: false,
  autoTranslate: false,
  enableContextMenu: true,
};

/**
 * One-time migrations for settings saved by older builds. Runs whenever the
 * stored settings have no settingsVersion marker, then stamps the current
 * version so the migration never re-applies.
 *
 * v1 → v2: autoTranslate used to default to `true`, so any settings saved by
 * an older build silently keep auto-translating on input even though the new
 * default is off. Reset it once (users who re-enable it explicitly later are
 * unaffected — the marker prevents this from running again).
 */
export function migrateSettings(parsed: Partial<AppSettings>): Partial<AppSettings> {
  if (parsed.settingsVersion === undefined) {
    parsed.autoTranslate = false;
    parsed.settingsVersion = SETTINGS_VERSION;
  }
  return parsed;
}

/**
 * Loads saved AppSettings from a JSON blob (localStorage / chrome.storage),
 * merging with defaults so newly added fields always exist.
 *
 * Accepts both a JSON string and a raw object: an older popup build stored the
 * settings object directly into chrome.storage.local, which JSON.parse would
 * coerce to "[object Object]" and throw on. Handling the object form lets the
 * background bridge recover the user's saved API keys instead of silently
 * falling back to DEFAULT_SETTINGS.
 */
export function parseSavedSettings(raw: string | Partial<AppSettings> | null | undefined, fallback: AppSettings = DEFAULT_SETTINGS): AppSettings {
  if (!raw) return fallback;
  try {
    const parsed: Partial<AppSettings> =
      typeof raw === 'object' ? (raw as Partial<AppSettings>) : (JSON.parse(raw) as Partial<AppSettings>);
    return {
      ...fallback,
      ...migrateSettings(parsed),
      providerConfigs: {
        ...DEFAULT_PROVIDER_CONFIGS,
        ...(parsed.providerConfigs || {}),
      },
    };
  } catch {
    return fallback;
  }
}
