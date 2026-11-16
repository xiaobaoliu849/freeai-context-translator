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

/** True when a sentence boundary falls between value[i - 1] and value[i]. */
function isSentenceBoundary(value: string, i: number): boolean {
  const prev = value[i - 1];
  if (prev === undefined || prev === '\n') return true;
  if (/[。！？]/.test(prev)) return true;
  return /[.!?]/.test(prev) && /\s/.test(value[i] ?? ' ');
}

/**
 * The whole sentence containing [start, end), so a lookup sees a complete
 * clause rather than a few neighbouring words. Falls back to contextForRange
 * when the sentence is too long, and returns '' when the selection is the
 * entire sentence (e.g. a one-word heading) because that adds no context.
 */
export function sentenceAroundRange(value: string, start: number, end: number, maxLength = 380): string {
  if (start < 0 || end > value.length || start >= end) return '';
  let from = start;
  while (from > 0 && start - from < maxLength && !isSentenceBoundary(value, from)) from--;
  let to = end;
  while (to < value.length && to - end < maxLength && !(to > end && isSentenceBoundary(value, to))) to++;
  const sentence = value.slice(from, to).replace(/\s+/g, ' ').trim();
  const selected = value.slice(start, end).replace(/\s+/g, ' ').trim();
  if (sentence.length > maxLength) return contextForRange(value, start, end);
  if (!sentence || sentence === selected) return '';
  return sentence;
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
