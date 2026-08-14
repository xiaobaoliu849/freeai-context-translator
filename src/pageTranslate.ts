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
 *  4. A fixed bottom-right toolbar toggles translation / reading.
 */

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, dt, dd, summary, cite';
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
    if (!isVisible(el)) continue;
    if (hasNoiseAncestor(el)) continue;

    // Collapse nested candidates (document order → parent first). Use `b.el === el`
    // too: a long block is split into several PageBlocks sharing the same el.
    if (blocks.some((b) => b.el === el || b.el.contains(el))) continue;

    const ownText = ownTextOf(el, new Set(candidates));
    if (ownText.length < 2) continue;
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
    setStatus('未找到可翻译的正文内容');
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
      if (document.querySelector('.ftpt-translation')) setStatus('已取消');
    } else {
      setStatus(`已完成 ${done}/${total} 段，点击「恢复原文」可还原`);
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
    setStatus('未找到可朗读的正文内容');
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
// ---------------------------

let toolbarEl: HTMLDivElement | null = null;

function setStatus(text: string): void {
  const status = document.querySelector('.ftpt-status');
  if (status) status.textContent = text;
}

function setTranslating(active: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('.ftpt-btn-translate');
  if (btn) {
    btn.textContent = active ? '取消翻译' : '翻译本页';
    // NOTE: must NOT set `disabled` here — the button doubles as the cancel
    // control and a disabled button never receives the click.
  }
}

function setReading(active: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('.ftpt-btn-read');
  if (btn) btn.textContent = active ? '⏹ 停止朗读' : '🔊 朗读英文';
}

function buildToolbar(settings: PageSettings): void {
  const host = document.createElement('div');
  host.className = 'ftpt-toolbar';
  host.innerHTML = `
    <div class="ftpt-panel">
      <div class="ftpt-title">📖 整页翻译</div>
      <div class="ftpt-row">
        <button class="ftpt-btn ftpt-btn-translate">翻译本页</button>
        <button class="ftpt-btn ftpt-btn-read">🔊 朗读英文</button>
        <button class="ftpt-btn ftpt-btn-restore" title="移除全部译文">恢复原文</button>
      </div>
      <div class="ftpt-status"></div>
    </div>
  `;
  host.querySelector('.ftpt-btn-translate')!.addEventListener('click', () => {
    if (state.active) {
      state.abort?.abort();
    } else {
      translatePage();
    }
  });
  host.querySelector('.ftpt-btn-read')!.addEventListener('click', () => readPage());
  host.querySelector('.ftpt-btn-restore')!.addEventListener('click', () => restorePage());

  document.documentElement.appendChild(host);
  toolbarEl = host;
}

/** Entry point called from the content script. */
export async function initPageTranslate(): Promise<void> {
  if (!isExtensionContext()) return;
  if (!document.documentElement) return;
  // Avoid double-init on re-injection.
  if (document.querySelector('.ftpt-toolbar')) return;
  // Don't add chrome to the browser's own UI pages or tiny pages.
  if (document.body && document.body.children.length === 0) return;

  state.settings = await loadSettings();
  buildToolbar(state.settings);

  // Keep the toolbar out of the way of page selection handlers.
  document.addEventListener('mouseup', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('.ftpt-toolbar')) e.stopPropagation();
  }, true);
}
