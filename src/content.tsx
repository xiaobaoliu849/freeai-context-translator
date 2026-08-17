import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { WordContextCard } from './components/WordContextCard';
import { TranslationCard } from './components/TranslationCard';
import { bridgeExplain, bridgeTranslate, isExtensionContext } from './services/bridge';
import { DEFAULT_SETTINGS, parseSavedSettings } from './config';
import { AppSettings, WordExplanation } from './types';
import { initPageTranslate } from './pageTranslate';
import './content.css';

const SETTINGS_STORAGE_KEY = 'freetranslate_settings';

/**
 * In the extension, the content script must never hold API keys: all LLM/TTS
 * work is routed to the background bridge, which resolves keys from storage
 * itself. This strips them so they cannot leak into page context.
 */
function scrubApiKeys(s: AppSettings): AppSettings {
  const providerConfigs: Record<string, any> = {};
  for (const [k, v] of Object.entries(s.providerConfigs || {})) {
    providerConfigs[k] = { ...v, apiKey: '' };
  }
  return {
    ...s,
    providerConfigs: providerConfigs as any,
    geminiApiKey: '',
    deepseekApiKey: '',
    openaiApiKey: '',
    ttsApiKey: '',
  };
}

/**
 * Reads saved settings. In the web app they live in localStorage; inside the
 * Chrome extension, localStorage of a content script belongs to the host page,
 * so the real settings are read from chrome.storage.local (mirrored there by
 * the popup/options page) and localStorage is only a fallback for the web app.
 * In the extension branch the API keys are scrubbed (see scrubApiKeys).
 */
async function getSavedSettings(): Promise<AppSettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
      if (result[SETTINGS_STORAGE_KEY]) {
        return scrubApiKeys(parseSavedSettings(result[SETTINGS_STORAGE_KEY]));
      }
    }
  } catch (e) {
    // Ignore
  }
  try {
    const local = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (local) return parseSavedSettings(local);
  } catch (e) {
    // Ignore
  }
  return DEFAULT_SETTINGS;
}

interface SelectionPopoverProps {
  selectedText: string;
  position: { x: number; y: number };
  onClose: () => void;
  settings: AppSettings;
  /**
   * 'translate'  — always show the plain translation card
   * 'explain'    — always show the word deep-dive card (short text only;
   *                a long selection falls back to translation)
   * 'auto'       — short selection → explain, longer → translate
   */
  mode?: 'auto' | 'translate' | 'explain';
}

const SelectionPopover: React.FC<SelectionPopoverProps> = ({ selectedText, position, onClose, settings, mode = 'auto' }) => {
  const [loading, setLoading] = useState(true);
  const [translation, setTranslation] = useState<string>('');
  const [detectedLang, setDetectedLang] = useState<string>('');
  const [explanation, setExplanation] = useState<WordExplanation | null>(null);
  const [resolvedMode, setResolvedMode] = useState<'translate' | 'explain'>(mode === 'explain' ? 'explain' : 'translate');
  const [modeNote, setModeNote] = useState<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;
    async function analyze() {
      setLoading(true);
      let useExplain = false;
      try {
        // This content script only runs inside the extension, where all LLM
        // work is relayed to the background bridge — no API key here.
        if (!isExtensionContext()) {
          throw new Error('划词翻译仅在 Chrome 扩展中可用');
        }

        const activeProvider = settings.defaultProvider || 'gemini';
        const activeConfig = settings.providerConfigs?.[activeProvider] || {
          apiKey: '',
          baseUrl: '',
          model: settings.apiModel || '',
          availableModels: [],
        };

        // Decide the view: a word deep-dive for short selections, a plain
        // translation for paragraphs. An explicit 'explain' request still
        // downgrades to translation when the selection is clearly a paragraph.
        const wordCount = selectedText.trim().split(/\s+/).length;
        useExplain = mode === 'explain' ? wordCount <= 8 : mode === 'auto' ? wordCount <= 4 : false;
        if (isMounted) {
          setResolvedMode(useExplain ? 'explain' : 'translate');
          setModeNote(mode === 'explain' && !useExplain
            ? '选中文本较长，已自动转为整句翻译。深度解析请选中单个词或短语。'
            : undefined);
        }

        if (useExplain) {
          const expData = await bridgeExplain({
            sentence: selectedText,
            selectedWord: selectedText,
            targetLang: settings.defaultTargetLang || 'zh-CN',
            provider: activeProvider,
            baseUrl: activeConfig.baseUrl,
            model: activeConfig.model || settings.apiModel,
          });
          if (isMounted) {
            setExplanation(expData);
          }
        } else {
          const transData = await bridgeTranslate({
            text: selectedText,
            sourceLang: 'auto',
            targetLang: settings.defaultTargetLang || 'zh-CN',
            provider: activeProvider,
            baseUrl: activeConfig.baseUrl,
            model: activeConfig.model || settings.apiModel,
          });
          if (isMounted) {
            setTranslation(transData.translation);
            setDetectedLang(transData.detectedLang || '');
          }
        }
      } catch (err: any) {
        if (isMounted) {
          if (useExplain) {
            setExplanation({
              word: selectedText,
              contextualMeaning: 'Analysis error',
              contextExplanation: err?.message || 'Failed to analyze text. Please check API Key in Extension Settings.',
            });
          } else {
            setTranslation(`翻译失败：${err?.message || '请检查 API Key / 模型设置'}`);
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    analyze();
    return () => {
      isMounted = false;
    };
  }, [selectedText]);

  return (
    <div
      className="freetranslate-modal-card"
      style={{
        // The card is absolutely positioned against the document body, so
        // viewport coordinates (clientX/clientY) need scroll offsets added.
        // Clamp so the 420px-wide card stays inside the visible area.
        left: `${Math.min(Math.max(position.x + window.scrollX, window.scrollX + 8), window.scrollX + Math.max(8, window.innerWidth - 440))}px`,
        top: `${Math.min(Math.max(position.y + 10 + window.scrollY, window.scrollY + 8), window.scrollY + Math.max(8, window.innerHeight - 380))}px`,
      }}
    >
      {resolvedMode === 'translate' ? (
        <TranslationCard
          sourceText={selectedText}
          translation={translation}
          loading={loading}
          sourceLang={detectedLang}
          targetLang={settings.defaultTargetLang || 'zh-CN'}
          settings={settings}
          note={modeNote}
          onClose={onClose}
        />
      ) : (
        <WordContextCard
          explanation={explanation}
          loading={loading}
          onClose={onClose}
          sentence={selectedText}
          settings={settings}
        />
      )}
    </div>
  );
};

let activeRootContainer: HTMLDivElement | null = null;
let reactRootInstance: any = null;
let activeFloatBtn: HTMLButtonElement | null = null;
let floatBtnHoverTimer: number | null = null;

// Cached settings so the sync mouseup/touchend handler can pick the
// word-hover mode without an async storage read on every click.
let currentSettings: AppSettings = DEFAULT_SETTINGS;
getSavedSettings().then((s) => {
  currentSettings = s;
});

// The popup/options page mirrors settings into chrome.storage.local as the
// user edits them. Refresh our cache on change so already-open pages pick up
// the new word-hover mode / input-field option immediately instead of waiting
// for a reload.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
    try {
      currentSettings = parseSavedSettings(changes[SETTINGS_STORAGE_KEY].newValue);
      // Keys live only in the background — keep the page context scrubbed.
      currentSettings = scrubApiKeys(currentSettings);
    } catch (e) {
      // ignore malformed writes
    }
  });
}

function removePopover() {
  removeFloatBtn();
  if (reactRootInstance) {
    reactRootInstance.unmount();
    reactRootInstance = null;
  }
  if (activeRootContainer) {
    activeRootContainer.remove();
    activeRootContainer = null;
  }
}

function removeFloatBtn() {
  if (floatBtnHoverTimer !== null) {
    window.clearTimeout(floatBtnHoverTimer);
    floatBtnHoverTimer = null;
  }
  if (activeFloatBtn) {
    activeFloatBtn.remove();
    activeFloatBtn = null;
  }
}

/**
 * Small floating "译" button shown next to a selection (click/hover modes,
 * borrowed from the NextAI Translator interaction model). Clicking or hovering
 * it opens the translation popover.
 */
function showFloatBtn(text: string, x: number, y: number, mode: 'click' | 'hover') {
  removeFloatBtn();

  const btn = document.createElement('button');
  btn.className = 'freetranslate-float-btn';
  btn.textContent = '译';
  btn.style.left = `${Math.min(x + 8, window.innerWidth - 64)}px`;
  btn.style.top = `${Math.max(8, y - 44)}px`;

  const open = () => {
    removeFloatBtn();
    showPopover(text, x, y);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  btn.addEventListener('touchend', (e) => {
    e.stopPropagation();
    open();
  });

  if (mode === 'hover') {
    btn.addEventListener('mouseenter', () => {
      floatBtnHoverTimer = window.setTimeout(open, 300);
    });
    btn.addEventListener('mouseleave', () => {
      if (floatBtnHoverTimer !== null) {
        window.clearTimeout(floatBtnHoverTimer);
        floatBtnHoverTimer = null;
      }
    });
  }

  document.body.appendChild(btn);
  activeFloatBtn = btn;
}

async function showPopover(text: string, x: number, y: number, mode: 'auto' | 'translate' | 'explain' = 'auto') {
  removePopover();

  const settings = await getSavedSettings();
  currentSettings = settings;

  activeRootContainer = document.createElement('div');
  activeRootContainer.className = 'freetranslate-host-reset';
  document.body.appendChild(activeRootContainer);

  reactRootInstance = createRoot(activeRootContainer);
  reactRootInstance.render(
    <SelectionPopover
      selectedText={text}
      position={{ x, y }}
      onClose={removePopover}
      settings={settings}
      mode={mode}
    />
  );
}

/** Reads the current selection, including inside input/textarea fields. */
function getSelectionFromEvent(e: MouseEvent | TouchEvent): { text: string; insideFormField: boolean } {
  const target = (e.target as HTMLElement) ?? null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const field = target as HTMLInputElement | HTMLTextAreaElement;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    return { text: field.value.substring(start, end).trim(), insideFormField: true };
  }
  return { text: window.getSelection()?.toString().trim() ?? '', insideFormField: false };
}

// Selection listener (mouse & touch) — three word-hover modes:
//  select: open the popover directly
//  click / hover: show a small floating button first
function handleSelectionEvent(e: MouseEvent | TouchEvent) {
  // Right-click opens the browser context menu (and possibly our own items) —
  // it must not also fire the selection popover / floating button.
  if (e instanceof MouseEvent && e.button !== 0) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest?.('.freetranslate-modal-card') || target?.closest?.('.freetranslate-float-btn')) {
    return;
  }

  const { text: selection, insideFormField } = getSelectionFromEvent(e);
  if (!selection || selection.length === 0 || selection.length >= 3000) return;

  if (insideFormField && !currentSettings.selectInputElementsText) {
    return;
  }

  const mode = currentSettings.wordHoverMode || 'click';
  // On touchend the touches list is empty; the lifted finger lives in changedTouches.
  const touch = e instanceof TouchEvent ? e.changedTouches[0] : null;
  const clientX = touch?.clientX ?? (e instanceof MouseEvent ? e.clientX : 0);
  const clientY = touch?.clientY ?? (e instanceof MouseEvent ? e.clientY : 0);

  if (mode === 'select') {
    showPopover(selection, clientX, clientY);
  } else {
    // The floating "译" button is a word-level affordance (deep-dive on a word
    // or short phrase). Longer selections (paragraphs) skip it — those translate
    // via right-click on the selection, the Alt+T shortcut, or "选中即翻译".
    const wordCount = selection.trim().split(/\s+/).length;
    if (wordCount > 8) return;
    showFloatBtn(selection, clientX, clientY, mode);
  }
}

document.addEventListener('mouseup', handleSelectionEvent);
document.addEventListener('touchend', handleSelectionEvent);

/** True when the viewport point (x, y) falls inside the current selection's
 * bounding box — used to decide whether a right-click on a selection should
 * translate directly instead of showing the browser's native menu. Uses the
 * union rect (not per-line glyph rects) so right-clicks in the inter-line gap
 * of a multi-line paragraph still count as "inside the selection". */
function isPointInSelection(x: number, y: number): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const m = 4;
  return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
}

// Right-click on an active selection translates immediately — the browser's
// native context menu (and our menu items) are skipped for that gesture, so a
// selected paragraph's translation pops up directly. Smart mode: a short word
// gets the deep-dive card, a longer selection gets the plain translation.
// Right-clicks outside a selection keep the native menu untouched.
//
// Registered in the CAPTURE phase: it runs before any page handler, so pages
// that stopPropagation() contextmenu (right-click-protected sites, custom
// menus) can't swallow it, and the native menu is reliably suppressed.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('.freetranslate-modal-card, .freetranslate-float-btn, .ftpt-toolbar, .ftpt-fab')) return;
  // Inside form fields / rich-text editors the native copy-paste menu matters
  // more than instant translation — leave those alone.
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

  const { text, insideFormField } = getSelectionFromEvent(e);
  if (insideFormField || !text || text.length === 0 || text.length >= 3000) return;
  if (!isPointInSelection(e.clientX, e.clientY)) return;

  // Suppress the native menu AND stop the page from reacting (e.g. opening its
  // own custom context menu) — we own this gesture on a selection now.
  e.preventDefault();
  e.stopPropagation();
  removeFloatBtn();
  showPopover(text, e.clientX, e.clientY, 'auto').catch((err) => {
    console.error('Right-click translation failed:', err);
  });
}, true);
// Hide the floating button when clicking elsewhere — but not when the click
// targets the button itself (otherwise its click handler never fires).
document.addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('.freetranslate-float-btn')) return;
  removeFloatBtn();
});
document.addEventListener('touchstart', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('.freetranslate-float-btn')) return;
  removeFloatBtn();
});

// Chrome extension context menu / keyboard shortcut listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'TRANSLATE_SELECTION' && message.text) {
      showPopover(message.text, window.innerWidth / 2 - 200, 100, 'translate');
    } else if (message.action === 'EXPLAIN_SELECTION' && message.text) {
      showPopover(message.text, window.innerWidth / 2 - 200, 100, 'explain');
    } else if (message.action === 'AUTO_SELECTION' && message.text) {
      showPopover(message.text, window.innerWidth / 2 - 200, 100, 'auto');
    } else if (message.action === 'REQUEST_SELECTION') {
      // Reply with the page's current selection so the background service
      // worker can translate it (used by the Alt+T keyboard shortcut).
      sendResponse({ text: window.getSelection()?.toString().trim() || '' });
      return true;
    }
  });
}

// Close the popover with Escape
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removePopover();
  }
});

// Whole-page bilingual translation + TTS reading toolbar (extension only).
initPageTranslate();
