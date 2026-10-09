/**
 * Compose Chrome Web Store assets from the real UI screenshots that
 * capture-yumai-preview.mjs and check-floating-layout.mjs write to preview/.
 *
 *   npm run build && npm run build:ext
 *   node scripts/capture-yumai-preview.mjs
 *   node scripts/check-floating-layout.mjs
 *   node scripts/build-store-assets.mjs        # → store/
 *
 * Output: four 1280x800 screenshots, a 440x280 small promo tile and a padded 128x128 store icon.
 * Set CHROME_PATH if Chrome is not on PATH. Node 22 built-ins only.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('../store/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAVY = '#1e2d55';
const INK = '#26324a';
const MUTED = '#5b6680';
const PAPER = '#f7f5ef';
const FONT = `"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif`;

const img = async (rel) => 'data:image/png;base64,' + (await readFile(new URL(rel, ROOT))).toString('base64');
const mark = 'data:image/svg+xml;base64,' + (await readFile(new URL('public/assets/yumai-mark.svg', ROOT))).toString('base64');

function frame({ kicker, title, body, shot, shotWidth, layout = 'side', crop }) {
  const text = `
    <div class="copy">
      <div class="brand"><img src="${mark}" alt=""><span>语脉 · YUMAI</span></div>
      <div class="kicker">${kicker}</div>
      <h1>${title}</h1>
      <p>${body}</p>
    </div>`;
  // crop = {x, y, width, height} in source pixels: show only that part (e.g. a dialog without its scrim).
  const picture = crop
    ? `<div class="shot"><div class="crop" style="width:${crop.width}px;height:${crop.height}px"><img src="${shot}" style="width:${shotWidth}px;margin:-${crop.y}px 0 0 -${crop.x}px;border:0;border-radius:0;box-shadow:none" alt=""></div></div>`
    : `<div class="shot"><img src="${shot}" style="width:${shotWidth}px" alt=""></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:1280px;height:800px;overflow:hidden}
    body{background:${PAPER};font-family:${FONT};color:${INK};display:flex;align-items:center;
      ${layout === 'top' ? 'flex-direction:column;justify-content:flex-start;padding:48px 64px 0;gap:28px' : 'gap:56px;padding:0 72px'}}
    .copy{${layout === 'top' ? 'width:100%;display:grid;grid-template-columns:auto 1fr;column-gap:40px;align-items:end' : 'flex:0 0 400px'}}
    .brand{display:flex;align-items:center;gap:10px;font-weight:700;color:${NAVY};font-size:18px;letter-spacing:.04em;
      ${layout === 'top' ? 'grid-column:1/3;margin-bottom:14px' : 'margin-bottom:36px'}}
    .brand img{width:34px;height:34px}
    .kicker{color:${MUTED};font-size:18px;font-weight:600;letter-spacing:.08em;margin-bottom:12px;${layout === 'top' ? 'display:none' : ''}}
    h1{color:${NAVY};font-size:${layout === 'top' ? 40 : 46}px;line-height:1.25;font-weight:800;letter-spacing:.01em}
    p{color:${MUTED};font-size:20px;line-height:1.7;${layout === 'top' ? '' : 'margin-top:22px'}}
    .shot{flex:1;display:flex;justify-content:center;${layout === 'top' ? 'align-items:flex-start' : 'align-items:center'}}
    .shot img{display:block;border-radius:${layout === 'top' ? '14px 14px 0 0' : '16px'};
      box-shadow:0 1px 2px rgba(30,45,85,.08),0 24px 60px -18px rgba(30,45,85,.32);border:1px solid #e3e1da}
    .crop{overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 1px 2px rgba(30,45,85,.08),0 24px 60px -18px rgba(30,45,85,.32)}
  </style></head><body>${layout === 'top' ? text + picture : text + picture}</body></html>`;
}

function promo() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:440px;height:280px;overflow:hidden}
    body{background:${NAVY};font-family:${FONT};color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 40px}
    .row{display:flex;align-items:center;gap:14px}
    .row img{width:56px;height:56px;border-radius:14px;background:${PAPER};padding:6px}
    h1{font-size:38px;font-weight:800;letter-spacing:.04em}
    small{display:block;font-size:13px;letter-spacing:.3em;opacity:.7;margin-top:2px}
    p{margin-top:22px;font-size:20px;font-weight:600;color:#e9e6dc}
    span{display:block;margin-top:6px;font-size:14px;opacity:.75}
  </style></head><body>
    <div class="row"><img src="${mark}" alt=""><div><h1>语脉</h1><small>YUMAI</small></div></div>
    <p>读懂文字，更懂语境。</p>
    <span>划词 AI 翻译 · 语境释义 · 多模型</span>
  </body></html>`;
}

const pages = [
  {
    file: 'screenshot-1-selection-dictionary.png', width: 1280, height: 800,
    html: frame({
      kicker: '划词释义', title: '选中一个词，<br>读懂它的语境含义',
      body: '语境含义、为什么是这个意思、音标、词性、CEFR 等级，一张卡片说清楚。',
      shot: await img('preview/yumai-floating-dictionary-card.png'), shotWidth: 560,
    }),
  },
  {
    file: 'screenshot-2-reading-workspace.png', width: 1280, height: 800,
    html: frame({
      layout: 'top', kicker: '长文阅读', title: '长文对照阅读，段落一键跳转',
      body: '原文译文左右对照，<br>段落导航只译你选中的部分。',
      shot: await img('preview/yumai-workspace-1440.png'), shotWidth: 1152,
    }),
  },
  {
    file: 'screenshot-3-toolbar-popup.png', width: 1280, height: 800,
    html: frame({
      kicker: '随手翻译', title: '工具栏一点，<br>整段流式翻译',
      body: '自动识别语言，Ctrl + Enter 即译，还能朗读和复制。快捷键 Alt + T 翻译网页选区。',
      shot: await img('preview/yumai-popup-demo-translation.png'), shotWidth: 560,
    }),
  },
  {
    file: 'screenshot-4-providers.png', width: 1280, height: 800,
    html: frame({
      kicker: '自选模型', title: '用你自己的 Key，<br>选你信任的模型',
      body: 'Gemini、DeepSeek、通义、豆包、Kimi、OpenAI、本地 Ollama 等。API Key 只保存在你的浏览器里。',
      shot: await img('preview/yumai-settings-panel.png'), shotWidth: 560,
      crop: { x: 17, y: 25, width: 526, height: 545 },
    }),
  },
  { file: 'promo-small-440x280.png', width: 440, height: 280, html: promo() },
  // Store icon: 96x96 artwork centred in 128x128 with 16px transparent padding, per Chrome Web Store image guidelines.
  {
    file: 'store-icon-128.png', width: 128, height: 128, transparent: true,
    html: `<!doctype html><html><head><style>html,body{margin:0;width:128px;height:128px;background:transparent}img{display:block;width:96px;height:96px;margin:16px}</style></head><body><img src="${mark}" alt=""></body></html>`,
  },
];

const profile = await mkdtemp(join(tmpdir(), 'yumai-store-'));
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--disable-dev-shm-usage',
  '--remote-debugging-port=9233', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9233/json/list')).json()).find((t) => t.type === 'page'); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Page.enable');
  await mkdir(OUT, { recursive: true });
  for (const p of pages) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: 1, mobile: false });
    await cmd('Emulation.setDefaultBackgroundColorOverride', p.transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
    const { frameTree } = await cmd('Page.getFrameTree');
    await cmd('Page.setDocumentContent', { frameId: frameTree.frame.id, html: p.html });
    await cmd('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode())))', awaitPromise: true });
    await sleep(150);
    const shot = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: p.width, height: p.height, scale: 1 } });
    await writeFile(new URL(p.file, OUT), Buffer.from(shot.data, 'base64'));
    console.log('wrote store/' + p.file);
  }
} finally {
  ws?.close();
  chrome.kill('SIGTERM');
}
