import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ReadingWorkspaceShell } from './components/ReadingWorkspaceShell';
import { TranslatorMain } from './components/TranslatorMain';
import { SettingsModal } from './components/SettingsModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { DEFAULT_SETTINGS, SUPPORTED_LANGUAGES, parseSavedSettings } from './config';
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

export interface AppProps {
  initialText?: string;
  initialContext?: string;
  initialSettings?: AppSettings;
  isFloating?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
}

export default function App({
  initialText,
  initialContext,
  initialSettings,
  isFloating = false,
  isPinned = false,
  onTogglePin,
  onClose,
  onDragStart,
  isExpanded = false,
  onToggleExpanded,
}: AppProps = {}) {
  // The same App is mounted by index.html (full web app), popup.html, and in-page floating window
  const isPopup =
    isFloating || (typeof window !== 'undefined' && /popup\.html($|\?)/.test(window.location.pathname));

  const [sourceText, setSourceText] = useState<string>(() => {
    if (initialText !== undefined) {
      return initialText;
    }
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
  const [selectionContext, setSelectionContext] = useState(initialContext || '');
  // Selection is distinct from history retranslation: a selected term opens its definition.
  const [selectionSignal, setSelectionSignal] = useState(initialText ? 1 : 0);
  const [sourceLangOverride, setSourceLang] = useState<string>();
  const [targetLangOverride, setTargetLang] = useState<string>();

  // If opened inside Chrome extension popup, check if the current active tab has selected text
  useEffect(() => {
    if (!isFloating && isPopup && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab?.id) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'REQUEST_SELECTION' }, (response) => {
            if (chrome.runtime.lastError) return;
            const sel = response?.text?.trim();
            if (sel) {
              setSourceText(sel);
              setSelectionContext(typeof response?.context === 'string' ? response.context.slice(0, 380) : '');
              setSelectionSignal((s) => s + 1);
            }
          });
        }
      });
    }
  }, [isPopup, isFloating]);

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
  const [workspaceSelection, setWorkspaceSelection] = useState<{id:number; text:string; start:number} | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  // Settings & History State with LocalStorage and chrome.storage
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (initialSettings || isFloating) return initialSettings || DEFAULT_SETTINGS;
    try {
      const savedNew = localStorage.getItem(STORAGE_KEYS.settings);
      const savedOld = localStorage.getItem('nextai_translator_settings');
      const saved = savedNew || savedOld;
      
      // Clean up legacy key if it existed
      if (savedOld) {
        localStorage.removeItem('nextai_translator_settings');
      }

      return parseSavedSettings(saved);
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const extensionStorage = typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
  const [storageReady, setStorageReady] = useState(!extensionStorage);
  // Sync settings and history from chrome.storage.local on mount
  useEffect(() => {
    if (!extensionStorage) return;
    let current = true;
    chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.history], (result) => {
      if (!current) return;
      const stored = result?.[STORAGE_KEYS.settings];
      if (stored) setSettings(prev => parseSavedSettings(stored, prev));
      const storedHistory = result?.[STORAGE_KEYS.history];
      try {
        const items = typeof storedHistory === 'string' ? JSON.parse(storedHistory) : storedHistory;
        if (Array.isArray(items)) setHistory(items);
      } catch { /* Ignore malformed legacy history. */ }
      setStorageReady(true);
    });
    return () => { current = false; };
  }, []);

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (isFloating) return [];
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
    if (!storageReady) return;
    try {
      if (!isFloating) localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    } catch (e) {
      // ignore
    }
    // Store a JSON string: readers (background SW / content script) parse it
    // with JSON.parse, which would throw on a raw object and silently fall
    // back to DEFAULT_SETTINGS — losing the API key for the bridge.
    mirrorToExtensionStorage({ [STORAGE_KEYS.settings]: JSON.stringify(settings) });
  }, [settings, storageReady, isFloating]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      if (!isFloating) localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
    } catch (e) {
      // ignore
    }
    mirrorToExtensionStorage({ [STORAGE_KEYS.history]: JSON.stringify(history) });
  }, [history, storageReady, isFloating]);

  const sourceLang = sourceLangOverride || settings.defaultSourceLang || 'auto';
  const targetLang = targetLangOverride || settings.defaultTargetLang || 'zh-CN';

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

  const translator = storageReady ? (
    <TranslatorMain
      sourceText={sourceText}
      setSourceText={(text) => { setSelectionContext(''); setSourceText(text); }}
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
      selectionSignal={selectionSignal}
      selectionContext={selectionContext}
      isPopup={isPopup}
      isFloating={isFloating}
      workspaceSelection={workspaceSelection}
      resetSignal={resetSignal}
    />
  ) : <p role="status" className="p-4 text-sm text-slate-500">正在读取翻译设置…</p>;

  return (
    <div className={`yumai-app ${isFloating ? 'yumai-floating' : ''} ${isPopup ? 'yumai-popup h-screen overflow-hidden' : 'min-h-screen'} flex flex-col text-slate-900 selection:bg-indigo-100 selection:text-slate-900`}>
      {/* Header Bar */}
      <Header
        openSettings={() => setIsSettingsOpen(true)}
        openHistory={() => setIsHistoryOpen(true)}
        settings={settings}
        isPopup={isPopup}
        isFloating={isFloating}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onClose={onClose}
        onDragStart={onDragStart}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
      />

      {/* Separate reading workspace for full tabs; the popup remains a focused tool. */}
      <main className={isPopup ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-w-0'}>
        {isPopup ? translator : (
          <ReadingWorkspaceShell
            sourceText={sourceText}
            onNewDocument={() => { setSourceText(''); setSelectionContext(''); setWorkspaceSelection(null); setResetSignal(v => v + 1); }}
            onLoadExample={(text) => { setSourceText(text); setSelectionContext(''); setWorkspaceSelection(null); setResetSignal(v => v + 1); }}
            onTranslateSegment={(segment) => setWorkspaceSelection(prev => ({id:(prev?.id || 0) + 1, ...segment}))}
          >
            {translator}
          </ReadingWorkspaceShell>
        )}
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
          setSelectionContext('');
          setResetSignal(v => v + 1);
          setSourceText(item.sourceText);
          setSourceLang(item.sourceLang);
          setTargetLang(item.targetLang);
        }}
        onRetranslate={(item) => {
          setResetSignal(v => v + 1);
          setSelectionContext('');
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
