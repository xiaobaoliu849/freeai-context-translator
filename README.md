# FreeTranslate AI

Contextual AI Translator — 划词 AI 翻译与深度语境解析。

Web 应用 + Chrome 扩展（Manifest V3）双形态：翻译整段文本、划词弹出深度语境词典（CEFR 等级 / 词性 / 搭配 / 同义词 / 例句）、多引擎 TTS 朗读、流式打字机输出。

## 功能

- **多服务商**：Gemini、DeepSeek、通义 Qwen、豆包、Kimi、MiniMax、Groq、OpenAI、自定义 OpenAI 兼容 API（支持 Ollama）
- **流式翻译**：SSE 打字机效果，首字低延迟（服务器端 `/api/translate/stream`，扩展内走 background bridge）
- **划词三模式**：选中即译 / 小图标点击 / 小图标悬停；支持输入框内选区
- **深度语境解析**：逐词音标、词性、CEFR、语境含义、常用搭配、同义词、反义词、双语例句
- **多引擎 TTS**：Gemini Audio、OpenAI、MiniMax、通义 CosyVoice、豆包、Fish Audio、Edge（免 Key）、浏览器本地语音
- **历史记录**：最近 50 条，搜索、导出 JSON；设置与历史在扩展内同步到 `chrome.storage.local`

## 架构

```
server.ts                  Express + Vite：/api/translate(stream) /api/explain-word /api/tts /api/models
src/config.ts              共享服务商配置、语言列表、默认设置（web / content / server 三端共用）
src/services/prompts.ts    共享 LLM 提示词与 JSON 解析
src/services/aiProvider.ts 客户端 LLM 调用（网页模式兜底）
src/services/bridge.ts     扩展长连接 RPC 客户端（content script / popup → background）
src/services/backgroundBridge.ts  background 侧执行器：LLM 流式、TTS、模型列表（密钥只在 SW 内存）
src/content.tsx            划词弹窗（自包含 IIFE 构建，不含密钥）
```

扩展内的 LLM/TTS 请求全部通过 `chrome.runtime.connect` 长连接转发到 background service worker 执行，API Key 只存在于 service worker 与 `chrome.storage.local`，不进入页面上下文。

## 开发

```bash
npm install
# 设置 GEMINI_API_KEY（AI Studio 环境会自动注入，本地放入 .env）
npm run dev          # 本地开发服务器 http://localhost:3000
npm run lint         # tsc --noEmit
npm run build        # Web 产物 → dist-web/ + server.cjs
npm run build:ext    # Chrome 扩展 → dist/（popup + background + 自包含 content script）
npm start            # 生产模式启动（NODE_ENV=production）
```

## 安装扩展

1. `npm run build:ext` 生成 `dist/`
2. 打开 `chrome://extensions`，开启开发者模式
3. "加载已解压的扩展程序"，选择 `dist/` 目录
4. 首次加载后到 `chrome://extensions/shortcuts` 确认 `Alt+T` 快捷键绑定

## 服务商配置

在设置面板中为每个服务商配置 API Key / Base URL / 模型，支持"自动获取可用模型"（网页模式走服务器，扩展模式走 background bridge）。
