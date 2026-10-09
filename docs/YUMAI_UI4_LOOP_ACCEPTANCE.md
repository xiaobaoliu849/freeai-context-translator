# 语脉 YUMAI — UI 4.0 连续重构验收记录

> 基准分支：`design/yumai-ui4-popup-redesign`（PR #6）  
> 本轮增量：`feat/yumai-ui4-full-loop`（PR #7）  
> 原 `main` 保持原样，待增量审核后按 PR #6 → PR #7 顺序合并。

## 执行原则
每个阶段独立提交，构建/单测/截图在 GitHub CI 中自动运行。
视觉截图来自真实 headless Chrome 对实际 React 组件的渲染；模拟翻译使用固定公开样例，不调用 AI、不收集用户 API Key。

## Phase 1 — 视觉设计系统 ✅
- `src/styles/yumai-tokens.css` 将设计变量集中管理：深靛蓝、暖白、墨蓝灰、语义状态色。
- 共用统一字阶、正文行高、圆角、控件焦点和减少动态效果偏好。
- Popup、完整网页和 Shadow DOM 内的浮窗共享 CSS 变量，不污染宿主页面。

## Phase 2 — Popup ✅
- 统一输入/译文字体和密度；短词、短句、长文根据长度调整默认上下比例。
- 译文独立滚动，保留可拖动的分隔线。
- 操作成功/失败与实际浏览器剪贴板结果一致。

## Phase 3 — Reading Workspace ✅
- 完整标签页获得独立 2.5 栏阅读布局，不再是放大版 Popup。
- 左栏：新建、历史、设置。中栏：原文/译文。右栏：原文段落导航。
- 点击某个段落单独翻译；原文整篇保持不变；保留原来的模型及历史管理。
- “新建翻译”取消旧请求并清空上一条原文和译文。

## Phase 4 — Context Overlay ✅（组件截图）
- 划词浮窗中句子/长文本优先呈现简短原文上下文、译文；完整编辑器可手动展开。
- 单词直接展示语境词典，并把更多搭配/例句交给按需展开。
- 网页文字上下文继续经过原有 Chrome 背景桥接调用；没有改动扩展通信标识。
- CI 有真实 Header + WordContextCard 的组件级截图，但真实宿主网页的注入和拖动仍需手工测试。

## Phase 5 — 设置和历史 ✅
- 设置分类使用具名 Tab 和 aria 语义；常规云服务商默认收起高级 API URL。
- API Key 的提示不再把 Gemini 一概描述为免 Key；仍保留用户已配置的自定义 URL。
- 历史正文与译文提升字体可读性，支持键盘展开、Esc 关闭和焦点恢复。
- 清空历史之前明确二次确认；存储键及导入导出格式保持不变。

## Phase 6 — 无障碍和键盘 ✅
- Popup 上下分隔线使用上下方向键微调，Home 恢复智能比例。
- 桌面左右分隔线支持左右方向键，Home 恢复 1:1。
- 设置和历史弹窗阻止焦点逸出，关闭后尝试还原焦点。
- prefers-reduced-motion 用户不被强制展示持续动效。

## Phase 7 — CI 截图、验收与交付
CI 工作流：
1. `npm ci`
2. `npm run lint` (TypeScript)
3. `npm run test:ui` (智能划词多语言)
4. `npm run build` + `npm run build:ext`
5. 检查 Chrome Manifest V3 内容脚本和服务端产物
6. Headless Chrome 渲染及行为断言，生成如下截图：
   - `yumai-popup-empty.png`
   - `yumai-popup-with-text.png`
   - `yumai-popup-demo-translation.png`
   - `yumai-settings-panel.png`
   - `yumai-history-drawer.png`
   - `yumai-workspace-1440.png`
   - `yumai-workspace-selected-paragraph.png`
   - `yumai-workspace-new-document.png`
   - `yumai-overlay-component-1100.png`
7. 上传 `yumai-ui4-popup-screenshots` GitHub Actions Artifact，保留 14 天。

自动化断言：
- Popup 可挂载，输入与读取一致；模拟翻译在实际 React 组件出现。
- 设置和历史面板能够打开、存在必要的语义角色。
- Workspace 生成原文导航、能翻译全文及所选段落。
- 点击段落后仍完整保留原文；新建文档清空原文与旧翻译。
- Overlay 的真实词典组件可以在 CI 专用页面渲染。

## 手工验收边界（不能由 CI 代替）
- Windows 实际 Chrome 扩展加载/卸载/重新加载、网页划词触发与定位、Pin/Drag/Esc。
- 不同网站的 Shadow DOM/CSP、放大倍率以及与网页自身脚本的冲突。
- 用真实 API Key 的流式响应、多提供商翻译、TTS 发声与中断。
- 用户个人设置及旧历史升级回归（代码保持键名，但不可在 CI 用用户真实数据测试）。

## 合并策略
- 先在 PR #6 合并已通过的基础 UI 4.0 到 `main`。
- PR #7 目标暂为 PR #6 的分支；#6 合并后将 #7 重新指向 `main`。
- 只有 PR #7 在最终目标分支上 CI 通过后才考虑合并发布。
- 自动截图不是设计师主观认可；对截图发现的问题继续迭代。
