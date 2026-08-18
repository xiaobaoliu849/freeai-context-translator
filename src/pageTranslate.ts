import { audioPlayer } from './utils/audio';
import { bridgePageTranslate, getExtensionSettings, isExtensionContext } from './services/bridge';

/**
 * Page translation for the Chrome extension (content script).
 *
 * Flow:
 *  1. collectBlocks() walks the DOM and keeps only real content blocks —
 *     nav/header/footer/sidebar, hidden elements, and link-dense nav items are
 *     filtered out (the same list drives BOTH the bilingual translation and
 *     the whole-page TTS reading, so headers are never read aloud).
 *  2. translatePage() batches paragraphs (~8 segments / ~2400 chars per call),
 *     sends them to the background bridge, and inserts one translation block
 *     right after each original paragraph (bilingual view, originals intact).
 *  3. readPage() plays the English content block by block with a highlighted
 *     reading position, skipping the same noise regions.
 *  4. A bottom-right floating button (collapsed by default) expands into a
 *     panel that toggles translation / reading, and folds back automatically
 *     when an action finishes.
 */

// `div` is included because many modern layouts keep their paragraphs in divs;
// div candidates are held to a higher text-length bar below so layout
// fragments (timestamps, stray labels) don't sneak in.
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dt, dd, summary, cite, div';
const MAX_BLOCKS = 400;
/** Paragraphs longer than this are split into sentence chunks before translating. */
const SPLIT_BLOCK_CHARS = 1200;
/** Hard cap: anything longer is skipped entirely (unusual; would blow up a batch). */
const MAX_BLOCK_CHARS = 2400;
const MAX_BATCH_SEGS = 8;
const MAX_BATCH_CHARS = 2400;
const READ_CHUNK_CHARS = 300;

/** Tags that are chrome/boilerplate, never content. (`figure` is NOT here —
 * its `figcaption` child is a legitimate content block and would otherwise
 * always be filtered out.) */
const NOISE_TAG_RE =
  /^(nav|header|footer|aside|form|button|select|textarea|label|dialog|menu|script|style|noscript|template|svg|canvas|iframe|video|audio|code|pre)$/i;
/** class/id tokens that mark boilerplate regions (nav bars, ads, comments...). */
const NOISE_CLASS_RE =
  /(^|[\s_-])(nav|navbar|menu|sidebar|footer|banner|ad|ads|advert|advertisement|sponsor|promo|comment|comments|cookie|popup|modal|toast|widget|share|social|toolbar|pagination|breadcrumb|related|recommend|subscribe|newsletter|signup|login|search|copyright|byline|author|meta|tag|tags|carousel|slider|hero|topbar|breadcrumb)/i;

interface PageBlock {
  el: HTMLElement;
  text: string;
}

interface PageSettings {
  targetLang: string;
  provider: string;
  model: string;
  baseUrl: string;
  ttsEngine: string;
  ttsVoice: string;
  ttsRate: number;
}

/** Detect a rough language from text so TTS picks a matching voice. */
function detectLang(text: string): string {
  const total = text.length || 1;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (kana / total > 0.05) return 'ja-JP';
  if (hangul / total > 0.05) return 'ko-KR';
  if (cjk / total > 0.05) return 'zh-CN';
  return 'en-US';
}

/** True for elements we injected ourselves (toolbar, translations, popover). */
function isOwnNode(el: Element): boolean {
  return !!el.closest?.('.ftpt-toolbar, .ftpt-translation, .ftpt-reading, .freetranslate-modal-card, .freetranslate-host-reset, .freetranslate-float-btn');
}

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function hasNoiseAncestor(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  for (let i = 0; cur && i < 6; i++) {
    if (NOISE_TAG_RE.test(cur.tagName)) return true;
    const cls = (cur.className && typeof cur.className === 'string' ? cur.className : '') || '';
    const id = cur.id || '';
    if (NOISE_CLASS_RE.test(` ${cls} ${id} `)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** Ratio of link text to total text — high = navigation, not content. */
function linkDensity(el: HTMLElement, text: string): number {
  let linkLen = 0;
  el.querySelectorAll('a').forEach((a) => {
    linkLen += (a.textContent || '').trim().length;
  });
  return text.length > 0 ? linkLen / text.length : 1;
}

/**
 * Collects content blocks in document order. A block is a paragraph/list
 * item/heading/etc. that (a) is visible, (b) has no boilerplate ancestor,
 * (c) isn't mostly links, and (d) carries direct text. Nested blocks are
 * collapsed: if a candidate contains a later candidate (e.g. li > p), the
 * outer block wins so text isn't translated twice.
 */
export function collectBlocks(root: ParentNode = document): PageBlock[] {
  const candidates = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const blocks: PageBlock[] = [];

  for (const el of candidates) {
    if (isOwnNode(el)) continue;
    // Cheap pre-filter: skip textless nodes before any layout/visibility work.
    if ((el.textContent || '').trim().length < 2) continue;
    if (!isVisible(el)) continue;
    if (hasNoiseAncestor(el)) continue;

    // Collapse nested candidates (document order → parent first). Use `b.el === el`
    // too: a long block is split into several PageBlocks sharing the same el.
    if (blocks.some((b) => b.el === el || b.el.contains(el))) continue;

    const ownText = ownTextOf(el, new Set(candidates));
    // divs need paragraph-like heft; everything else just needs a couple chars.
    if (ownText.length < (el.tagName === 'DIV' ? 20 : 2)) continue;
    if (ownText.length > MAX_BLOCK_CHARS) continue;
    if (ownText.length >= 20 && linkDensity(el, ownText) > 0.5) continue;

    // Split overly long paragraphs into sentence chunks so nothing is silently
    // dropped from translation or reading.
    const chunks = ownText.length > SPLIT_BLOCK_CHARS ? chunkText(ownText, SPLIT_BLOCK_CHARS) : [ownText];
    for (const text of chunks) {
      blocks.push({ el, text });
      if (blocks.length >= MAX_BLOCKS) break;
    }
  }
  return blocks;
}

/**
 * Text that belongs to this element alone: walks its subtree but stops at
 * nested candidate blocks (so li > p doesn't get double-counted). Unlike a
 * string `replace`, this never mangles the parent's own text if it happens to
 * contain the same string as a nested block.
 */
function ownTextOf(el: HTMLElement, candidates: Set<HTMLElement>): string {
  let own = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        own += child.textContent || '';
      } else if (child instanceof HTMLElement && !candidates.has(child)) {
        walk(child);
      }
      // Candidate descendants are deliberately skipped (their text is theirs).
    }
  };
  walk(el);
  return own.replace(/\s+/g, ' ').trim();
}

// ---------------------------
// Translation
// ---------------------------

interface TranslateState {
  blocks: PageBlock[];
  settings: PageSettings;
  abort: AbortController | null;
  active: boolean;
  reading: boolean;
}

const state: TranslateState = {
  blocks: [],
  settings: {
    targetLang: 'zh-CN',
    provider: 'gemini',
    model: '',
    baseUrl: '',
    ttsEngine: 'edge',
    ttsVoice: '',
    ttsRate: 1.0,
  },
  abort: null,
  active: false,
  reading: false,
};

/** Reads settings from storage and keeps only what this script needs (no keys). */
async function loadSettings(): Promise<PageSettings> {
  try {
    const s = await getExtensionSettings();
    const provider = s.defaultProvider || 'gemini';
    const cfg = (s.providerConfigs as any)?.[provider] || {};
    return {
      targetLang: s.defaultTargetLang || 'zh-CN',
      provider,
      model: cfg.model || '',
      baseUrl: cfg.baseUrl || '',
      ttsEngine: s.ttsEngine || 'edge',
      ttsVoice: s.ttsVoice || '',
      ttsRate: s.ttsRate || 1.0,
    };
  } catch {
    return state.settings;
  }
}

/**
 * Insert one bilingual translation right after its original paragraph. A long
 * paragraph may produce several PageBlocks sharing the same element; anchors
 * remember the last inserted translation so chunked paragraphs stay in order.
 */
const chunkAnchors = new WeakMap<HTMLElement, HTMLElement>();
function insertTranslation(block: PageBlock, translation: string): void {
  if (!translation.trim()) return;
  const trans = document.createElement('div');
  trans.className = 'ftpt-translation';
  trans.textContent = translation;

  // Inside list/table cells an adjacent sibling would break layout semantics;
  // for those, nest the translation as the last child of the original.
  const tag = block.el.tagName;
  if (tag === 'LI' || tag === 'TD' || tag === 'TH' || tag === 'DT' || tag === 'DD') {
    block.el.appendChild(trans);
  } else {
    const anchor = chunkAnchors.get(block.el) || block.el;
    anchor.insertAdjacentElement('afterend', trans);
  }
  chunkAnchors.set(block.el, trans);
}

function removeTranslations(): void {
  document.querySelectorAll('.ftpt-translation').forEach((n) => n.remove());
  clearReadingHighlight();
}

export async function translatePage(): Promise<void> {
  if (state.active) return;
  state.settings = await loadSettings();
  removeTranslations();

  state.blocks = collectBlocks();
  if (state.blocks.length === 0) {
    setStatus('没有可翻译的正文段落：搜索/导航/列表类页面会被自动过滤，请在文章类页面使用');
    scheduleAutoCollapse(3500);
    return;
  }

  state.active = true;
  state.abort = new AbortController();
  setTranslating(true);
  const total = state.blocks.length;
  setStatus(`正在翻译 ${total} 段...`);

  // Batch consecutive blocks under the char/segment budget.
  const batches: PageBlock[][] = [];
  let current: PageBlock[] = [];
  let chars = 0;
  for (const b of state.blocks) {
    const segChars = b.text.length + 8;
    if (current.length > 0 && (current.length >= MAX_BATCH_SEGS || chars + segChars > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(b);
    chars += segChars;
  }
  if (current.length > 0) batches.push(current);

  let done = 0;
  try {
    for (const batch of batches) {
      if (state.abort?.signal.aborted) break;
      const { translations } = await bridgePageTranslate(
        {
          paragraphs: batch.map((b) => b.text),
          targetLang: state.settings.targetLang,
          provider: state.settings.provider,
          model: state.settings.model,
          baseUrl: state.settings.baseUrl,
        },
        state.abort.signal,
      );
      batch.forEach((b, i) => insertTranslation(b, translations[i] || ''));
      done += batch.length;
      setStatus(`正在翻译 ${done}/${total} 段...`);
    }
    if (state.abort?.signal.aborted) {
      // Same rule as the catch path: 恢复原文 already cleared the page, so
      // don't overwrite its empty status with 已取消.
      if (document.querySelector('.ftpt-translation')) {
        setStatus('已取消');
        scheduleAutoCollapse();
      }
    } else {
      setStatus(`已完成 ${done}/${total} 段，点击「恢复原文」可还原`);
      scheduleAutoCollapse();
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Abort happens either from the 「取消翻译」 button or from 「恢复原文」.
      // In the latter case restorePage() already cleared the page and status,
      // so only surface 已取消 when translations are still on the page.
      if (document.querySelector('.ftpt-translation')) setStatus('已取消');
    } else {
      console.warn('Page translate error:', err);
      setStatus(`翻译出错：${err?.message || '请检查 API Key / 模型设置'}`);
      scheduleAutoCollapse(6000);
    }
  } finally {
    state.active = false;
    state.abort = null;
    setTranslating(false);
  }
}

export function restorePage(): void {
  state.abort?.abort();
  state.active = false;
  removeTranslations();
  stopReading();
  setStatus('');
}

// ---------------------------
// Whole-page TTS reading
// ---------------------------

function setReadingHighlight(el: HTMLElement): void {
  clearReadingHighlight();
  el.classList.add('ftpt-reading');
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    // ignore scroll errors on odd layouts
  }
}

function clearReadingHighlight(): void {
  document.querySelectorAll('.ftpt-reading').forEach((n) => n.classList.remove('ftpt-reading'));
}

/** Split text into sentence-ish chunks of at most `max` chars. */
function chunkText(text: string, max: number): string[] {
  const parts = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (cur && (cur + ' ' + part).length > max) {
      chunks.push(cur);
      cur = part;
    } else {
      cur = cur ? cur + ' ' + part : part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length > 0 ? chunks : [text];
}

/** Speak one block, chunked, resolving when it finishes (or reading is stopped). */
function speakBlock(block: PageBlock): Promise<void> {
  return new Promise((resolve) => {
    const chunks = chunkText(block.text, READ_CHUNK_CHARS);
    const lang = detectLang(block.text);
    let i = 0;
    let settled = false;
    const advance = () => {
      if (settled) return;
      settled = true;
      next();
    };
    const next = () => {
      if (!state.reading) return resolve();
      if (i >= chunks.length) return resolve();
      const chunk = chunks[i++];
      settled = false;
      // Guard against an engine that rejects without ever calling onEnd, which
      // would otherwise hang the whole-page reading forever on this block.
      audioPlayer
        .speak({
          text: chunk,
          lang,
          engine: state.settings.ttsEngine as any,
          voice: state.settings.ttsVoice,
          rate: state.settings.ttsRate || 1.0,
          onEnd: advance,
        })
        .catch(advance);
    };
    next();
  });
}

export async function readPage(): Promise<void> {
  if (state.reading) {
    stopReading();
    return;
  }
  state.settings = await loadSettings();
  if (state.blocks.length === 0) state.blocks = collectBlocks();
  if (state.blocks.length === 0) {
    setStatus('没有可朗读的正文段落：搜索/导航/列表类页面会被自动过滤，请在文章类页面使用');
    scheduleAutoCollapse(3500);
    return;
  }

  state.reading = true;
  setReading(true);
  try {
    for (let i = 0; i < state.blocks.length; i++) {
      if (!state.reading) break;
      setReadingHighlight(state.blocks[i].el);
      await speakBlock(state.blocks[i]);
    }
  } finally {
    state.reading = false;
    setReading(false);
    clearReadingHighlight();
    if (!document.querySelector('.ftpt-translation')) setStatus('');
    scheduleAutoCollapse(1500);
  }
}

export function stopReading(): void {
  state.reading = false;
  audioPlayer.stopAll();
  setReading(false);
  clearReadingHighlight();
}

// ---------------------------
// Floating toolbar
//
// Collapsed by default: a small round FAB (book icon) in the bottom-right
// corner. Clicking it expands the action panel; the panel folds back to the
// FAB automatically once a translation / reading run finishes.
// ---------------------------

let toolbarEl: HTMLDivElement | null = null;
let collapseTimer: number | null = null;
/** Set after a drag ends so the trailing click doesn't toggle the panel. */
let suppressFabClick = false;

/** Feather-style inline icons (stroke=currentColor, inherit button color). */
const ICON_BOOK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
const ICON_SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const ICON_STOP =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const ICON_RESTORE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_HOME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

function setStatus(text: string): void {
  const status = document.querySelector<HTMLElement>('.ftpt-status');
  if (!status) return;
  status.textContent = text;
  status.hidden = !text;
}

function setTranslating(active: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('.ftpt-btn-translate');
  if (!btn) return;
  btn.innerHTML = active ? `${ICON_STOP}<span>取消翻译</span>` : `${ICON_GLOBE}<span>翻译本页</span>`;
  // NOTE: must NOT set `disabled` here — the button doubles as the cancel
  // control and a disabled button never receives the click.
}

function setReading(active: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('.ftpt-btn-read');
  if (!btn) return;
  btn.innerHTML = active ? `${ICON_STOP}<span>停止朗读</span>` : `${ICON_SPEAKER}<span>朗读英文</span>`;
}

function clearCollapseTimer(): void {
  if (collapseTimer !== null) {
    window.clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

/** Fold the panel back into the small FAB once an action has finished. */
function scheduleAutoCollapse(delay = 2600): void {
  clearCollapseTimer();
  collapseTimer = window.setTimeout(() => {
    collapseTimer = null;
    const panel = toolbarEl?.querySelector<HTMLDivElement>('.ftpt-panel');
    const fab = toolbarEl?.querySelector<HTMLButtonElement>('.ftpt-fab');
    if (panel && !panel.hidden && fab && !state.active && !state.reading) {
      panel.hidden = true;
      fab.hidden = false;
    }
  }, delay);
}

function setPanelOpen(open: boolean): void {
  const panel = toolbarEl?.querySelector<HTMLDivElement>('.ftpt-panel');
  const fab = toolbarEl?.querySelector<HTMLButtonElement>('.ftpt-fab');
  if (!panel || !fab) return;
  if (open) {
    panel.hidden = false;
    positionPanel(panel, fab);
  } else {
    panel.hidden = true;
    clearCollapseTimer();
  }
}

/**
 * Place the expanded panel next to the FAB, opening toward the page interior
 * (above-left when the FAB sits in the bottom-right corner, mirrored when the
 * FAB is dragged elsewhere) and clamped so it never leaves the viewport.
 */
function positionPanel(panel: HTMLDivElement, fab: HTMLButtonElement): void {
  const cont = toolbarEl!.getBoundingClientRect();
  const fabRect = fab.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const M = 8;
  let vpLeft = fabRect.left > vw / 2 ? fabRect.right - pw : fabRect.left;
  let vpTop = fabRect.top > vh / 2 ? fabRect.top - ph - M : fabRect.bottom + M;
  vpLeft = Math.max(M, Math.min(vpLeft, vw - pw - M));
  vpTop = Math.max(M, Math.min(vpTop, vh - ph - M));
  panel.style.left = `${vpLeft - cont.left}px`;
  panel.style.top = `${vpTop - cont.top}px`;
}

// ---------------------------
// Draggable FAB — position persisted in chrome.storage.local so it survives
// page reloads and is shared across all sites.
// ---------------------------

const FAB_POS_KEY = 'ftpt_fab_pos';
const FAB_SIZE = 44;
const FAB_MARGIN = 8;

/** Keep the FAB fully inside the viewport. Works on the 0×0 toolbar anchor
 * (the FAB's bottom-right corner), so the FAB spans [x-44, x] × [y-44, y]. */
function clampFab(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(FAB_SIZE + FAB_MARGIN, Math.min(x, window.innerWidth - FAB_MARGIN)),
    y: Math.max(FAB_SIZE + FAB_MARGIN, Math.min(y, window.innerHeight - FAB_MARGIN)),
  };
}

function setFabAnchor(x: number, y: number): void {
  const t = toolbarEl;
  if (!t) return;
  const p = clampFab(x, y);
  t.style.left = `${p.x}px`;
  t.style.top = `${p.y}px`;
  t.style.right = 'auto';
  t.style.bottom = 'auto';
}

/** Snap back to the default bottom-right corner. */
function resetFabAnchor(): void {
  const t = toolbarEl;
  if (!t) return;
  t.style.left = '';
  t.style.top = '';
  t.style.right = '';
  t.style.bottom = '';
  try {
    if (isExtensionContext()) void chrome.storage.local.remove(FAB_POS_KEY);
  } catch {
    // ignore
  }
}

async function loadFabAnchor(): Promise<void> {
  try {
    if (!isExtensionContext()) return;
    const r = await chrome.storage.local.get(FAB_POS_KEY);
    const v = r[FAB_POS_KEY];
    if (v && typeof v.x === 'number' && typeof v.y === 'number') setFabAnchor(v.x, v.y);
  } catch {
    // ignore
  }
}

function saveFabAnchor(): void {
  const t = toolbarEl;
  if (!t) return;
  const r = t.getBoundingClientRect();
  try {
    if (isExtensionContext()) {
      void chrome.storage.local.set({ [FAB_POS_KEY]: { x: r.left, y: r.top } });
    }
  } catch {
    // ignore
  }
}

/** Make the FAB draggable; a drag is never treated as a click. */
function makeDraggable(fab: HTMLButtonElement): void {
  fab.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    // Capture so pointermove/up keep arriving even when the pointer leaves the
    // window mid-drag (e.g. dragged off the top edge of the screen).
    try {
      fab.setPointerCapture(down.pointerId);
    } catch {
      // capture unsupported — the window listeners below still work
    }
    const cont = toolbarEl!;
    const startRect = cont.getBoundingClientRect();
    const startX = down.clientX;
    const startY = down.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      setFabAnchor(startRect.left + dx, startRect.top + dy);
    };
    const finish = (save: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      try {
        fab.releasePointerCapture(down.pointerId);
      } catch {
        // ignore
      }
      if (save && moved) {
        suppressFabClick = true;
        saveFabAnchor();
      }
    };
    const onUp = () => finish(true);
    // A cancelled gesture (touch interrupted) shouldn't persist the position.
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

function buildToolbar(): void {
  const host = document.createElement('div');
  host.className = 'ftpt-toolbar';
  host.innerHTML = `
    <button class="ftpt-fab" type="button" title="整页翻译（按住拖动可移动位置）" aria-label="整页翻译">${ICON_BOOK}</button>
    <div class="ftpt-panel" hidden>
      <div class="ftpt-head">
        <div class="ftpt-title">${ICON_BOOK}<span>整页翻译</span></div>
        <div class="ftpt-head-actions">
          <button class="ftpt-icon-btn ftpt-reset-pos" type="button" title="恢复默认位置" aria-label="恢复默认位置">${ICON_HOME}</button>
          <button class="ftpt-icon-btn ftpt-close" type="button" title="收起" aria-label="收起">${ICON_CLOSE}</button>
        </div>
      </div>
      <div class="ftpt-row">
        <button class="ftpt-btn ftpt-btn-translate" type="button">${ICON_GLOBE}<span>翻译本页</span></button>
        <button class="ftpt-btn ftpt-btn-read" type="button">${ICON_SPEAKER}<span>朗读英文</span></button>
        <button class="ftpt-btn ftpt-btn-restore" type="button" title="移除全部译文">${ICON_RESTORE}<span>恢复原文</span></button>
      </div>
      <div class="ftpt-status" hidden></div>
    </div>
  `;
  const fab = host.querySelector<HTMLButtonElement>('.ftpt-fab')!;
  const panel = host.querySelector<HTMLDivElement>('.ftpt-panel')!;

  fab.addEventListener('click', () => {
    if (suppressFabClick) {
      suppressFabClick = false;
      return;
    }
    setPanelOpen(panel.hidden);
  });
  // NOTE: no dblclick-to-reset here — a double click is indistinguishable from
  // a quick open/close toggle and would reset the position unexpectedly.
  makeDraggable(fab);

  host.querySelector('.ftpt-reset-pos')!.addEventListener('click', () => {
    resetFabAnchor();
    positionPanel(panel, fab);
  });
  host.querySelector('.ftpt-close')!.addEventListener('click', () => setPanelOpen(false));
  // Any interaction with the panel postpones auto-collapse so a status message
  // isn't yanked away while the user is reading it.
  panel.addEventListener('click', () => clearCollapseTimer(), true);
  host.querySelector('.ftpt-btn-translate')!.addEventListener('click', () => {
    if (state.active) {
      state.abort?.abort();
    } else {
      translatePage();
    }
  });
  host.querySelector('.ftpt-btn-read')!.addEventListener('click', () => readPage());
  host.querySelector('.ftpt-btn-restore')!.addEventListener('click', () => restorePage());

  document.body?.appendChild(host);
  toolbarEl = host;
}

/** Entry point called from the content script. */
export async function initPageTranslate(): Promise<void> {
  if (!isExtensionContext()) return;
  if (!document.body) return;
  // Avoid double-init on re-injection.
  if (document.querySelector('.ftpt-toolbar')) return;
  // Don't add chrome to the browser's own UI pages or tiny pages.
  if (document.body.children.length === 0) return;
  // Skip pages with no real text (blank shells, error pages) — nothing to
  // translate or read there.
  if (document.body.innerText.trim().length < 40) return;

  state.settings = await loadSettings();
  buildToolbar();
  await loadFabAnchor();

  // Keep the toolbar out of the way of page selection handlers.
  document.addEventListener('mouseup', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('.ftpt-toolbar')) e.stopPropagation();
  }, true);
}
