export type ProviderType = 
  | 'gemini' 
  | 'deepseek' 
  | 'qwen' 
  | 'doubao' 
  | 'moonshot' 
  | 'minimax'  | 'groq'
  | 'openai'
  | 'fishaudio'
  | 'mimo'
  | 'custom';

export type TTSEngine = 
  | 'gemini' 
  | 'edge'
  | 'openai' 
  | 'minimax' 
  | 'qwen' 
  | 'doubao' 
  | 'fishaudio' 
  | 'mimo' 
  | 'browser' 
  | 'google-web';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  availableModels: string[];
}

export interface AppSettings {
  defaultProvider: ProviderType;
  providerConfigs: Record<ProviderType, ProviderConfig>;
  // Legacy compatibility fields
  geminiApiKey: string;
  deepseekApiKey: string;
  openaiApiKey: string;
  customEndpoint: string;
  apiModel: string;
  defaultSourceLang: string;
  defaultTargetLang: string;
  ttsEngine: TTSEngine;
  ttsVoice: string;
  ttsRate: number;
  ttsApiKey?: string;
  ttsBaseUrl?: string;
  wordHoverMode: 'hover' | 'click' | 'select';
  // Whether selection inside input/textarea fields also triggers translation
  selectInputElementsText?: boolean;
  autoTranslate: boolean;
  enableContextMenu: boolean;
  fontSize?: 'sm' | 'base' | 'lg';
  layoutMode?: 'auto' | 'stacked' | 'side-by-side';
}

export interface WordToken {
  word: string;
  inContextTranslation: string;
  pos?: string;
  phonetic?: string;
}

export interface TranslationResult {
  id: string;
  sourceText: string;
  translation: string;
  sourceLang: string;
  targetLang: string;
  detectedLang?: string;
  tokens?: WordToken[];
  timestamp: number;
}

export interface WordExplanation {
  word: string;
  phonetic?: string;
  pos?: string;
  partOfSpeech?: string;
  literalMeaning?: string;
  contextualMeaning: string;
  contextExplanation: string;
  rootOrLemma?: string;
  cefrLevel?: string;
  collocations?: string[];
  antonyms?: string[];
  synonymsInContext?: string[];
  examples?: Array<{
    source: string;
    target: string;
  }>;
  exampleSentences?: Array<{
    original: string;
    translation: string;
  }>;
}

export interface HistoryItem {
  id: string;
  sourceText: string;
  translation: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  favorite?: boolean;
}
