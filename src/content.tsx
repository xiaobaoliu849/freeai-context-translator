import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DEFAULT_SETTINGS, parseSavedSettings } from './config';
import { AppSettings } from './types';
import { initPageTranslate } from './pageTranslate';
import './content.css';

const SETTINGS_STORAGE_KEY = 'freetranslate_settings';

/**
 * Reads saved settings from chrome.storage.local (extension) or localStorage.
 */
async function getSavedSettings(): Promise<AppSettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
      if (result[SETTINGS_STORAGE_KEY]) {
        return parseSavedSettings(result[SETTINGS_STORAGE_KEY]);
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
}

const SelectionPopover: React.FC<SelectionPopoverProps> = ({
  selectedText,
  position,
  onClose,
  settings,
}) => {
  const [isPinned, setIsPinned] = useState(false);

  // Position state (absolute document coordinates, clamped within visible viewport)
  const [pos, setPos] = useState(() => ({
    x: Math.min(Math.max(position.x + window.scrollX, window.scrollX + 8), window.scrollX + Math.max(8, window.innerWidth - 460)),
    y: Math.min(Math.max(position.y + 10 + window.scrollY, window.scrollY + 8), window.scrollY + Math.max(8, window.innerHeight - 590)),
  }));

  const cardRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: pos.x,
    initY: pos.y,
  });

  // Handle Dragging
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, select, input, textarea, a')) return;

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

  return (
    <div
      ref={cardRef}
      className="freetranslate-modal-card"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <App
        initialText={selectedText}
        initialSettings={settings}
        isFloating={true}
        isPinned={isPinned}
        onTogglePin={() => setIsPinned((prev) => !prev)}
        onClose={onClose}
        onDragStart={handleDragStart}
      />
    </div>
  );
};

let activeRootContainer: HTMLDivElement | null = null;
let reactRootInstance: any = null;
let activeFloatBtn: HTMLButtonElement | null = null;
let floatBtnHoverTimer: number | null = null;

let currentSettings: AppSettings = DEFAULT_SETTINGS;
getSavedSettings().then((s) => {
  currentSettings = s;
});

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
    try {
      currentSettings = parseSavedSettings(changes[SETTINGS_STORAGE_KEY].newValue);
    } catch (e) {
      // ignore
    }
  });
}

function removePopover() {
  removeFloatBtn();
  if (reactRootInstance) {
    try {
      reactRootInstance.unmount();
    } catch (e) {}
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

async function showPopover(text: string, x: number, y: number) {
  removePopover();

  const settings = await getSavedSettings();
  currentSettings = settings;

  activeRootContainer = document.createElement('div');
  activeRootContainer.id = 'freetranslate-host-container';
  activeRootContainer.style.cssText = 'all: initial; position: absolute; z-index: 2147483647; top: 0; left: 0; pointer-events: none;';
  document.body.appendChild(activeRootContainer);

  const mountPoint = document.createElement('div');
  mountPoint.style.cssText = 'pointer-events: auto;';
  activeRootContainer.appendChild(mountPoint);

  reactRootInstance = createRoot(mountPoint);
  reactRootInstance.render(
    <SelectionPopover
      selectedText={text}
      position={{ x, y }}
      onClose={removePopover}
      settings={settings}
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

// Selection listener (mouse & touch)
function handleSelectionEvent(e: MouseEvent | TouchEvent) {
  // Right-click opens the browser context menu — do not show floating button
  if (e instanceof MouseEvent && e.button !== 0) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest?.('.freetranslate-modal-card') || target?.closest?.('.freetranslate-float-btn')) {
    return;
  }

  const { text: selection, insideFormField } = getSelectionFromEvent(e);
  if (!selection || selection.length === 0 || selection.length >= 5000) {
    removeFloatBtn();
    return;
  }

  if (insideFormField && !currentSettings.selectInputElementsText) {
    removeFloatBtn();
    return;
  }

  const mode = currentSettings.wordHoverMode || 'off';
  if (mode === 'off') {
    removeFloatBtn();
    return;
  }

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
    if (message.action === 'TRANSLATE_SELECTION' || message.action === 'AUTO_SELECTION' || message.action === 'EXPLAIN_SELECTION') {
      removeFloatBtn();
      const pos = getSelectionPosition();
      showPopover(message.text || '', pos.x, pos.y);
    } else if (message.action === 'REQUEST_SELECTION') {
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
