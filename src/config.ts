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

export const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  gemini: ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.1-pro', 'gemini-3-pro'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  qwen: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-coder-plus', 'qwen-max-latest', 'qwen-plus-latest'],
  doubao: ['doubao-1-5-pro-32k-250115', 'doubao-1-5-lite-32k-250115', 'doubao-pro-128k', 'doubao-lite-128k'],
  moonshot: ['kimi-latest', 'moonshot-v1-auto', 'moonshot-v1-128k', 'moonshot-v1-32k'],
  minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'minimax-text-01'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'deepseek-r1-distill-llama-70b'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini'],
  fishaudio: ['fish-speech-1.5', 'fish-speech-1.4'],
  mimo: ['mimo-v2.5-tts'],
  custom: ['llama3.3', 'qwen3', 'deepseek-v4-flash', 'mistral', 'phi4'],
};

export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = Object.fromEntries(
  (Object.keys(DEFAULT_BASE_URLS) as ProviderType[]).map((p) => [
    p,
    {
      apiKey: '',
      baseUrl: DEFAULT_BASE_URLS[p],
      model: DEFAULT_MODELS[p][0],
      availableModels: [...DEFAULT_MODELS[p]],
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
  apiModel: DEFAULT_MODELS.gemini[0],
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
