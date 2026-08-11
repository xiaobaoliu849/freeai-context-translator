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
  custom: 'http://localhost:11434/v1',
};

// 模型列表不再内置预设：一律通过各服务商的 /models 接口实时获取（见
// SettingsModal「自动获取可用模型」与 server /api/models）。
export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = Object.fromEntries(
  (Object.keys(DEFAULT_BASE_URLS) as ProviderType[]).map((p) => [
    p,
    {
      apiKey: '',
      baseUrl: DEFAULT_BASE_URLS[p],
      model: '',
      availableModels: [],
    },
  ]),
) as Record<ProviderType, ProviderConfig>;

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
  autoTranslate: true,
  enableContextMenu: true,
};

/**
 * Loads saved AppSettings from a JSON blob (localStorage / chrome.storage),
 * merging with defaults so newly added fields always exist.
 */
export function parseSavedSettings(raw: string | null | undefined, fallback: AppSettings = DEFAULT_SETTINGS): AppSettings {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...fallback,
      ...parsed,
      providerConfigs: {
        ...DEFAULT_PROVIDER_CONFIGS,
        ...(parsed.providerConfigs || {}),
      },
    };
  } catch {
    return fallback;
  }
}
