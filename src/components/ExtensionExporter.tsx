import React, { useState } from 'react';
import JSZip from 'jszip';
import { Download, Check, Sparkles, FolderArchive, Layers, FileCode } from 'lucide-react';
import { AppSettings } from '../types';

interface ExtensionExporterProps {
  settings: AppSettings;
}

export const ExtensionExporter: React.FC<ExtensionExporterProps> = ({ settings }) => {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const generateZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();

      // 1. manifest.json
      const manifest = {
        manifest_version: 3,
        name: "FreeTranslate",
        version: "1.0.0",
        description: "Free AI Translator extension with in-context word breakdown and TTS audio.",
        permissions: ["activeTab", "contextMenus", "storage", "scripting", "tts"],
        action: {
          default_popup: "popup.html"
        },
        background: {
          service_worker: "background.js"
        },
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["content.js"],
            css: ["content.css"]
          }
        ],
        options_page: "options.html",
        host_permissions: ["https://*/*", "http://*/*"]
      };

      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // 1b. content.css
      const contentCss = `
/* FreeTranslate Content Script Styles */
.freetranslate-popover {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  box-sizing: border-box !important;
  user-select: none !important;
  transition: all 0.15s ease-in-out !important;
}
.freetranslate-popover:hover {
  transform: translateY(-2px) scale(1.02);
}
`;
      zip.file("content.css", contentCss);

      // 2. background.js
      const backgroundJs = `
// Background Service Worker for FreeTranslate
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "freetranslate-explain",
    title: "✨ 划词 AI 翻译与深度语境解析",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "freetranslate-explain" && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "EXPLAIN_SELECTION",
      text: info.selectionText
    });
  }
});
`;
      zip.file("background.js", backgroundJs);

      // 3. content.js
      const contentJs = `
// FreeTranslate Content Script
let activeFloatBtn = null;
let activeModalCard = null;

document.addEventListener("mouseup", (e) => {
  if (e.target.closest && (e.target.closest(".freetranslate-float-btn") || e.target.closest(".freetranslate-modal-card"))) {
    return;
  }

  const selectedText = window.getSelection()?.toString().trim();
  if (selectedText && selectedText.length > 0 && selectedText.length < 3000) {
    showFloatingButton(selectedText, e.clientX, e.clientY);
  } else {
    removeFloatingButton();
  }
});

function removeFloatingButton() {
  if (activeFloatBtn) {
    activeFloatBtn.remove();
    activeFloatBtn = null;
  }
}

function showFloatingButton(text, x, y) {
  removeFloatingButton();

  const btn = document.createElement("div");
  btn.className = "freetranslate-float-btn";
  btn.style.left = \`\${Math.min(x, window.innerWidth - 130)}px\`;
  btn.style.top = \`\${Math.max(10, y - 45)}px\`;
  btn.innerHTML = \`<span>✨ 翻译 / 语境解析</span>\`;

  btn.onclick = (e) => {
    e.stopPropagation();
    removeFloatingButton();
    translateAndShowModal(text, x, y);
  };

  document.body.appendChild(btn);
  activeFloatBtn = btn;
}

async function translateAndShowModal(text, x, y) {
  if (activeModalCard) activeModalCard.remove();

  const modal = document.createElement("div");
  modal.className = "freetranslate-modal-card";
  modal.style.left = \`\${Math.min(Math.max(10, x - 190), window.innerWidth - 400)}px\`;
  modal.style.top = \`\${Math.min(y + 15, window.innerHeight - 340)}px\`;

  modal.innerHTML = \`
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:8px; margin-bottom:10px;">
      <div style="font-weight:800; color:#4f46e5; font-size:13px; display:flex; align-items:center; gap:6px;">
        <span style="background:#4f46e5; color:white; border-radius:4px; padding:2px 6px; font-size:10px;">AI</span>
        <span>FreeTranslate</span>
      </div>
      <button id="ft-close" style="background:none; border:none; cursor:pointer; font-size:16px; color:#94a3b8; padding:2px 6px;">✕</button>
    </div>
    <div style="font-size:11px; color:#64748b; margin-bottom:4px; font-weight:700;">原文:</div>
    <div style="font-size:12px; color:#334155; background:#f8fafc; padding:8px 10px; border-radius:8px; margin-bottom:10px; max-height:70px; overflow-y:auto; border:1px solid #e2e8f0; word-break:break-word;">\${escapeHtml(text)}</div>
    <div style="font-size:11px; color:#64748b; margin-bottom:4px; font-weight:700;">AI 翻译与语境释义:</div>
    <div id="ft-res" style="font-size:13px; color:#0f172a; font-weight:600; line-height:1.5; background:#e0e7ff; padding:10px 12px; border-radius:8px; border:1px solid #c7d2fe; min-height:50px;">
      ⏳ 正在智能解析中...
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
      <button id="ft-speak" style="background:#f1f5f9; border:none; border-radius:6px; padding:4px 8px; font-size:11px; cursor:pointer; color:#475569; font-weight:600;">🔊 朗读</button>
      <button id="ft-copy" style="background:#f1f5f9; border:none; border-radius:6px; padding:4px 8px; font-size:11px; cursor:pointer; color:#475569; font-weight:600;">📋 复制</button>
    </div>
  \`;

  document.body.appendChild(modal);
  activeModalCard = modal;

  modal.querySelector("#ft-close").onclick = () => modal.remove();

  modal.querySelector("#ft-speak").onclick = () => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  };

  chrome.storage.sync.get(["apiServerUrl", "targetLang", "provider", "model", "apiKey"], async (config) => {
    const serverUrl = config.apiServerUrl || "https://ais-dev-epkuaozwr3kkhsnut4pzkx-599306852030.asia-east1.run.app";
    const targetLang = config.targetLang || "zh-CN";

    try {
      const res = await fetch(\`\${serverUrl}/api/translate\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          targetLang,
          provider: config.provider || "gemini",
          model: config.model || "gemini-2.5-flash",
          apiKey: config.apiKey || ""
        })
      });
      const data = await res.json();
      const outputEl = modal.querySelector("#ft-res");
      if (data.translation) {
        outputEl.innerText = data.translation;
        modal.querySelector("#ft-copy").onclick = () => {
          navigator.clipboard.writeText(data.translation);
          modal.querySelector("#ft-copy").innerText = "✓ 已复制";
        };
      } else if (data.error) {
        outputEl.innerText = "翻译失败: " + data.error;
      }
    } catch (err) {
      const outputEl = modal.querySelector("#ft-res");
      if (outputEl) outputEl.innerText = "网络请求失败，请在扩展配置中确认服务器链接。";
    }
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === "EXPLAIN_SELECTION" && req.text) {
    translateAndShowModal(req.text, window.innerWidth / 2 - 180, 100);
  }
});
`;
      zip.file("content.js", contentJs);

      // 4. popup.html
      const popupHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FreeTranslate AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 420px;
      padding: 16px;
      background-color: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-logo {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 13px;
    }
    .brand-title {
      font-weight: 800;
      font-size: 15px;
      color: #0f172a;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      background: #e0e7ff;
      color: #4338ca;
      border-radius: 10px;
      text-transform: uppercase;
      margin-left: 4px;
    }
    .tabs {
      display: flex;
      background: #e2e8f0;
      padding: 3px;
      border-radius: 10px;
      margin-bottom: 12px;
      gap: 2px;
    }
    .tab-btn {
      flex: 1;
      padding: 6px 0;
      text-align: center;
      border: none;
      background: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn.active {
      background: white;
      color: #4f46e5;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .engine-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      background: white;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      align-items: center;
    }
    .engine-bar select {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 11px;
      font-weight: 600;
      color: #1e293b;
      background: #f8fafc;
      outline: none;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .toolbar select {
      flex: 1;
      padding: 7px 8px;
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #1e293b;
      outline: none;
      cursor: pointer;
    }
    .swap-btn {
      padding: 6px 8px;
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      color: #64748b;
    }
    .swap-btn:hover { color: #4f46e5; border-color: #818cf8; }
    .box-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    textarea {
      width: 100%;
      height: 85px;
      border: none;
      outline: none;
      resize: none;
      font-size: 13px;
      color: #0f172a;
      font-family: inherit;
      line-height: 1.5;
    }
    textarea::placeholder { color: #94a3b8; }
    .box-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid #f1f5f9;
      font-size: 11px;
      color: #64748b;
    }
    .action-icon {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .action-icon:hover { background: #f1f5f9; color: #0f172a; }
    .btn-primary {
      width: 100%;
      padding: 10px;
      background: linear-gradient(135deg, #4f46e5, #6366f1);
      color: white;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
      transition: all 0.15s;
      margin-bottom: 12px;
    }
    .btn-primary:hover { opacity: 0.95; }
    .output-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      min-height: 90px;
    }
    .output-text {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      line-height: 1.5;
      min-height: 50px;
      word-break: break-word;
    }
    .dict-card {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px;
      line-height: 1.6;
    }
    .dict-pos {
      display: inline-block;
      background: #e0e7ff;
      color: #4338ca;
      font-size: 10px;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 4px;
      margin-right: 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="brand-logo">FT</div>
      <div>
        <span class="brand-title">FreeTranslate</span>
        <span class="badge" id="engineBadge">GEMINI</span>
      </div>
    </div>
    <button class="action-icon" id="openSettingsBtn" style="font-size:12px; border:1px solid #cbd5e1; padding:4px 8px; border-radius:6px;">⚙️ 高级配置</button>
  </div>

  <div class="tabs">
    <button class="tab-btn active" id="tabTranslate">⚡ 智能翻译</button>
    <button class="tab-btn" id="tabDict">📖 深度语境词典</button>
  </div>

  <div class="engine-bar">
    <span style="font-size:11px; font-weight:700; color:#475569;">AI 服务商:</span>
    <select id="quickProvider" style="flex:1;">
      <option value="gemini">Google Gemini AI</option>
      <option value="deepseek">DeepSeek AI</option>
      <option value="openai">OpenAI (GPT-4o)</option>
      <option value="claude">Anthropic Claude</option>
      <option value="ollama">Ollama (本地)</option>
    </select>
    <select id="quickModel" style="flex:1;">
      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
    </select>
  </div>

  <!-- VIEW 1: TRANSLATE -->
  <div id="viewTranslate">
    <div class="toolbar">
      <select id="sourceLang">
        <option value="auto">Auto (自动检测)</option>
        <option value="en">English (英语)</option>
        <option value="zh-CN">Chinese (中文)</option>
        <option value="ja">Japanese (日语)</option>
        <option value="ko">Korean (韩语)</option>
        <option value="fr">French (法语)</option>
        <option value="de">German (德语)</option>
        <option value="es">Spanish (西班牙语)</option>
      </select>
      <button class="swap-btn" id="swapBtn">⇆</button>
      <select id="targetLang">
        <option value="zh-CN">Chinese (中文)</option>
        <option value="en">English (英语)</option>
        <option value="ja">Japanese (日语)</option>
        <option value="ko">Korean (韩语)</option>
        <option value="fr">French (法语)</option>
        <option value="de">German (德语)</option>
        <option value="es">Spanish (西班牙语)</option>
      </select>
    </div>

    <div class="box-card">
      <textarea id="srcInput" placeholder="输入或粘贴文本...（支持快捷键 Ctrl+Enter 发送）"></textarea>
      <div class="box-footer">
        <span id="charCount">0 / 5000</span>
        <div>
          <button class="action-icon" id="playSrcBtn">🔊 朗读</button>
          <button class="action-icon" id="clearBtn">🗑️ 清空</button>
        </div>
      </div>
    </div>

    <button class="btn-primary" id="transBtn">✨ 立即 AI 翻译 (Ctrl+Enter)</button>

    <div class="output-card">
      <div class="output-text" id="output">译文将显示在这里...</div>
      <div class="box-footer">
        <span style="font-size:10px; color:#94a3b8;">选中文本浮窗原位解析</span>
        <div>
          <button class="action-icon" id="playTgtBtn">🔊 朗读</button>
          <button class="action-icon" id="copyTgtBtn">📋 复制</button>
        </div>
      </div>
    </div>
  </div>

  <!-- VIEW 2: DICTIONARY -->
  <div id="viewDict" style="display:none;">
    <div class="box-card">
      <input type="text" id="dictInput" placeholder="输入需要深度解析的词汇或短语..." style="width:100%; border:none; outline:none; font-size:13px; font-weight:600; padding:4px 0;" />
    </div>
    <button class="btn-primary" id="dictBtn">📖 深度剖析词汇 (语境 + 常用搭配)</button>

    <div class="dict-card" id="dictOutput">
      <div style="color:#64748b; font-size:12px; text-align:center; padding:20px 0;">输入单词点击“深度剖析”，获取完整语境用法与专业释义</div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>`;
      zip.file("popup.html", popupHtml);

      // 5. popup.js
      const popupJs = `
document.addEventListener("DOMContentLoaded", () => {
  const srcInput = document.getElementById('srcInput');
  const output = document.getElementById('output');
  const transBtn = document.getElementById('transBtn');
  const sourceLang = document.getElementById('sourceLang');
  const targetLang = document.getElementById('targetLang');
  const swapBtn = document.getElementById('swapBtn');
  const charCount = document.getElementById('charCount');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const playSrcBtn = document.getElementById('playSrcBtn');
  const playTgtBtn = document.getElementById('playTgtBtn');
  const copyTgtBtn = document.getElementById('copyTgtBtn');
  const clearBtn = document.getElementById('clearBtn');
  const quickProvider = document.getElementById('quickProvider');
  const quickModel = document.getElementById('quickModel');
  const engineBadge = document.getElementById('engineBadge');

  const tabTranslate = document.getElementById('tabTranslate');
  const tabDict = document.getElementById('tabDict');
  const viewTranslate = document.getElementById('viewTranslate');
  const viewDict = document.getElementById('viewDict');
  const dictInput = document.getElementById('dictInput');
  const dictBtn = document.getElementById('dictBtn');
  const dictOutput = document.getElementById('dictOutput');

  const modelsByProvider = {
    gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    claude: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    ollama: ['llama3.2', 'qwen2.5']
  };

  function updateModelOptions(providerVal, selectedModel) {
    quickModel.innerHTML = '';
    const models = modelsByProvider[providerVal] || [providerVal];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.innerText = m;
      if (m === selectedModel) opt.selected = true;
      quickModel.appendChild(opt);
    });
  }

  chrome.storage.sync.get(["sourceLang", "targetLang", "provider", "model"], (saved) => {
    if (saved.sourceLang) sourceLang.value = saved.sourceLang;
    if (saved.targetLang) targetLang.value = saved.targetLang;
    const p = saved.provider || 'gemini';
    quickProvider.value = p;
    engineBadge.innerText = p.toUpperCase();
    updateModelOptions(p, saved.model);
  });

  quickProvider.onchange = () => {
    const p = quickProvider.value;
    engineBadge.innerText = p.toUpperCase();
    updateModelOptions(p);
    chrome.storage.sync.set({ provider: p, model: quickModel.value });
  };

  quickModel.onchange = () => {
    chrome.storage.sync.set({ model: quickModel.value });
  };

  // Tab Switching
  tabTranslate.onclick = () => {
    tabTranslate.classList.add('active');
    tabDict.classList.remove('active');
    viewTranslate.style.display = 'block';
    viewDict.style.display = 'none';
  };

  tabDict.onclick = () => {
    tabDict.classList.add('active');
    tabTranslate.classList.remove('active');
    viewDict.style.display = 'block';
    viewTranslate.style.display = 'none';
  };

  srcInput.oninput = () => {
    charCount.innerText = \`\${srcInput.value.length} / 5000\`;
  };

  swapBtn.onclick = () => {
    if (sourceLang.value !== 'auto') {
      const tmp = sourceLang.value;
      sourceLang.value = targetLang.value;
      targetLang.value = tmp;
    }
  };

  openSettingsBtn.onclick = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  };

  clearBtn.onclick = () => {
    srcInput.value = '';
    output.innerText = '译文将显示在这里...';
    charCount.innerText = '0 / 5000';
  };

  playSrcBtn.onclick = () => {
    if (srcInput.value.trim()) speak(srcInput.value, sourceLang.value);
  };

  playTgtBtn.onclick = () => {
    if (output.innerText.trim()) speak(output.innerText, targetLang.value);
  };

  copyTgtBtn.onclick = () => {
    if (output.innerText.trim()) {
      navigator.clipboard.writeText(output.innerText);
      copyTgtBtn.innerText = "✓ 已复制";
      setTimeout(() => copyTgtBtn.innerText = "📋 复制", 2000);
    }
  };

  function speak(text, lang) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (lang && lang !== 'auto') u.lang = lang;
    window.speechSynthesis.speak(u);
  }

  async function handleTranslate() {
    const text = srcInput.value.trim();
    if (!text) return;

    output.innerText = "✨ AI 智能翻译中...";

    chrome.storage.sync.get(["apiServerUrl", "provider", "model", "apiKey"], async (config) => {
      const serverUrl = config.apiServerUrl || "https://ais-dev-epkuaozwr3kkhsnut4pzkx-599306852030.asia-east1.run.app";

      try {
        const res = await fetch(\`\${serverUrl}/api/translate\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            sourceLang: sourceLang.value,
            targetLang: targetLang.value,
            provider: quickProvider.value || "gemini",
            model: quickModel.value || "gemini-2.5-flash",
            apiKey: config.apiKey || ""
          })
        });

        const data = await res.json();
        if (data.translation) {
          output.innerText = data.translation;
        } else if (data.error) {
          output.innerText = "翻译失败: " + data.error;
        }
      } catch (err) {
        output.innerText = "请求超时或网络失败，请检查设置中的服务器链接。";
      }
    });
  }

  transBtn.onclick = handleTranslate;

  srcInput.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleTranslate();
    }
  };

  dictBtn.onclick = async () => {
    const text = dictInput.value.trim();
    if (!text) return;

    dictOutput.innerHTML = '<div style="color:#4f46e5; text-align:center; padding:15px; font-weight:bold;">✨ AI 正在深度剖析语境与同义词...</div>';

    chrome.storage.sync.get(["apiServerUrl", "provider", "model", "apiKey"], async (config) => {
      const serverUrl = config.apiServerUrl || "https://ais-dev-epkuaozwr3kkhsnut4pzkx-599306852030.asia-east1.run.app";

      try {
        const res = await fetch(\`\${serverUrl}/api/explain\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            targetLang: targetLang.value,
            provider: quickProvider.value || "gemini",
            model: quickModel.value || "gemini-2.5-flash",
            apiKey: config.apiKey || ""
          })
        });

        const data = await res.json();
        if (data.analysis) {
          const a = data.analysis;
          dictOutput.innerHTML = \`
            <div style="font-size:16px; font-weight:800; color:#0f172a; margin-bottom:4px;">\${a.word || text} <span style="font-size:12px; color:#64748b; font-weight:400;">\${a.phonetic || ''}</span></div>
            <div style="margin-bottom:8px;"><span class="dict-pos">\${a.partOfSpeech || '释义'}</span><span style="font-weight:700; color:#334155;">\${a.meaning || ''}</span></div>
            <div style="font-size:11px; font-weight:700; color:#64748b; margin-top:8px;">常用语境搭配 (Collocations):</div>
            <ul style="padding-left:16px; font-size:12px; color:#334155; margin-bottom:8px;">
              \${(a.collocations || []).map(c => \`<li>\${c}</li>\`).join('')}
            </ul>
            <div style="font-size:11px; font-weight:700; color:#64748b;">例句 (Examples):</div>
            <div style="font-size:12px; color:#1e293b; background:#f8fafc; padding:6px; border-radius:6px; margin-top:4px;">
              \${(a.examples || []).map(e => \`<div style="margin-bottom:4px;">• \${e}</div>\`).join('')}
            </div>
          \`;
        } else {
          dictOutput.innerText = "解析失败: " + (data.error || '未知错误');
        }
      } catch (e) {
        dictOutput.innerText = "网络异常或服务未响应。";
      }
    });
  };
});
`;
      zip.file("popup.js", popupJs);

      // 6. options.html
      const optionsHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FreeTranslate Extension Settings</title>
  <style>
    body {
      max-width: 620px;
      margin: 40px auto;
      padding: 24px;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.03);
    }
    h1 { font-size: 20px; color: #4f46e5; margin-bottom: 20px; font-weight: 800; display:flex; align-items:center; gap:8px; }
    .form-group { margin-bottom: 18px; }
    label { font-size: 13px; font-weight: 700; color: #334155; display: block; margin-bottom: 6px; }
    input, select {
      width: 100%;
      padding: 10px 12px;
      background: #f8fafc;
      color: #0f172a;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 13px;
      box-sizing: border-box;
      outline: none;
    }
    input:focus, select:focus { border-color: #6366f1; background: white; }
    .hint { font-size: 11px; color: #64748b; margin-top: 4px; }
    button {
      padding: 12px 28px;
      background: linear-gradient(135deg, #4f46e5, #6366f1);
      color: white;
      border: none;
      border-radius: 10px;
      font-weight: bold;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(79,70,229,0.2);
    }
    button:hover { opacity: 0.95; }
    .status { margin-top: 14px; font-size: 13px; font-weight: bold; color: #059669; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚙️ FreeTranslate 插件完整全功能配置</h1>

    <div class="form-group">
      <label>默认 AI 服务商 (AI Engine Provider)</label>
      <select id="provider">
        <option value="gemini">Google Gemini AI (默认推荐 - 免费高速)</option>
        <option value="deepseek">DeepSeek AI (深度求索)</option>
        <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
        <option value="claude">Anthropic Claude 3.5</option>
        <option value="ollama">Ollama (本地私有大模型)</option>
      </select>
    </div>

    <div class="form-group">
      <label>模型选择 (Model Name)</label>
      <input type="text" id="model" placeholder="例如: gemini-2.5-flash 或 deepseek-chat">
      <div class="hint">可自定义填入特定模型版本，例如: gemini-2.5-flash, deepseek-chat, gpt-4o</div>
    </div>

    <div class="form-group">
      <label>自定义 API Key (可选)</label>
      <input type="password" id="apiKey" placeholder="输入对应服务商 API Key（留空则使用默认 Cloud 代理）">
    </div>

    <div class="form-group">
      <label>后端 API 服务代理地址 (API Server Base URL)</label>
      <input type="text" id="apiServerUrl" value="https://ais-dev-epkuaozwr3kkhsnut4pzkx-599306852030.asia-east1.run.app">
      <div class="hint">当前连接云端全功能后端 API 服务接口</div>
    </div>

    <div class="form-group">
      <label>默认目标语言 (Target Language)</label>
      <select id="targetLang">
        <option value="zh-CN">中文 (Chinese - Simplified)</option>
        <option value="en">英文 (English)</option>
        <option value="ja">日文 (Japanese)</option>
        <option value="ko">韩文 (Korean)</option>
        <option value="fr">法文 (French)</option>
        <option value="de">德文 (German)</option>
        <option value="es">西班牙文 (Spanish)</option>
      </select>
    </div>

    <button id="saveBtn">保存配置</button>
    <div class="status" id="status"></div>
  </div>
  <script src="options.js"></script>
</body>
</html>`;
      zip.file("options.html", optionsHtml);

      // 7. options.js
      const optionsJs = `
document.addEventListener("DOMContentLoaded", () => {
  const provider = document.getElementById('provider');
  const model = document.getElementById('model');
  const apiKey = document.getElementById('apiKey');
  const apiServerUrl = document.getElementById('apiServerUrl');
  const targetLang = document.getElementById('targetLang');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  chrome.storage.sync.get(["provider", "model", "apiKey", "apiServerUrl", "targetLang"], (saved) => {
    if (saved.provider) provider.value = saved.provider;
    if (saved.model) model.value = saved.model;
    if (saved.apiKey) apiKey.value = saved.apiKey;
    if (saved.apiServerUrl) apiServerUrl.value = saved.apiServerUrl;
    if (saved.targetLang) targetLang.value = saved.targetLang;
  });

  saveBtn.onclick = () => {
    chrome.storage.sync.set({
      provider: provider.value,
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
      apiServerUrl: apiServerUrl.value.trim(),
      targetLang: targetLang.value
    }, () => {
      status.innerText = "✓ 扩展配置保存成功！";
      setTimeout(() => status.innerText = "", 3000);
    });
  };
});
`;
      zip.file("options.js", optionsJs);

      // 8. README.md
      const readme = `# FreeTranslate Chrome Extension

## 插件介绍:
FreeTranslate 是一款全功能 AI 划词翻译与深度语境词典插件，支持 Google Gemini, DeepSeek, OpenAI 等多种 AI 引擎。

## 快速安装方法 (Chrome / Edge / Brave):

1. 解压 \`FreeTranslate-Chrome-Extension.zip\` 到本地电脑。
2. 打开 Chrome 浏览器，在地址栏输入 \`chrome://extensions/\` 并回车。
3. 开启右上角的 **“开发者模式” (Developer mode)** 开关。
4. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)**。
5. **关键步骤：** 在弹出的文件选择框中，**选中并打开解压出来的文件夹（即打开内部能直接看到 manifest.json 的那层文件夹）**，点击“选择文件夹”即可成功加载！
`;
      zip.file("README.md", readme);

      // Generate base64 data URI & trigger download for maximum iframe compatibility
      const base64 = await zip.generateAsync({ type: 'base64' });
      const dataUrl = `data:application/zip;base64,${base64}`;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'FreeTranslate-Chrome-Extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 4000);
    } catch (err: any) {
      console.error('Failed to generate zip:', err);
      alert('下载插件 ZIP 失败: ' + (err?.message || err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Clean Export Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-xs space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 font-bold">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-slate-900">
                Download Chrome Extension Package
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Export Manifest V3 source files (popup, sidebar, content script) as a ready-to-install ZIP archive.
              </p>
            </div>
          </div>

          <button
            onClick={generateZip}
            disabled={downloading}
            className="w-full md:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-extrabold text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
          >
            {downloaded ? (
              <>
                <Check className="w-4 h-4 text-emerald-200" />
                <span>Downloaded Zip!</span>
              </>
            ) : downloading ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin text-indigo-200" />
                <span>Packing Extension...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>下载 Chrome 插件包 (.ZIP)</span>
              </>
            )}
          </button>
        </div>

        {/* Platform Source Notice */}
        <div className="bg-rose-50 border border-rose-200/80 rounded-xl p-3.5 text-xs text-rose-900 flex items-start gap-2.5">
          <span className="font-bold shrink-0 text-rose-600 text-sm">💡 关键区别:</span>
          <p className="leading-relaxed">
            你之前解压的 <code className="bg-white/80 px-1 py-0.5 rounded border border-rose-200 font-mono text-rose-800">nextai-context-translator</code>（包含 package.json, server.ts）是<strong>本 AI Studio 系统的网页源代码导出包</strong>。
            <br />
            如需安装 Chrome 插件，<strong>请务必点击上方紫色的【下载 Chrome 插件包 (.ZIP)】按钮</strong>，下载生成的 <code className="bg-white/80 px-1 py-0.5 rounded border border-rose-200 font-mono font-bold text-indigo-700">FreeTranslate-Chrome-Extension.zip</code>！
          </p>
        </div>

        {/* Installation & Troubleshooting Steps */}
        <div className="space-y-4 text-xs text-slate-600">
          <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-4 space-y-2">
            <span className="font-bold text-indigo-900 text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              正确安装步骤（避免“Manifest 缺失/无法读取”报错）：
            </span>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-700 leading-relaxed font-medium">
              <li>下载 <code className="text-indigo-700 bg-white border border-indigo-200 px-1.5 py-0.5 rounded font-mono font-bold">FreeTranslate-Chrome-Extension.zip</code> 压缩包到本地。</li>
              <li>右键该 ZIP 文件，选择 <strong>“解压到当前文件夹”</strong>（或使用 WinRAR / 7-Zip 解压）。</li>
              <li>打开 Chrome 浏览器，在地址栏输入 <code className="text-indigo-700 bg-white border border-indigo-200 px-1.5 py-0.5 rounded font-mono font-bold">chrome://extensions/</code> 并按回车。</li>
              <li>右上角开启 <strong>“开发者模式 (Developer mode)”</strong> 开关。</li>
              <li>点击左上角 <strong>“加载已解压的扩展程序 (Load unpacked)”</strong> 按钮。</li>
              <li><strong className="text-rose-600">关键步骤：</strong>选择解压出来的文件夹，必须确保<strong>打开该文件夹能直接看到 <code className="text-rose-700 bg-white border border-rose-200 px-1 py-0.5 rounded font-mono">manifest.json</code></strong>（不能选择 Zip 压缩包本身，也不要选错外层嵌套文件夹）。</li>
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200/90 rounded-xl p-4 text-amber-900 space-y-1.5">
            <span className="font-bold text-amber-900 text-xs flex items-center gap-1.5">
              ⚠️ 如果提示 "Manifest file is missing or unreadable" 或 "Could not load manifest"：
            </span>
            <p className="text-amber-800 leading-relaxed">
              原因是你直接选择了压缩包 ZIP，或者解压时系统多包了一层同名文件夹（例如 <code className="font-mono bg-white/80 px-1 rounded">F:\下载\FreeTranslate-Chrome-Extension\FreeTranslate-Chrome-Extension\</code>）。
              请在“加载已解压的扩展程序”选择框中，**点击进入到内部直接能看见 <code className="font-mono bg-white/80 px-1 rounded">manifest.json</code> 的那层文件夹**，然后点击“选择文件夹”即可成功加载！
            </p>
          </div>

          <div className="bg-slate-900 text-slate-200 rounded-xl p-4 font-mono text-[11px] space-y-2">
            <span className="text-slate-400 font-sans font-bold text-xs uppercase tracking-wider block">
              📁 正确的扩展程序目录结构 (Directory Structure):
            </span>
            <pre className="text-emerald-400 leading-snug">
{`FreeTranslate-Chrome-Extension/   <-- 【选此层文件夹】
├── manifest.json                <-- Manifest V3 配置
├── background.js                <-- 右键菜单 & 后台服务
├── content.js                   <-- 划词高亮 & 悬浮 AI 按钮
├── content.css                  <-- 悬浮窗样式
├── popup.html                   <-- 插件弹窗 UI
├── popup.js                     <-- 插件弹窗脚本
├── options.html                 <-- 设置页面
└── options.js`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
