/** Real content bundle + Shadow DOM regression checks. No AI calls or user data.
 * Run after npm run build:ext. Set CHROME_PATH if Chrome is not on PATH. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const host = `<!doctype html><html><head><meta charset="utf-8"><style>
  html { font-size: 24px; } body { margin: 0; background: #edf1f6; color: #24344d; font: 18px/1.8 system-ui; }
  article { max-width: 840px; margin: 60px auto; padding: 32px; background: white; border-radius: 16px; }
  h1 { font-size: 30px; } button { border: 5px solid red; padding: 24px; }
</style></head><body><article><h1>Reading in context</h1><p id="sample">AMIE is a research system people can chat with before doctors evaluate it in a real clinic.</p>
<button id="host-button">Host page button</button></article></body></html>`;
const sample = {
  word: 'research', phonetic: '/rɪˈsɜːtʃ/', pos: 'Noun (used as an attributive modifier)', cefrLevel: 'B1',
  contextualMeaning: 'Experimental or developmental; referring to a system created for scientific study and evaluation rather than for immediate commercial deployment.',
  contextExplanation: '这里的 research 修饰 system，表示仍用于科学研究和评估的实验性系统，而非已经正式投入临床使用的商业产品。',
  literalMeaning: '研究；调查。作修饰语时表示用于研究或处于研究阶段。',
  collocations: ['research system', 'clinical research', 'research and development'],
  synonymsInContext: ['experimental', 'investigational'], antonyms: ['commercial', 'production-ready'],
  examples: Array.from({ length: 6 }, (_, i) => ({ source: `This research system is evaluated by clinicians. Example ${i + 1}.`, target: `临床医生正在评估这个研究系统。例句 ${i + 1}。` })),
};
const server = createServer(async (req, res) => {
  if (req.url === '/host.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(host); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!/^\/(content\.(js|css)|(?:popup|workspace)\.html|assets\/[\w.-]+)$/.test(pathname)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(join(root, 'dist', pathname.slice(1)));
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(pathname)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'yumai-floating-check-'));
const browser = spawn(process.env.CHROME_PATH || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let launchError;
browser.on('error', err => { launchError = err; });
let socket;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
    await delay(100);
  }
  assert.ok(debugPort, 'Chrome debugging endpoint did not start');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 60; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); }
    throw new Error(`Condition not met: ${expression}`);
  };
  await command('Page.enable');
  // The extension's actual popup and full-tab entry points must differ.
  await command('Emulation.setDeviceMetricsOverride', { width: 560, height: 595, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `${origin}/popup.html` });
  await waitFor("document.querySelector('.yumai-popup') && document.querySelector('textarea')");
  assert.equal(await evaluate("Boolean(document.querySelector('.yumai-workspace'))"), false);
  await evaluate(`(() => {
    window.chrome = { runtime: { getURL: path => ${JSON.stringify(origin)} + '/' + path }, tabs: { create: options => window.__openedTab = options.url } };
    document.querySelector('button[aria-label="在独立标签页打开"]').click();
  })()`);
  assert.equal(await evaluate('window.__openedTab'), `${origin}/workspace.html`);
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `${origin}/workspace.html` });
  await waitFor("document.querySelector('.yumai-workspace-outline') && document.querySelector('textarea')");
  assert.equal(await evaluate("Boolean(document.querySelector('.yumai-popup'))"), false);
  console.log('PASS: extension toolbar popup and dedicated full-tab workspace entry points.');
  await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `${origin}/host.html` });
  await waitFor("Boolean(document.querySelector('#sample'))");
  await evaluate(`(() => {
    window.__messageListeners = [];
    window.__bridgeCalls = [];
    const event = () => ({ addListener() {}, removeListener() {} });
    const storage = {};
    window.chrome = {
      runtime: { id: 'layout-fixture', getURL: path => ${JSON.stringify(origin)} + '/' + path,
        onMessage: { addListener: fn => window.__messageListeners.push(fn) },
        connect() { let reply; return {
          onMessage: { addListener: fn => reply = fn }, onDisconnect: event(),
          postMessage(message) {
            window.__bridgeCalls.push(message.kind);
            queueMicrotask(() => reply({ id: message.id, type: 'done', result:
              message.kind === 'explain' ? ${JSON.stringify(sample)} : { translation: '这是一个用于科学研究和评估的系统。', detectedLang: 'en' } }));
          }, disconnect() {},
        }; },
      },
      storage: { local: {
        get(keys, cb) { cb?.(storage); return Promise.resolve(storage); },
        set(items) { Object.assign(storage, items); return Promise.resolve(); },
      }, onChanged: event() },
    };
    return new Promise(resolve => { const s = document.createElement('script'); s.src = '/content.js'; s.onload = resolve; document.head.append(s); });
  })()`);
  await evaluate(`(() => {
    const node = document.querySelector('#sample').firstChild;
    const start = node.textContent.indexOf('research');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 8);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    window.__messageListeners.forEach(fn => fn({ action: 'TRANSLATE_SELECTION', text: 'research' }, {}, () => {}));
  })()`);
  const shadow = "document.querySelector('#freetranslate-host-container')?.shadowRoot";
  await waitFor(`${shadow}?.querySelector('.yumai-word-meaning p')?.textContent.includes('Experimental')`);
  await delay(250);
  const query = selector => `${shadow}.querySelector(${JSON.stringify(selector)})`;
  const click = async selector => { await evaluate(`${query(selector)}.click()`); await delay(100); };
  const metrics = async () => evaluate(`(() => {
    const s = ${shadow}; const card = s.querySelector('.freetranslate-modal-card');
    const app = s.querySelector('.yumai-app'); const body = s.querySelector('.yumai-word-body');
    const r = card.getBoundingClientRect(); const a = app.getBoundingClientRect(); const b = body.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom,
      appBottom:a.bottom, bodyBottom:b.bottom, bodyHeight:b.height, scroll:body.scrollHeight, client:body.clientHeight,
      nativeBorder:getComputedStyle(s.querySelector('.yumai-word-icon')).borderTopWidth,
      paragraphMargin:getComputedStyle(s.querySelector('.yumai-word-meaning p')).marginTop,
      meaningFont:getComputedStyle(s.querySelector('.yumai-word-meaning p')).fontSize,
      titleHeight:s.querySelector('.yumai-word-title-row').getBoundingClientRect().height,
      translatorPadding:getComputedStyle(s.querySelector('.yumai-language-bar').parentElement).paddingLeft,
      horizontalOverflow:body.scrollWidth > body.clientWidth,
      hostBorder:getComputedStyle(document.querySelector('#host-button')).borderTopWidth,
      viewport:{ width:innerWidth, height:innerHeight } };
  })()`);
  const assertFits = m => {
    assert.ok(m.x >= 11 && m.y >= 11 && m.right <= m.viewport.width - 11 && m.bottom <= m.viewport.height - 11, JSON.stringify(m));
    assert.ok(m.bodyHeight > 30 && m.bodyBottom <= m.bottom && m.appBottom <= m.bottom, 'Explanation clipped by parent');
    assert.equal(m.horizontalOverflow, false, 'Explanation overflows horizontally');
    assert.equal(m.nativeBorder, '0px'); assert.equal(m.paragraphMargin, '0px');
    assert.equal(m.meaningFont, '17px'); assert.equal(m.hostBorder, '5px', 'Host styles changed');
    assert.equal(m.translatorPadding, '12px', 'Base reset overrides Tailwind utility spacing');
  };
  const output = join(root, 'preview'); await mkdir(output, { recursive: true });
  const capture = async name => { const { data } = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(output, name), Buffer.from(data, 'base64')); };
  const initial = await metrics(); assertFits(initial); assert.equal(initial.width, 560); assert.ok(initial.titleHeight <= 34);
  await capture('yumai-floating-dictionary.png');
  const captureCard = async name => {
    const m = await metrics();
    const { data } = await command('Page.captureScreenshot', { format: 'png', clip: { x: m.x, y: m.y, width: m.width, height: m.height, scale: 1 } });
    await writeFile(join(output, name), Buffer.from(data, 'base64'));
  };
  await captureCard('yumai-floating-dictionary-card.png');
  await click('button[aria-label="展开阅读窗口"]');
  const expanded = await metrics(); assertFits(expanded); assert.equal(expanded.width, 820);
  await capture('yumai-floating-expanded.png');
  await captureCard('yumai-floating-expanded-card.png');
  await click('.yumai-word-context summary');
  assert.equal(await evaluate(`${query('.yumai-word-context p')}.textContent`), await evaluate("document.querySelector('#sample').textContent"));
  await click('button[aria-controls$="-vocabulary"]');
  await click('button[aria-controls$="-examples"]');
  await evaluate(`(() => { const body = ${query('.yumai-word-body')}; body.scrollTop = 100000; })()`);
  await delay(100);
  assert.ok(await evaluate(`(() => { const s=${shadow}; const b=s.querySelector('.yumai-word-body').getBoundingClientRect(); const e=s.querySelector('.yumai-word-examples').lastElementChild.getBoundingClientRect(); return e.bottom <= b.bottom && e.bottom > b.top; })()`), 'Last example cannot be reached');
  await capture('yumai-floating-complete-explanation.png');
  await click('button[aria-label="恢复窗口大小"]');
  const sizes = [];
  for (const [width, height, scale] of [[390, 480, 1], [640, 360, 1], [853, 600, 1.5]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await delay(200);
    const m = await metrics(); assertFits(m); sizes.push(m);
    const controlsFit = await evaluate(`(() => {const s=${shadow}; const r=s.querySelector('.freetranslate-modal-card').getBoundingClientRect(); return [...s.querySelectorAll('.yumai-header button, .yumai-language-bar button, .yumai-language-bar select')].every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left && b.right<=r.right;});})()`);
    assert.ok(controlsFit, `Toolbar overflows at ${width}x${height}`);
    await capture(`yumai-floating-${width}x${height}.png`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await delay(100);
  // Exercise native CSS resize and the observer's viewport clamping.
  const beforeResize = await metrics();
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeResize.right - 3, y: beforeResize.bottom - 3 });
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeResize.right - 3, y: beforeResize.bottom - 3, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeResize.right + 90, y: beforeResize.bottom - 70, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeResize.right + 90, y: beforeResize.bottom - 70, button: 'left', clickCount: 1 });
  await delay(100);
  const resized = await metrics(); assertFits(resized); assert.ok(resized.width > beforeResize.width, 'Resize corner did not change width');
  await click('button[aria-label="展开阅读窗口"]'); await click('button[aria-label="恢复窗口大小"]');
  assert.equal((await metrics()).width, 560, 'Expand/reset did not clear manual resize');
  await click('button[aria-label="编辑选中文本"]');
  await waitFor(`${shadow}?.querySelector('textarea')?.value === 'research'`);
  await evaluate(`[...${shadow}.querySelectorAll('button')].find(b => b.textContent.trim() === '查看语境释义').click()`);
  await waitFor(`${shadow}?.querySelector('.yumai-word-body')`);
  await click('button[aria-label="固定窗口"]');
  await evaluate("document.querySelector('#sample').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  assert.ok(await evaluate(`Boolean(${shadow})`), 'Pinned card closed on outside click');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('#freetranslate-host-container')");
  await writeFile(join(output, 'yumai-floating-layout.json'), JSON.stringify({ initial, expanded, sizes }, null, 2));
  console.log('PASS: real Shadow DOM, full explanation scrolling, expand/reset, native resize, editing, narrow/short/high-DPI viewports, pin, Escape, and host style isolation.');
} finally {
  socket?.close(); browser.kill(); server.close();
}
