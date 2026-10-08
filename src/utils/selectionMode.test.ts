import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySelection, getReadingSegments, normalizeSelectedTerm } from './selectionMode';

test('short terms and phrases open contextual dictionary', () => {
  assert.equal(classifySelection('breakthrough'), 'term');
  assert.equal(classifySelection('take off'), 'term');
  assert.equal(classifySelection('重大突破'), 'term');
  assert.equal(classifySelection('こんにちは'), 'term');
});

test('sentences and long paragraphs use translation or reading', () => {
  assert.equal(classifySelection('What does breakthrough mean?'), 'sentence');
  assert.equal(classifySelection('这句话是什么意思？'), 'sentence');
  assert.equal(classifySelection('A long sentence with a few extra words to translate now.'), 'sentence');
  assert.equal(classifySelection('First paragraph.\nSecond paragraph.'), 'passage');
  assert.equal(classifySelection('Sentence one. Sentence two. Sentence three.'), 'passage');
  assert.equal(classifySelection('This is a long excerpt. '.repeat(12)), 'passage');
});

test('reading segments preserve offsets for selection and editing', () => {
  const text = '  Paragraph one.\n\nParagraph two.\nThird.';
  const segs = getReadingSegments(text);
  assert.deepEqual(segs.map(s => s.text), ['Paragraph one.', 'Paragraph two.', 'Third.']);
  for (const segment of segs) assert.equal(text.slice(segment.start, segment.end), segment.text);
});

test('selected words preserve Japanese, Korean and accented characters', () => {
  assert.equal(normalizeSelectedTerm('「こんにちは！」'), 'こんにちは');
  assert.equal(normalizeSelectedTerm('“안녕하세요”'), '안녕하세요');
  assert.equal(normalizeSelectedTerm('(résumé)'), 'résumé');
  assert.equal(normalizeSelectedTerm('重大突破。'), '重大突破');
});
