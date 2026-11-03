# 语脉 YUMAI 隐私政策 / Privacy Policy

生效日期 / Effective: 2026-10-09

## 中文

语脉（YUMAI）是一款 Chrome 扩展，帮助你翻译和理解网页上选中的文字。开发者不运营任何接收你数据的服务器。

### 我们处理哪些数据
- **你要求翻译的文字**：你在网页上选中、或在扩展中输入并要求翻译、释义或朗读的文字。
- **你的设置和 API Key**：你选择的服务商、模型、你自己的 API Key、界面偏好。
- **翻译历史**：最近 50 条翻译记录。

### 数据存在哪里
设置、API Key 和翻译历史只保存在你本机浏览器的 `chrome.storage.local` 和 `localStorage` 中，不同步、不上传给开发者。API Key 只在扩展的后台 service worker 中使用，不会注入你浏览的网页。

### 数据发给谁
你要求翻译、释义或朗读时，相关文字会直接从你的浏览器发送给**你自己选择的服务商**，例如 Google Gemini、DeepSeek、阿里云通义、字节豆包、月之暗面 Kimi、MiniMax、Groq、OpenAI、Fish Audio，或你填写的自定义 OpenAI 兼容地址、本地 Ollama。这些服务商按各自的隐私政策处理数据。

选择"Google 翻译语音"朗读时，或使用"浏览器本地语音"而本机语音不可用时，扩展会将最多 200 个字符的文字发送到 Google 翻译的朗读接口（translate.google.com）以播放读音。

除此之外，扩展不会把你的文字发送到任何地方。

### 我们不做的事
- 不收集浏览记录、个人身份信息、位置或通讯内容。
- 不出售、不出租、不共享数据给第三方用于广告或其他目的。
- 不使用数据评估信用或用于与翻译无关的用途。
- 不加载或执行远程代码。

### 删除数据
在扩展设置中清空历史，或在 `chrome://extensions` 卸载扩展，即可删除本机保存的全部数据。

### 联系
问题或请求请在 GitHub 提交 issue：https://github.com/xiaobaoliu849/freeai-context-translator/issues ，或发邮件至 xiaobaoliu849@gmail.com。

## English

YUMAI is a Chrome extension that helps you translate and understand text you select on web pages. The developer runs no server that receives your data.

### Data we handle
- **Text you ask to translate**: text you select on a page or type into the extension and ask to translate, explain, or read aloud.
- **Your settings and API keys**: chosen provider, model, your own API keys, and interface preferences.
- **Translation history**: your last 50 translations.

### Where it is stored
Settings, API keys, and history stay on your device in the browser's `chrome.storage.local` and `localStorage`. They are not synced or uploaded to the developer. API keys are used only inside the extension's background service worker and are never injected into the pages you visit.

### Who receives it
When you ask for a translation, explanation, or read-aloud, the text is sent directly from your browser to **the provider you chose**, such as Google Gemini, DeepSeek, Alibaba Qwen, ByteDance Doubao, Moonshot Kimi, MiniMax, Groq, OpenAI, Fish Audio, a custom OpenAI-compatible endpoint you enter, or a local Ollama server. Each provider handles that data under its own privacy policy.

If you choose the "Google Translate voice" read-aloud option, or use the "browser voice" option when no local voice is available, the extension sends up to 200 characters of the text to Google Translate's speech endpoint (translate.google.com) to play the audio.

The extension sends your text nowhere else.

### What we don't do
- We don't collect browsing history, personal identifiers, location, or communications.
- We don't sell, rent, or share data with third parties for advertising or any other purpose.
- We don't use data for creditworthiness or anything unrelated to translation.
- We don't load or execute remote code.

### Deleting your data
Clear history in the extension's settings, or uninstall the extension at `chrome://extensions`, to remove everything stored on your device.

### Contact
Open an issue at https://github.com/xiaobaoliu849/freeai-context-translator/issues or email xiaobaoliu849@gmail.com.
