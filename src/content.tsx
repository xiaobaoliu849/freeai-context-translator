import React, { useState, useEffect, useRef } from 'react';
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

import { TranslatorMain } from './components/TranslatorMain';
import { SUPPORTED_LANGUAGES } from './config';
import { Pin, X } from 'lucide-react';

interface SelectionPopoverProps {
  selectedText: string;
  position: { x: number; y: number };
  onClose: () => void;
  settings: AppSettings;
}

const SelectionPopover: React.FC<SelectionPopoverProps> = ({ selectedText, position, onClose, settings }) => {
  const [currentText, setCurrentText] = useState(selectedText || '');
  const [srcLang, setSrcLang] = useState(settings.defaultSourceLang || 'auto');
  const [tgtLang, setTgtLang] = useState(settings.defaultTargetLang || 'zh-CN');
  const [retranslateSignal, setRetranslateSignal] = useState(1);
  const [isPinned, setIsPinned] = useState(false);

  // Position state (absolute document coordinates)
  const [pos, setPos] = useState(() => ({
    x: Math.min(Math.max(position.x + window.scrollX, window.scrollX + 8), window.scrollX + Math.max(8, window.innerWidth - 490)),
    y: Math.min(Math.max(position.y + 10 + window.scrollY, window.scrollY + 8), window.scrollY + Math.max(8, window.innerHeight - 440)),
  }));

  const cardRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });

  // Handle Dragging
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only drag with left click and ignore button clicks
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, select, input, textarea')) return;

    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: pos.x,
      initY: pos.y,
    };

    const handlePointerMove = (moveEv: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEv.clientX - dragStartRef.current.startX;
      const dy = moveEv.clientY - dragStartRef.current.startY;
      const nextX = Math.max(window.scrollX + 8, Math.min(window.scrollX + window.innerWidth - 320, dragStartRef.current.initX + dx));
      const nextY = Math.max(window.scrollY + 8, dragStartRef.current.initY + dy);
      setPos({ x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleSwapLanguages = () => {
    const prevSrc = srcLang;
    setSrcLang(tgtLang);
    setTgtLang(prevSrc === 'auto' ? 'zh-CN' : prevSrc);
  };

  const handleSaveHistory = (item: { sourceText: string; translation: string; sourceLang: string; targetLang: string }) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get('freetranslate_history', (res) => {
          const prev = res.freetranslate_history || [];
          const next = [{ ...item, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: Date.now() }, ...prev].slice(0, 100);
          chrome.storage.local.set({ freetranslate_history: next });
        });
      }
    } catch (e) {}
  };

  // Close on outside click if NOT pinned
  useEffect(() => {
    if (isPinned) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      const card = cardRef.current;
      if (card && !card.contains(e.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick);
    }, 150);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isPinned, onClose]);

  const activeProvider = (settings.defaultProvider || 'gemini').toUpperCase();

  return (
    <div
      ref={cardRef}
      className="freetranslate-modal-card"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <div className="w-full h-full bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Top Accent Gradient Bar */}
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />

        {/* Draggable Title Header */}
        <div
          onPointerDown={handleDragStart}
          className="px-3 py-2 bg-slate-50/95 border-b border-slate-200/80 flex items-center justify-between cursor-move select-none shrink-0"
          title="按住拖拽移动悬浮窗"
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-[10px] shadow-xs">
              FT
            </div>
            <span className="text-xs font-black text-slate-800 tracking-tight">FreeTranslate AI</span>
            <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[9px] font-extrabold tracking-wide uppercase">
              {activeProvider}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPinned(!isPinned)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                isPinned
                  ? 'bg-indigo-100 text-indigo-700 font-bold'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/60'
              }`}
              title={isPinned ? '已钉住（点击取消固定）' : '钉住悬浮窗（防止点击页面空白处自动关闭）'}
            >
              <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-indigo-600 rotate-45' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Studio Body: TranslatorMain */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-2.5 bg-slate-50/30">
          <TranslatorMain
            sourceText={currentText}
            setSourceText={setCurrentText}
            sourceLang={srcLang}
            setSourceLang={setSrcLang}
            targetLang={tgtLang}
            setTargetLang={setTgtLang}
            onSwapLanguages={handleSwapLanguages}
            languages={SUPPORTED_LANGUAGES}
            settings={settings}
            onSaveHistory={handleSaveHistory}
            openSettings={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
                chrome.runtime.openOptionsPage();
              }
            }}
            openHistory={() => {}}
            retranslateSignal={retranslateSignal}
            isPopup={true}
          />
        </div>
      </div>
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

// Selection listener (mouse & touch) — word-hover modes:
//  select: open the popover directly
//  click / hover: show a small floating button first
//  off: do not show any floating icon
function handleSelectionEvent(e: MouseEvent | TouchEvent) {
  // Right-click opens the browser context menu — do not show floating button
  if (e instanceof MouseEvent && e.button !== 0) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest?.('.freetranslate-modal-card') || target?.closest?.('.freetranslate-float-btn')) {
    return;
  }

  const { text: selection, insideFormField } = getSelectionFromEvent(e);
  if (!selection || selection.length === 0 || selection.length >= 3000) {
    removeFloatBtn();
    return;
  }

  if (insideFormField && !currentSettings.selectInputElementsText) {
    removeFloatBtn();
    return;
  }

  const mode = currentSettings.wordHoverMode || 'click';
  if (mode === 'off') {
    removeFloatBtn();
    return;
  }

  // On touchend the touches list is empty; the lifted finger lives in changedTouches.
  const touch = e instanceof TouchEvent ? e.changedTouches[0] : null;
  const clientX = touch?.clientX ?? (e instanceof MouseEvent ? e.clientX : 0);
  const clientY = touch?.clientY ?? (e instanceof MouseEvent ? e.clientY : 0);

  if (mode === 'select') {
    showPopover(selection, clientX, clientY);
  } else {
    // Floating "译" button for word or short selections
    const wordCount = selection.trim().split(/\s+/).length;
    if (wordCount > 15) return;
    showFloatBtn(selection, clientX, clientY, mode);
  }
}

document.addEventListener('mouseup', handleSelectionEvent);
document.addEventListener('touchend', handleSelectionEvent);

// Hide the floating button when clicking elsewhere or scrolling
document.addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('.freetranslate-float-btn')) return;
  removeFloatBtn();
});
document.addEventListener('touchstart', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('.freetranslate-float-btn')) return;
  removeFloatBtn();
});
window.addEventListener('scroll', () => {
  removeFloatBtn();
}, { passive: true });

let lastContextMenuPos = { x: Math.max(12, window.innerWidth / 2 - 220), y: Math.max(12, window.innerHeight / 3) };
document.addEventListener('contextmenu', (e) => {
  lastContextMenuPos = { x: e.clientX, y: e.clientY };
}, true);

function getSelectionPosition(): { x: number; y: number } {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return {
        x: Math.max(12, Math.min(rect.left, window.innerWidth - 460)),
        y: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 200)),
      };
    }
  }
  return {
    x: Math.max(12, Math.min(lastContextMenuPos.x, window.innerWidth - 460)),
    y: Math.max(12, Math.min(lastContextMenuPos.y + 8, window.innerHeight - 200)),
  };
}

// Chrome extension context menu / keyboard shortcut listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'TRANSLATE_SELECTION') {
      removeFloatBtn();
      const pos = getSelectionPosition();
      showPopover(message.text || '', pos.x, pos.y, 'translate');
    } else if (message.action === 'EXPLAIN_SELECTION' && message.text) {
      removeFloatBtn();
      const pos = getSelectionPosition();
      showPopover(message.text, pos.x, pos.y, 'explain');
    } else if (message.action === 'AUTO_SELECTION') {
      removeFloatBtn();
      const pos = getSelectionPosition();
      showPopover(message.text || '', pos.x, pos.y, 'auto');
    } else if (message.action === 'REQUEST_SELECTION') {
      // Reply with the page's current selection so popup or background can translate it
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
