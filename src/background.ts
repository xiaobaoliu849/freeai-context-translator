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
      contexts: ['selection', 'page'],
    });
  });
}

async function setupOllamaOriginRule() {
  if (!chrome.declarativeNetRequest) return;
  const RULE_LOCAL = 11434;
  const RULE_IP = 11435;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_LOCAL, RULE_IP],
      addRules: [
        {
          id: RULE_LOCAL,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Origin',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: 'http://localhost',
              },
            ],
          },
          condition: {
            urlFilter: '||localhost:11434/',
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
        {
          id: RULE_IP,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Origin',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: 'http://127.0.0.1',
              },
            ],
          },
          condition: {
            urlFilter: '||127.0.0.1:11434/',
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
      ],
    });
  } catch (err) {
    console.warn('Could not setup declarativeNetRequest rules for Ollama:', err);
  }
}

// Ensure rules are set on load
setupOllamaOriginRule();

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  setupOllamaOriginRule();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenu();
  setupOllamaOriginRule();
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
  if (!tab?.id) return;
  if (info.menuItemId === 'freetranslate-translate' || info.menuItemId === 'nextai-translate') {
    const text = info.selectionText || '';
    sendOrInject(tab.id, { action: 'TRANSLATE_SELECTION', text });
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
