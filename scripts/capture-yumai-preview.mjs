/**
 * Capture screenshots from the actual Chrome extension popup bundle using
 * headless Google Chrome's Chrome DevTools Protocol (Node 22 built-ins only).
 * No API requests, keys or personal data are used in the sample.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const SAMPLE = 'Excited to collaborate with the team at Amazon to bring the power of Android and Google Play to more people. Our goal is to make technology useful and accessible for everyone.';
const ARTICLE = [
  'Amazon announced a new generation of Alexa tablets designed around the needs of everyday users. Engineers worked closely with Android developers to deliver familiar apps.',
  'The partnership brings new opportunities for people who value reading, learning and accessible technology. Designers focused on a calmer and more useful experience.',
  'We are excited to collaborate with researchers and customers. Together, we can turn difficult ideas into tools that help people in practical ways.'
].join('\n\n');
const DEMO_TRANSLATION = '我们很期待与亚马逊团队合作，让更多人感受到 Android 和 Google Play 的便利。我们的目标是让技术真正为每个人创造价值。';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(url, test, retries = 80) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (!test || test(data)) return data;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error('Timed out waiting for ' + url);
}

const server = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', 'dist'], {
  cwd: ROOT, stdio: 'ignore',
});
const webServer = spawn('python3', ['-m', 'http.server', '4174', '--bind', '127.0.0.1', '--directory', 'dist-web'], {
  cwd: ROOT, stdio: 'ignore',
});
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--disable-dev-shm-usage', '--disable-extensions',
  '--remote-debugging-port=9222',
  '--user-data-dir=/tmp/yumai-ui4-preview-chrome',
  '--window-size=560,595', 'about:blank',
], { cwd: ROOT, stdio: 'ignore' });

let connection;
try {
  await waitFor('http://127.0.0.1:4173/popup.html', () => true, 70);
  await waitFor('http://127.0.0.1:4174/index.html', () => true, 70);
  const pages = await waitFor('http://127.0.0.1:9222/json/list', a => Array.isArray(a) && a.some(x => x.type === 'page'), 100);
  const page = pages.find(x => x.type === 'page');
  connection = new WebSocket(page.webSocketDebuggerUrl);
  console.log('CDP target discovered; waiting for WebSocket');
  await new Promise((resolve, reject) => {
    if (connection.readyState === WebSocket.OPEN) return resolve();
    const timeout=setTimeout(() => reject(new Error('CDP websocket connection timeout')), 9000);
    connection.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, {once:true});
    connection.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); }, {once:true});
  });
  console.log('Connected to Chrome DevTools');
  const pending = new Map();
  let seq = 0;
  connection.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Fetch.requestPaused') {
      const reqId = msg.params.requestId;
      const url = msg.params.request.url;
      const isStream = url.includes('/api/translate/stream');
      const data = isStream ? 'Preview stream intentionally disabled' : JSON.stringify({translation: DEMO_TRANSLATION, detectedLang: 'en'});
      command('Fetch.fulfillRequest',{
        requestId:reqId,
        responseCode:isStream?503:200,
        responseHeaders:[{name:'Content-Type',value:isStream?'text/plain':'application/json'}],
        body:Buffer.from(data).toString('base64')
      }).catch(e=>console.error('Preview mock response failed:',e));
      return;
    }
    if (!msg.id) return;
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
    else item.resolve(msg.result || {});
  });
  const command = (method, params={}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout=setTimeout(() => { pending.delete(id); reject(new Error('CDP command timeout: '+method)); }, 10000);
    pending.set(id, {
      resolve: (value) => {clearTimeout(timeout); resolve(value);},
      reject: (error) => {clearTimeout(timeout); reject(error);}
    });
    connection.send(JSON.stringify({id,method,params}));
  });
  console.log('Starting navigation');
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Fetch.enable', {patterns:[{urlPattern:'*://127.0.0.1:4173/api/translate*',requestStage:'Request'}, {urlPattern:'*://127.0.0.1:4174/api/translate*',requestStage:'Request'}]});
  await command('Emulation.setDeviceMetricsOverride',{width:560,height:595,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:'http://127.0.0.1:4173/popup.html'});
  let ready=false;
  for (let i=0;i<50;i++) {
    const r=await command('Runtime.evaluate',{expression:"Boolean(document.querySelector('.yumai-language-bar') && document.querySelector('textarea'))",returnByValue:true});
    if (r.result?.value) {ready=true;break;}
    await sleep(200);
  }
  if (!ready) throw new Error('YUMAI interface did not mount in preview browser');
  await sleep(400);
  await mkdir(new URL('../preview/',import.meta.url),{recursive:true});
  const capture=async name=>{
    const snap=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    await writeFile(new URL('../preview/'+name,import.meta.url),Buffer.from(snap.data,'base64'));
  };
  await capture('yumai-popup-empty.png');
  console.log('Empty popup screenshot saved');

  // Real input interaction (not a fabricated HTML mock).
  const focus=await command('Runtime.evaluate',{expression:"document.querySelector('textarea').focus(); true",returnByValue:true});
  if (!focus.result?.value) throw new Error('Cannot focus input');
  await command('Input.insertText',{text:SAMPLE});
  await sleep(500);
  const metrics=await command('Runtime.evaluate',{
    expression:`(() => {
      const get = (q) => document.querySelector(q);
      const box = (q) => { const e=get(q); if(!e) return null; const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)} };
      return {
        title:document.title,
        typed:get('textarea')?.value?.length||0,
        font:get('textarea')?getComputedStyle(get('textarea')).fontFamily:null,
        language:box('.yumai-language-bar'),
        input:box('.yumai-source-panel'),
        output:box('.yumai-result-panel'),
        viewport:{width:innerWidth,height:innerHeight}
      };
    })()`,
    returnByValue:true
  });
  const info=metrics.result?.value;
  if (!info || info.typed !== SAMPLE.length) throw new Error('Sample text did not appear in React input: '+JSON.stringify(info));
  await capture('yumai-popup-with-text.png');
  console.log('Typing succeeded; requesting a demonstration translation');
  await command('Runtime.evaluate', {
    expression: "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '翻译')?.click(); true",
    returnByValue:true
  });
  let translated = false;
  for (let i=0;i<60;i++) {
    const check=await command('Runtime.evaluate',{
      expression: "document.querySelector('.yumai-result-text')?.textContent?.includes('我们很期待') || false",
      returnByValue:true
    });
    if (check.result?.value) {translated=true;break;}
    await sleep(150);
  }
  if (!translated) throw new Error('Mocked translation did not render in React UI');
  await command('Runtime.evaluate',{expression:'document.activeElement?.blur(); true',returnByValue:true});
  await sleep(200);
  await capture('yumai-popup-demo-translation.png');
  console.log('Demo translation screenshot saved');

  // Exercise actual settings/history modals with the production components.
  await command('Runtime.evaluate',{expression:"document.querySelector('button[aria-label=\\\"打开设置\\\"]')?.click(); true",returnByValue:true});
  await sleep(250);
  const settingsShown=await command('Runtime.evaluate',{expression:"Boolean(document.querySelector('.yumai-settings-panel[role=dialog]'))",returnByValue:true});
  if (!settingsShown.result?.value) throw new Error('Settings dialog did not open');
  await capture('yumai-settings-panel.png');
  await command('Runtime.evaluate',{expression:"document.querySelector('.yumai-settings-panel button[aria-label=\\\"关闭设置\\\"]')?.click(); true",returnByValue:true});
  await sleep(150);
  await command('Runtime.evaluate',{expression:"document.querySelector('button[aria-label=\\\"查看翻译历史\\\"]')?.click(); true",returnByValue:true});
  await sleep(250);
  const historyShown=await command('Runtime.evaluate',{expression:"Boolean(document.querySelector('.yumai-history-drawer[role=dialog]'))",returnByValue:true});
  if (!historyShown.result?.value) throw new Error('History drawer did not open');
  await capture('yumai-history-drawer.png');
  await command('Runtime.evaluate',{expression:"document.querySelector('.yumai-history-drawer button[aria-label=\\\"关闭翻译历史\\\"]')?.click(); true",returnByValue:true});
  console.log('Settings and history screenshots saved');
  await writeFile(new URL('../preview/yumai-popup-layout.json',import.meta.url),JSON.stringify({...info,demoTranslation:true},null,2)+'\n');
  // Full-tab workspace — same production React App, different actual route and layout.
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:'http://127.0.0.1:4174/index.html'});
  let workspaceReady=false;
  for(let i=0;i<55;i++){
    const status=await command('Runtime.evaluate',{expression:"Boolean(document.querySelector('.yumai-workspace-outline') && document.querySelector('textarea'))",returnByValue:true});
    if(status.result?.value) {workspaceReady=true;break;}
    await sleep(180);
  }
  if(!workspaceReady)throw new Error('Full-tab reading workspace did not mount');
  await command('Runtime.evaluate',{expression:"document.querySelector('textarea').focus(); true",returnByValue:true});
  await command('Input.insertText',{text:ARTICLE});
  await sleep(500);
  const outline=await command('Runtime.evaluate',{
    expression:"({length:document.querySelector('textarea')?.value.length,items:document.querySelectorAll('.yumai-outline-item').length,workspace:!!document.querySelector('.yumai-workspace')})",
    returnByValue:true
  });
  const outlineInfo=outline.result?.value;
  if(outlineInfo?.items<3 || outlineInfo.length!==ARTICLE.length) throw new Error('Workspace outline smoke test failed: '+JSON.stringify(outlineInfo));
  await command('Runtime.evaluate',{expression:"Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '翻译')?.click(); true",returnByValue:true});
  let workspaceTranslated=false;
  for(let i=0;i<55;i++){
    const c=await command('Runtime.evaluate',{expression:"document.querySelector('.yumai-result-text')?.textContent?.includes('我们很期待') || false",returnByValue:true});
    if(c.result?.value){workspaceTranslated=true;break;}
    await sleep(180);
  }
  if(!workspaceTranslated)throw new Error('Workspace did not display a mock translation');
  await capture('yumai-workspace-1440.png');
  await command('Runtime.evaluate',{expression:"document.querySelector('.yumai-outline-item')?.click(); true",returnByValue:true});
  let selectedResult=false;
  for(let i=0;i<55;i++){
    const state=await command('Runtime.evaluate',{
      expression:"({selected:document.body.textContent.includes('所选内容译文'),unchanged:document.querySelector('textarea')?.value.length})",
      returnByValue:true
    });
    if(state.result?.value?.selected && state.result?.value?.unchanged===ARTICLE.length){selectedResult=true;break;}
    await sleep(150);
  }
  if(!selectedResult) throw new Error('Outline segment did not translate without replacing original text');
  await capture('yumai-workspace-selected-paragraph.png');
  await writeFile(new URL('../preview/yumai-workspace-layout.json',import.meta.url),JSON.stringify(outlineInfo,null,2)+'\\n');
  console.log('Full-tab workspace screenshot saved');

  // CI-only component fixture uses the real production Header + WordContextCard.
  await command('Emulation.setDeviceMetricsOverride',{width:1100,height:850,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:'http://127.0.0.1:4174/preview-overlay.html'});
  let overlayReady=false;
  for(let i=0;i<55;i++){
    const c=await command('Runtime.evaluate',{expression:"Boolean(document.querySelector('.yumai-word-card') && document.querySelector('.yumai-floating'))",returnByValue:true});
    if(c.result?.value){overlayReady=true;break;}
    await sleep(180);
  }
  if(!overlayReady) throw new Error('Overlay component fixture did not render');
  await sleep(200);
  await capture('yumai-overlay-component-1100.png');
  console.log('Overlay component screenshot saved');

  process.stdout.write('Preview screenshots captured: '+JSON.stringify(info)+'\n');
} finally {
  if (connection) connection.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  webServer.kill('SIGTERM');
}
