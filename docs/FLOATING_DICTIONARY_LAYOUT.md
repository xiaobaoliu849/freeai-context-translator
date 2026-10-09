# 划词词典布局修复

本轮修复针对网页内词典窗口信息被裁切、按钮出现浏览器默认粗边框，以及较长词性说明挤占阅读空间的问题。

## 原因与改动

- 浮窗原为 460×590，而内部 App 使用 `h-screen`，按宿主网页的整个视口计算高度。外层 `overflow: hidden` 会裁掉内部底部。现在 App 跟随浮窗实际可用高度，词典正文使用单独的滚动区域。
- Shadow DOM 没有网页入口的 Tailwind preflight。补充仅作用于 `.yumai-app` 的基础重置，并明确 theme/base/components/utilities 层顺序，避免重置覆盖工具类。宿主网页的按钮、文字与边距保持原样。
- 浮窗主题使用像素单位的间距和正文字号，避免宿主网页自定义根字号放大控件。浏览器自身缩放仍然生效。
- 默认窗口为 560×720，可展开至 820×900，实际大小始终受视口减去四周 12px 限制。支持右下角调整大小、拖动标题栏移动，以及窗口变化后的重新定位。
- 单词与操作按钮独立成行；音标、完整词性、CEFR 和不同于当前词的原形另行排列。
- 首先显示句中含义，其后为语境辨析和通用释义。原文语境可展开完整阅读，并标记当前词。搭配、近义表达、反义表达和例句按需展开；内容不被删除或省略。
- 新增扩展 `workspace.html`，工具栏的独立标签页按钮打开真正的阅读工作台。

## 验证

常规检查：

```sh
npm run lint
npm run test:ui
npm run build
npm run build:ext
```

Chrome 布局回归（无需 AI 请求、密钥或个人数据）：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/check-floating-layout.mjs
```

Linux 默认使用 PATH 中的 `google-chrome`。GitHub PR CI 自动执行该脚本并保存截图。

脚本注入真实构建的 `content.js`，使用真实 Shadow DOM 和真实 React App；仅替换 Chrome 存储及后台桥接为固定公开样例。检查：

- 宿主根字号为 24px、按钮有 5px 边框时，浮窗字号、边距和按钮仍正确，宿主样式不变。
- 390×480、640×360、853×600（1.5 倍显示密度）视口下没有水平溢出，正文底部位于可见窗口内。
- 可以滚动到最后一条例句、完整展开原文、展开或恢复窗口、用原生调整大小手柄改变尺寸、编辑选中文本。
- 固定窗口后点击页面仍保留窗口，Escape 关闭；工具栏 popup 与整页 workspace 分别挂载对应布局。

截图和测量结果保存在 `preview/`，该目录不进入版本控制。真实 API、TTS 及不同网站的扩展权限仍需要实际安装后验证。
