# Chrome 网上应用店 · 权限说明

提交审核时，"隐私权规范"页的 *Single purpose* 与 *Permission justification* 字段可直接复制下面的中英文。
`src/manifest.test.ts` 会检查本文件覆盖 manifest 中声明的每一项权限，且每项权限在源码中确有调用。

## 单一用途 / Single purpose

语脉在用户浏览的网页上，为用户选中的文字提供 AI 语境翻译、划词释义和朗读。

YUMAI translates and explains text the user selects on any web page, using the AI provider the user configures, and can read it aloud.

## 权限 / Permissions

| 权限 | 中文说明 | English justification |
| --- | --- | --- |
| `contextMenus` | 右键菜单"语脉 · 翻译选中文本"。 | Adds the right-click item "Translate selection" so users can translate highlighted text. |
| `storage` | 在本地保存设置、用户自己的 API Key 和最近 50 条翻译历史，不上传。 | Stores settings, the user's own API keys and the last 50 translations locally in chrome.storage.local. Nothing is synced to a developer server. |
| `scripting` | 扩展安装或更新前已打开的标签页没有内容脚本时，按用户操作（右键菜单或 Alt+T）补注入，使划词立即可用。 | When the user invokes the context menu or Alt+T on a tab opened before install or update, injects the bundled content script so translation works without reloading the page. Only the packaged content.js is injected; no remote code. |
| `declarativeNetRequest` | 仅为 localhost:11434 / 127.0.0.1:11434 的请求设置 Origin 头，使本地 Ollama 模型可用。不拦截、不修改其他任何网站的请求。 | Sets the Origin header only on requests to localhost:11434 and 127.0.0.1:11434 so a local Ollama model accepts them. No other site's traffic is blocked, redirected or modified. |
| `host_permissions` | 内容脚本需在用户阅读的任意网页上响应划词；后台需直接请求用户选择的 AI / TTS 服务商（Gemini、DeepSeek、通义、豆包、Kimi、OpenAI 等）以及用户自填的 OpenAI 兼容地址或本地 Ollama。 | The selection popup must work on whatever page the user is reading, and the background worker calls the AI and TTS provider the user chooses, including a custom OpenAI-compatible endpoint or a local Ollama server whose address the user enters. Requests go only to the provider the user configured. |

## 远程代码 / Remote code

不使用远程代码。所有脚本都打包在扩展内。

No remote code. All JavaScript ships inside the package.

## 数据使用 / Data usage

- 收集：用户主动选中或输入、要求翻译的文字（"网站内容"）。
- 用途：仅发送给用户自己配置的 AI 服务商以生成翻译、释义或语音。
- 不出售、不用于广告、不用于与单一用途无关的目的；开发者没有服务器接收这些数据。

## 移除的权限

- `activeTab`：已由全站点访问覆盖，冗余。
- `tts`：朗读使用 `window.speechSynthesis` 和网络 TTS，从未调用 `chrome.tts`。
