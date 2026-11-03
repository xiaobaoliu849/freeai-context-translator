/** Lightweight, deterministic UI intent detection. No text is sent to AI here. */
export type SelectionKind = 'term' | 'sentence' | 'passage';

export function classifySelection(value: string): SelectionKind {
  const text = value.trim();
  if (!text) return 'sentence';

  const sentenceEndings = (text.match(/[.!?。！？]+/g) || []).length;
  const paragraphs = text.split(/\n\s*\n|\n/).filter(part => part.trim()).length;
  if (paragraphs > 1 || text.length >= 220 || sentenceEndings >= 3) return 'passage';

  const endsSentence = /[.!?。！？；;]$/.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const cjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]+$/u.test(text);
  if (!endsSentence && (cjk ? text.length <= 6 : wordCount <= 4 && text.length <= 42 && !/[，。！？、；]/u.test(text))) {
    return 'term';
  }
  return 'sentence';
}

/** Retain letters/digits from every writing system, not only Latin and Han. */
export function normalizeSelectedTerm(value: string): string {
  return value.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}

/** Bounded context for the actual occurrence, even when the same words appear twice. */
export function contextForRange(value: string, start: number, end: number): string {
  const before = value.slice(Math.max(0, start - 140), start);
  const after = value.slice(end, end + 140);
  if (!(before + after).trim()) return '';
  const selected = value.slice(start, end);
  const middle = before.length + selected.length + after.length <= 380 ? selected : ' […] ';
  return (before + middle + after).replace(/\s+/g, ' ').trim();
}

export interface ReadingSegment {
  text: string;
  start: number;
  end: number;
}

/** Source-text navigation only; does not imply any alignment with an AI translation. */
export function getReadingSegments(text: string, limit = 8): ReadingSegment[] {
  const paragraphs = Array.from(text.matchAll(/[^\r\n]+/g));
  const chunks = paragraphs.length === 1 && text.length >= 220
    ? Array.from(text.matchAll(/[^.!?。！？]+[.!?。！？]?/g))
    : paragraphs;
  return chunks.flatMap(match => {
    const raw = match[0];
    const clean = raw.trim();
    if (!clean) return [];
    const start = (match.index ?? 0) + raw.indexOf(clean);
    return [{ text: clean, start, end: start + clean.length }];
  }).slice(0, limit);
}
