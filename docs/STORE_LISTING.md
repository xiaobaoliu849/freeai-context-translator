# Chrome 网上应用店 · 商品详情

素材在 `store/`，由 `npm run store:assets` 从真实界面截图合成（需先跑 `build`、`build:ext`、`scripts/capture-yumai-preview.mjs`、`scripts/check-floating-layout.mjs`）。

| 字段 | 文件 / 内容 |
| --- | --- |
| 商店图标 128×128 | `store/store-icon-128.png`（96px 主体 + 16px 透明边距） |
| 屏幕截图 1280×800 | `store/screenshot-1-selection-dictionary.png` … `screenshot-4-providers.png`，按序号上传 |
| 小型宣传图 440×280 | `store/promo-small-440x280.png` |
| 类别 | 工具 / Tools（备选：教育 / Education） |
| 语言 | 中文（简体），另加 English 本地化 |
| 隐私政策 | https://github.com/xiaobaoliu849/freeai-context-translator/blob/main/PRIVACY.md |
| 权限说明 | 见 `docs/CHROME_STORE_PERMISSIONS.md` |

## 中文（简体）

**名称**：语脉 · YUMAI

**简短说明**（manifest description，≤132 字符）：
读懂文字，更懂语境。AI 语境翻译、划词释义、自然朗读与多模型支持。

**详细说明**：

语脉是一款为阅读而生的 AI 翻译扩展。它不只是把句子换一种语言，而是告诉你一个词在这句话里到底是什么意思。

【划词即懂】
在任意网页选中一个词，弹出语境词典：句中含义、为什么是这个意思、通用释义、音标、词性、CEFR 等级、常用搭配、同义词与双语例句。选中一句话或一段文字，则直接给出流畅译文。

【长文对照阅读】
在阅读工作台粘贴整篇文章，原文与译文左右对照；段落导航可以只翻译你选中的部分，不会打乱原文。

【随手翻译】
工具栏弹窗、右键菜单"语脉 · 翻译选中文本"、快捷键 Alt + T，三种方式随时调用。译文流式输出，首字即现。

【自选模型，用你自己的 Key】
支持 Google Gemini、DeepSeek、通义千问、豆包、Kimi、MiniMax、Groq、OpenAI，以及任意 OpenAI 兼容接口和本地 Ollama 模型。

【自然朗读】
浏览器本地语音免 Key 可用；也可选择 Gemini、OpenAI、MiniMax、通义 CosyVoice、豆包、Fish Audio 等语音。

【隐私】
设置、API Key 和翻译历史只保存在你的浏览器里。你要求翻译的文字只发送给你自己选择的服务商。没有开发者服务器，不收集浏览记录，不投放广告。

使用前需要在设置中填写所选服务商的 API Key（本地 Ollama 无需 Key）。

## English

**Name**: YUMAI · Context-aware AI Translator

**Short description** (≤132 chars):
Understand words in context. AI translation, select-to-explain dictionary, natural read-aloud, and your choice of AI model.

**Detailed description**:

YUMAI is an AI translation extension built for reading. Beyond translating a sentence, it tells you what a word means in the sentence you're reading.

SELECT TO UNDERSTAND
Select a word on any page to open a context dictionary: its meaning in this sentence, why it means that, the general sense, pronunciation, part of speech, CEFR level, collocations, synonyms and bilingual examples. Select a sentence or paragraph to get a fluent translation.

SIDE-BY-SIDE READING
Paste a whole article into the reading workspace to read source and translation side by side. Paragraph navigation translates just the part you pick.

TRANSLATE ANYWHERE
Use the toolbar popup, the right-click menu, or Alt + T. Translations stream in as they are generated.

YOUR MODEL, YOUR KEY
Works with Google Gemini, DeepSeek, Qwen, Doubao, Kimi, MiniMax, Groq, OpenAI, any OpenAI-compatible endpoint, and local Ollama models.

NATURAL READ-ALOUD
The browser's built-in voice works with no key, or choose Gemini, OpenAI, MiniMax, Qwen CosyVoice, Doubao or Fish Audio voices.

PRIVACY
Settings, API keys and history stay in your browser. Text you ask to translate goes only to the provider you chose. There is no developer server, no browsing-history collection, and no ads.

You'll need an API key for the provider you choose (local Ollama needs none).
