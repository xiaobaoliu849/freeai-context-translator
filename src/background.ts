// Service Worker for FreeTranslate Chrome Extension
import { handleBridgePort } from './services/backgroundBridge';

// Long-lived bridge: content script & popup route LLM/TTS work here so API
// keys never enter page context. Keys are read from chrome.storage.local here.
chrome.runtime.onConnect.addListener(handleBridgePort);

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'freetranslate-translate',
      title: 'FreeTranslate AI',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenu();
});

function sendOrInject(tabId: number, message: any) {
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      // Content script may not be injected on tabs opened before extension reload
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: ['content.js'],
        },
        () => {
          if (!chrome.runtime.lastError) {
            chrome.tabs.sendMessage(tabId, message);
          }
        }
      );
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText || !tab?.id) return;
  if (info.menuItemId === 'freetranslate-translate' || info.menuItemId === 'nextai-translate') {
    sendOrInject(tab.id, { action: 'TRANSLATE_SELECTION', text: info.selectionText });
  }
});

// Alt+T (or user-assigned shortcut): ask the page's content script for current selection
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-selection' || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_SELECTION' }, (response) => {
    const text = response?.text?.trim();
    if (text) {
      sendOrInject(tab.id!, { action: 'AUTO_SELECTION', text });
    }
  });
});
