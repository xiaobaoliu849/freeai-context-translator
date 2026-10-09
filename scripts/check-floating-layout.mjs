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
// Set once the CDP session is ready, so a failed assertion still leaves a
// screenshot and the visible text behind for the CI artifact.
let captureFailure;
try {
  let debugPort;
  // A cold CI runner can take well over the local start-up time.
  for (let i = 0; i < 300; i++) {
    if (launchError) throw launchError;
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
    await delay(100);
  }
  assert.ok(debugPort, 'Chrome debugging endpoint did not start');
  // DevToolsActivePort is written before the initial about:blank tab is
  // registered, so poll until a page target actually exists.
  let pageTarget;
  for (let i = 0; i < 100 && !pageTarget; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    if (!pageTarget) await delay(100);
  }
  assert.ok(pageTarget, 'Chrome did not expose a page target');
  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
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
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); }
    throw new Error(`Condition not met: ${expression}`);
  };
  await command('Page.enable');
  const output = join(root, 'preview'); await mkdir(output, { recursive: true });
  const capture = async name => { const { data } = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(output, name), Buffer.from(data, 'base64')); };
  captureFailure = async () => {
    await capture('yumai-floating-failure.png');
    const state = await evaluate(`JSON.stringify({ url: location.href, viewport: [innerWidth, innerHeight], text: document.body?.innerText.slice(0, 1500) })`);
    await writeFile(join(output, 'yumai-floating-failure.json'), state);
    console.error('Page state at failure:', state);
  };
  const contrast = (foreground, background) => {
    const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => {
      const n = c / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  // The extension's actual popup and full-tab entry points must differ.
  await command('Emulation.setDeviceMetricsOverride', { width: 560, height: 595, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `${origin}/popup.html` });
  await waitFor("document.querySelector('.yumai-popup') && document.querySelector('textarea')");
  assert.equal(await evaluate("Boolean(document.querySelector('.yumai-workspace'))"), false);
  const emptyState = await evaluate(`(() => {
    const button = document.querySelector('.yumai-translate-button');
    return {
      placeholderColor: getComputedStyle(document.querySelector('textarea'), '::placeholder').color,
      buttonColor: getComputedStyle(button).color, buttonBackground: getComputedStyle(button).backgroundColor,
      buttonOpacity: getComputedStyle(button).opacity, disabled: button.disabled,
      emptyFontStyle: getComputedStyle(document.querySelector('.yumai-empty-result p')).fontStyle,
      sourceActions: !!document.querySelector('button[aria-label="复制原文"]'),
      targetActions: !!document.querySelector('button[aria-label="复制译文"]'),
    };
  })()`);
  assert.ok(contrast(emptyState.placeholderColor, 'rgb(255, 255, 255)') >= 4.5, 'Input guidance contrast is too low');
  assert.ok(contrast(emptyState.buttonColor, emptyState.buttonBackground) >= 4.5, 'Disabled action label is washed out');
  assert.equal(emptyState.buttonOpacity, '1'); assert.equal(emptyState.disabled, true);
  assert.equal(emptyState.emptyFontStyle, 'normal');
  assert.equal(emptyState.sourceActions, false); assert.equal(emptyState.targetActions, false);
  await capture('yumai-popup-clarity-empty.png');
  await evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/translate/stream')) return Promise.resolve(new Response('Fixture: use non-streaming response', { status: 503 }));
      if (url.includes('/api/translate')) return Promise.resolve(new Response(JSON.stringify({ translation: window.__translationSample || '研究系统帮助科学家在临床应用之前评估各种想法。', detectedLang: 'en' }), { headers: { 'Content-Type': 'application/json' } }));
      return originalFetch(input, init);
    };
    document.querySelector('textarea').focus();
  })()`);
  await command('Input.insertText', { text: 'Research systems help scientists evaluate ideas before clinical use.' });
  await waitFor("!document.querySelector('.yumai-translate-button').disabled");
  assert.ok(await evaluate("Boolean(document.querySelector('button[aria-label=\"复制原文\"]'))"));
  assert.equal(await evaluate("Boolean(document.querySelector('.yumai-context-chip'))"), false, 'Sentence mode has a redundant mode row');
  await capture('yumai-popup-clarity-with-text.png');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await waitFor("document.querySelector('.yumai-result-text')?.textContent.includes('研究系统帮助科学家')");
  assert.ok(await evaluate("Boolean(document.querySelector('button[aria-label=\"复制译文\"]'))"));
  const resultLayout = await evaluate(`(() => {
    const panel = document.querySelector('.yumai-result-panel').getBoundingClientRect();
    const footer = document.querySelector('.yumai-result-footer').getBoundingClientRect();
    return { panelBottom: panel.bottom, footerBottom: footer.bottom, viewportHeight: innerHeight,
      textColor: getComputedStyle(document.querySelector('.yumai-result-text')).color };
  })()`);
  assert.ok(resultLayout.footerBottom <= resultLayout.panelBottom && resultLayout.panelBottom <= resultLayout.viewportHeight, 'Result actions are clipped');
  assert.ok(contrast(resultLayout.textColor, 'rgb(255, 255, 255)') >= 4.5);
  await evaluate('document.activeElement?.blur()');
  await capture('yumai-popup-clarity-result.png');
  await evaluate(`(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedText = text; } } });
    document.querySelector('button[aria-label="复制译文"]').click();
  })()`);
  await waitFor("window.__copiedText === '研究系统帮助科学家在临床应用之前评估各种想法。'");
  await evaluate("document.querySelector('button[aria-label=\"清空文本\"]').click()");
  await waitFor("!document.querySelector('textarea').value && !document.querySelector('button[aria-label=\"复制译文\"]')");
  await evaluate("window.__translationSample = Array(35).fill('研究系统帮助科学家在临床应用之前评估各种想法。').join('\\n\\n'); document.querySelector('textarea').focus()");
  await command('Input.insertText', { text: Array(22).fill('Research systems help scientists evaluate ideas before clinical use.').join('\n\n') });
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13 });
  await waitFor("document.querySelector('.yumai-result-text')?.textContent === window.__translationSample");
  assert.ok(await evaluate(`(() => {
    const source = document.querySelector('textarea'), result = document.querySelector('.yumai-result-scroll');
    const footer = document.querySelector('.yumai-result-footer').getBoundingClientRect();
    return source.scrollHeight > source.clientHeight && result.scrollHeight > result.clientHeight && footer.bottom <= innerHeight;
  })()`), 'Long source/result must scroll inside the popup');
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"复制译文\"] span').textContent"), '复制', 'Previous copy feedback leaked into a new result');
  await evaluate("document.activeElement?.blur(); document.querySelector('textarea').scrollTop = 0; document.querySelector('.yumai-result-scroll').scrollTop = 0");
  await capture('yumai-popup-clarity-long-text.png');
  console.log('PASS: popup empty/result states, text contrast, contextual actions, and keyboard translation.');
  const interactionFailures = [];
  // A clipboard permission prompt can settle after the user replaces the source.
  await evaluate(`(() => {
    navigator.clipboard.writeText = () => new Promise(resolve => { window.__resolveCopy = resolve; });
    document.querySelector('button[aria-label="复制原文"]').click();
    document.querySelector('button[aria-label="清空文本"]').click();
    document.querySelector('textarea').focus();
  })()`);
  await command('Input.insertText', { text: 'A new sentence must not inherit the previous copy status.' });
  await evaluate('window.__resolveCopy()');
  await delay(100);
  if (await evaluate("Boolean(document.querySelector('button[aria-label=\"复制原文\"] .lucide-check'))")) interactionFailures.push('Delayed copy success marks replacement text as copied');
  // Deliberately ignore abort in the fixture: late responses must still be discarded.
  await evaluate(`(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (input === '/api/translate') return new Promise((resolve, reject) => {
        window.__fallbackSignal = init.signal;
        if (window.__rejectOnAbort) init.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
        window.__resolveTranslation = () => resolve(new Response(JSON.stringify({ translation: 'Stale cleared result', detectedLang: 'en' }), { headers: { 'Content-Type': 'application/json' } }));
      });
      if (typeof input === 'string' && /^https?:/.test(input)) { window.__unexpectedProviderCalls = (window.__unexpectedProviderCalls || 0) + 1; return Promise.reject(new Error('Unexpected provider call')); }
      return originalFetch(input, init);
    };
    document.querySelector('.yumai-translate-button').click();
  })()`);
  await waitFor('window.__resolveTranslation');
  await evaluate("document.querySelector('button[aria-label=\"清空文本\"]').click(); window.__resolveTranslation()");
  await delay(100);
  if (!(await evaluate("Boolean(document.querySelector('.yumai-empty-result')) && !document.querySelector('.yumai-result-text')?.textContent.includes('Stale cleared result')"))) interactionFailures.push('Cleared translation reappears after a late response');
  if (!(await evaluate('window.__fallbackSignal?.aborted'))) interactionFailures.push('Clear does not abort the fallback request');
  await evaluate('window.__rejectOnAbort = true; delete window.__resolveTranslation; document.querySelector("textarea").focus()');
  await command('Input.insertText', { text: 'Stop must remain available when all input is deleted.' });
  await evaluate('document.querySelector(".yumai-translate-button").click()');
  await waitFor('window.__resolveTranslation');
  await evaluate('document.querySelector("textarea").focus(); document.querySelector("textarea").select()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await waitFor('!document.querySelector("textarea").value');
  assert.equal(await evaluate('document.querySelector(".yumai-translate-button").disabled'), false, 'Deleting input disables Stop during a request');
  await evaluate('document.querySelector(".yumai-translate-button").click()');
  await waitFor('document.querySelector(".yumai-translate-button").dataset.loading === "false"');
  assert.equal(await evaluate('window.__fallbackSignal.aborted'), true);
  assert.equal(await evaluate('window.__unexpectedProviderCalls || 0'), 0, 'Aborting the server fallback starts a provider request');
  assert.ok(await evaluate('Boolean(document.querySelector(".yumai-empty-result"))'));
  await evaluate(`(() => {
    window.chrome = { runtime: { getURL: path => ${JSON.stringify(origin)} + '/' + path }, tabs: { create: options => window.__openedTab = options.url } };
    document.querySelector('button[aria-label="在独立标签页打开"]').click();
  })()`);
  assert.equal(await evaluate('window.__openedTab'), `${origin}/workspace.html`);
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: `${origin}/workspace.html` });
  await waitFor("document.querySelector('.yumai-workspace-outline') && document.querySelector('textarea')");
  assert.equal(await evaluate("Boolean(document.querySelector('.yumai-popup'))"), false);
  await evaluate("document.querySelector('.yumai-layout-menu summary').click()");
  await evaluate("document.querySelector('button[aria-label=\"原文加宽 (6:4)\"]').focus(); document.activeElement.click()");
  assert.equal(await evaluate("document.querySelector('.yumai-translation-workspace').style.getPropertyValue('--split')"), '60%');
  assert.equal(await evaluate("document.querySelector('.yumai-layout-menu').open"), false);
  if (!(await evaluate("document.activeElement === document.querySelector('.yumai-layout-menu summary')"))) interactionFailures.push('Layout selection leaves keyboard focus inside the closed menu');
  await evaluate('document.querySelector(".yumai-layout-menu summary").click(); document.querySelector(".yumai-layout-options button").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.querySelector(".yumai-layout-menu").open'), false);
  assert.ok(await evaluate('document.activeElement === document.querySelector(".yumai-layout-menu summary")'));
  assert.deepEqual(interactionFailures, [], 'Adversarial interaction failures');
  console.log('PASS: delayed clipboard, late cleared response, fallback cancellation, empty-input Stop, and layout focus/Escape.');
  console.log('PASS: extension toolbar popup and dedicated full-tab workspace entry points.');
  // Exercise the final client fallback as well; no request reaches a model server.
  await evaluate(`localStorage.setItem('freetranslate_settings', JSON.stringify({ defaultProvider: 'ollama', autoTranslate: false, settingsVersion: 4, providerConfigs: { ollama: { apiKey: '', baseUrl: 'http://model-fixture.invalid', model: 'fixture-model', availableModels: [] } } }))`);
  await command('Page.navigate', { url: `${origin}/workspace.html` });
  await waitFor('document.querySelector("textarea")');
  await evaluate(`(() => {
    window.fetch = (input, init) => {
      if (input === '/api/translate/stream' || input === '/api/translate') return Promise.resolve(new Response('Unavailable fixture', { status: 503 }));
      if (input === 'http://model-fixture.invalid/chat/completions') return new Promise((resolve, reject) => {
        window.__clientSignal = init.signal;
        init.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
      });
      throw new Error('Unexpected fetch: ' + input);
    };
    document.querySelector('textarea').focus();
  })()`);
  await command('Input.insertText', { text: 'Client fallback requests should stop when the user clears the text.' });
  await evaluate('document.querySelector(".yumai-translate-button").click()');
  await waitFor('window.__clientSignal');
  await evaluate('document.querySelector("button[aria-label=\\"清空文本\\"]").click()');
  await waitFor('window.__clientSignal.aborted && document.querySelector(".yumai-empty-result")');
  assert.equal(await evaluate('document.querySelector(".yumai-translate-button").dataset.loading'), 'false');
  await evaluate('localStorage.removeItem("freetranslate_settings")');
  console.log('PASS: client provider fallback is cancelled by Clear.');
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
} catch (error) {
  try { await captureFailure?.(); } catch (captureError) { console.error('Could not capture failure state:', captureError.message); }
  throw error;
} finally {
  socket?.close(); browser.kill(); server.close();
}
