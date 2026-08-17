import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { TranslatorMain } from './components/TranslatorMain';
import { SettingsModal } from './components/SettingsModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { DEFAULT_PROVIDER_CONFIGS, DEFAULT_SETTINGS, SUPPORTED_LANGUAGES, migrateSettings } from './config';
import { AppSettings, HistoryItem } from './types';

const STORAGE_KEYS = {
  settings: 'freetranslate_settings',
  history: 'freetranslate_history',
};

// Mirror state into chrome.storage.local so the extension's content script
// (which can't read the popup's localStorage) can use the same settings/history.
function mirrorToExtensionStorage(items: Record<string, any>) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set(items);
    }
  } catch (e) {
    // ignore
  }
}

export default function App() {
  // The same App is mounted by index.html (full web app) and popup.html
  const isPopup =
    typeof window !== 'undefined' && /popup\.html($|\?)/.test(window.location.pathname);

  const [sourceText, setSourceText] = useState<string>(() => {
    if (isPopup) {
      // In extension popup, always start clean unless active webpage text is selected
      try {
        localStorage.removeItem('freetranslate_draft');
      } catch (e) {}
      return '';
    }
    try {
      const draft = localStorage.getItem('freetranslate_draft');
      if (draft !== null) return draft;
    } catch (e) {}
    return '';
  });
  const [sourceLang, setSourceLang] = useState<string>('auto');
  const [targetLang, setTargetLang] = useState<string>('zh-CN');

  // If opened inside Chrome extension popup, check if the current active tab has selected text
  useEffect(() => {
    if (isPopup && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab?.id) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'REQUEST_SELECTION' }, (response) => {
            if (chrome.runtime.lastError) return;
            const sel = response?.text?.trim();
            if (sel) {
              setSourceText(sel);
              setRetranslateSignal((s) => s + 1);
            }
          });
        }
      });
    }
  }, [isPopup]);

  useEffect(() => {
    if (isPopup) return;
    try {
      if (sourceText) {
        localStorage.setItem('freetranslate_draft', sourceText);
      } else {
        localStorage.removeItem('freetranslate_draft');
      }
    } catch (e) {}
  }, [sourceText, isPopup]);

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Bumped when the user retranslates a history item (TranslatorMain reacts).
  const [retranslateSignal, setRetranslateSignal] = useState(0);

  // Settings & History State with LocalStorage
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const savedNew = localStorage.getItem(STORAGE_KEYS.settings);
      const savedOld = localStorage.getItem('nextai_translator_settings');
      const saved = savedNew || savedOld;
      
      // Clean up legacy key if it existed
      if (savedOld) {
        localStorage.removeItem('nextai_translator_settings');
      }

      if (saved) {
        const parsed = JSON.parse(saved);

        // Map of obsolete / fictitious legacy models to strip across providers.
        // These include the old hardcoded presets (e.g. gemini-3.6-flash) that
        // never existed as real model IDs — keep them so saved settings get
        // reset and the user re-fetches real model names.
        const legacyModelsMap: Record<string, string[]> = {
          gemini: ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.1-pro', 'gemini-3-pro', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
          deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
          openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4', 'o1-mini', 'o1'],
          qwen: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.5-plus', 'qwen3.5-flash', 'qwen2.5-72b-instruct', 'qwen2.5-coder-32b-instruct', 'qwen3-72b-instruct', 'qwen-long'],
          minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'minimax-text-01', 'abab6.5s-chat', 'abab6.5g-chat', 'MiniMax-M2.5'],
          groq: ['mixtral-8x7b-32768', 'gemma2-9b-it', 'llama-3.2-11b-vision-preview'],
        };

        const mergedConfigs: any = { ...DEFAULT_PROVIDER_CONFIGS };

        if (parsed.providerConfigs) {
          for (const pKey of Object.keys(DEFAULT_PROVIDER_CONFIGS) as Array<keyof typeof DEFAULT_PROVIDER_CONFIGS>) {
            const defaultCfg = DEFAULT_PROVIDER_CONFIGS[pKey];
            const savedCfg = parsed.providerConfigs[pKey];
            if (savedCfg) {
              const legacyList = legacyModelsMap[pKey] || [];
              let model = savedCfg.model;
              if (!model || legacyList.includes(model)) {
                model = defaultCfg.model;
              }
              let availableModels = Array.isArray(savedCfg.availableModels) ? savedCfg.availableModels : defaultCfg.availableModels;
              availableModels = availableModels.filter((m: string) => !legacyList.includes(m));

              mergedConfigs[pKey] = {
                ...defaultCfg,
                ...savedCfg,
                model,
                availableModels,
              };
            }
          }
        }

        const activeProvider = (parsed.defaultProvider || DEFAULT_SETTINGS.defaultProvider) as keyof typeof DEFAULT_PROVIDER_CONFIGS;
        let apiModel = parsed.apiModel;
        const allLegacy = Object.values(legacyModelsMap).flat();
        if (!apiModel || allLegacy.includes(apiModel)) {
          apiModel = mergedConfigs[activeProvider]?.model || DEFAULT_SETTINGS.apiModel;
        }

        // One-time migration (v1 → v2): older builds saved autoTranslate=true
        // (the old default), so stale installs keep auto-translating while
        // typing. Reset it once and stamp the version — see migrateSettings.
        migrateSettings(parsed);

        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          apiModel,
          providerConfigs: mergedConfigs,
        };
      }
      return DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const savedNew = localStorage.getItem(STORAGE_KEYS.history);
      const savedOld = localStorage.getItem('nextai_translator_history');
      const saved = savedNew || savedOld;

      if (savedOld) {
        localStorage.removeItem('nextai_translator_history');
      }

      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
    // Store a JSON string: readers (background SW / content script) parse it
    // with JSON.parse, which would throw on a raw object and silently fall
    // back to DEFAULT_SETTINGS — losing the API key for the bridge.
    mirrorToExtensionStorage({ [STORAGE_KEYS.settings]: JSON.stringify(settings) });
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
    } catch (e) {
      // ignore
    }
    mirrorToExtensionStorage({ [STORAGE_KEYS.history]: JSON.stringify(history) });
  }, [history]);

  const handleSwapLanguages = () => {
    if (sourceLang === 'auto') {
      setSourceLang(targetLang);
      setTargetLang('en');
    } else {
      const prevSource = sourceLang;
      setSourceLang(targetLang);
      setTargetLang(prevSource);
    }
  };

  const handleSaveHistoryItem = (item: { sourceText: string; translation: string; sourceLang: string; targetLang: string }) => {
    try {
      localStorage.removeItem('freetranslate_draft');
    } catch (e) {}
    setHistory((prev) => {
      // Skip saving when it's identical to the most recent item (e.g. repeated
      // auto-translates of unchanged text) to avoid duplicate history spam.
      const last = prev[0];
      if (
        last &&
        last.sourceText === item.sourceText &&
        last.translation === item.translation &&
        last.sourceLang === item.sourceLang &&
        last.targetLang === item.targetLang
      ) {
        return prev;
      }
      const newItem: HistoryItem = {
        id: Date.now().toString(),
        ...item,
        timestamp: Date.now(),
      };
      return [newItem, ...prev.slice(0, 49)]; // keep max 50 items
    });
  };

  return (
    <div className={`${isPopup ? 'h-screen overflow-hidden' : 'min-h-screen'} bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-500 selection:text-white`}>
      {/* Header Bar */}
      <Header
        openSettings={() => setIsSettingsOpen(true)}
        openHistory={() => setIsHistoryOpen(true)}
        settings={settings}
        isPopup={isPopup}
      />

      {/* Main App Content View */}
      <main className={isPopup ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 pb-8'}>
        <TranslatorMain
          sourceText={sourceText}
          setSourceText={setSourceText}
          sourceLang={sourceLang}
          setSourceLang={setSourceLang}
          targetLang={targetLang}
          setTargetLang={setTargetLang}
          onSwapLanguages={handleSwapLanguages}
          languages={SUPPORTED_LANGUAGES}
          settings={settings}
          onSaveHistory={handleSaveHistoryItem}
          openSettings={() => setIsSettingsOpen(true)}
          openHistory={() => setIsHistoryOpen(true)}
          retranslateSignal={retranslateSignal}
          isPopup={isPopup}
        />
      </main>

      {/* Modals & Drawers */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={(newSet) => setSettings(newSet)}
        languages={SUPPORTED_LANGUAGES}
      />

      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        settings={settings}
        onSelectHistory={(item) => {
          setSourceText(item.sourceText);
          setSourceLang(item.sourceLang);
          setTargetLang(item.targetLang);
        }}
        onRetranslate={(item) => {
          setSourceText(item.sourceText);
          setSourceLang(item.sourceLang);
          setTargetLang(item.targetLang);
          setRetranslateSignal((s) => s + 1);
        }}
        onClearHistory={() => {
          setHistory([]);
          try {
            localStorage.removeItem(STORAGE_KEYS.history);
            localStorage.removeItem('nextai_translator_history');
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.remove(STORAGE_KEYS.history);
            }
          } catch (e) {}
        }}
      />
    </div>
  );
}
