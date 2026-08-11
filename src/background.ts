// Service Worker for FreeTranslate Chrome Extension
import { handleBridgePort } from './services/backgroundBridge';

// Long-lived bridge: content script & popup route LLM/TTS work here so API
// keys never enter page context. Keys are read from chrome.storage.local here.
chrome.runtime.onConnect.addListener(handleBridgePort);

chrome.runtime.onInstalled.addListener(() => {
  // Remove old menus first so re-installs/updates don't throw duplicate-id errors.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'freetranslate-explain',
      title: '✨ 划词 AI 翻译与深度解析',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'freetranslate-explain' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'EXPLAIN_SELECTION',
      text: info.selectionText,
    });
  }
});

// Alt+T (or the user-assigned shortcut): ask the page's content script for the
// current selection, then open the translation popover with it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-selection' || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_SELECTION' }, (response) => {
    const text = response?.text?.trim();
    if (text) {
      chrome.tabs.sendMessage(tab.id, { action: 'EXPLAIN_SELECTION', text });
    }
  });
});
