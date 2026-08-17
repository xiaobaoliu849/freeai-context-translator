// Service Worker for FreeTranslate Chrome Extension
import { handleBridgePort } from './services/backgroundBridge';

// Long-lived bridge: content script & popup route LLM/TTS work here so API
// keys never enter page context. Keys are read from chrome.storage.local here.
chrome.runtime.onConnect.addListener(handleBridgePort);

chrome.runtime.onInstalled.addListener(() => {
  // Remove old menus first so re-installs/updates don't throw duplicate-id errors.
  chrome.contextMenus.removeAll(() => {
    // Right-click directly on a selection is intercepted by the content script
    // for an instant translation popup (no menu at all). This item is only a
    // fallback — e.g. right-click outside the selected text, or pages where
    // the interception can't run. Word deep-dive stays reachable via Alt+T and
    // the selection popup's smart mode (short word → analysis, longer → text).
    chrome.contextMenus.create({
      id: 'freetranslate-translate',
      title: '翻译选中文本',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText || !tab?.id) return;
  if (info.menuItemId === 'freetranslate-translate') {
    chrome.tabs.sendMessage(tab.id, { action: 'TRANSLATE_SELECTION', text: info.selectionText });
  }
});

// Alt+T (or the user-assigned shortcut): ask the page's content script for the
// current selection, then open the popover. Smart mode: a short selection gets
// the word deep-dive, a longer one gets a plain translation.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-selection' || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_SELECTION' }, (response) => {
    const text = response?.text?.trim();
    if (text) {
      chrome.tabs.sendMessage(tab.id, { action: 'AUTO_SELECTION', text });
    }
  });
});
