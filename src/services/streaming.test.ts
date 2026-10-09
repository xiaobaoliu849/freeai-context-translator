import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeSSE, extractPartialTranslation } from './streaming';

test('consumeSSE returns complete events and keeps the partial tail', () => {
  const { events, rest } = consumeSSE('data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: {"del');
  assert.deepEqual(events, [{ delta: '你' }, { delta: '好' }]);
  assert.equal(rest, 'data: {"del');
});

test('consumeSSE reassembles an event split across network chunks', () => {
  let buffer = '';
  const seen: unknown[] = [];
  for (const chunk of ['data: {"done":tr', 'ue,"result":{"translation":"Hi"}}', '\n\n']) {
    const parsed = consumeSSE(buffer + chunk);
    buffer = parsed.rest;
    seen.push(...parsed.events);
  }
  assert.deepEqual(seen, [{ done: true, result: { translation: 'Hi' } }]);
  assert.equal(buffer, '');
});

test('consumeSSE ignores comments, empty data and malformed JSON', () => {
  const { events } = consumeSSE(': keep-alive\n\ndata:\n\ndata: {oops}\n\nevent: x\ndata: {"error":"quota"}\n\n');
  assert.deepEqual(events, [{ error: 'quota' }]);
});

test('partial translation grows as the JSON string streams in', () => {
  assert.equal(extractPartialTranslation(''), null);
  assert.equal(extractPartialTranslation('{"transl'), null);
  assert.deepEqual(extractPartialTranslation('{"translation": "研究系'), { text: '研究系', complete: false });
  assert.deepEqual(extractPartialTranslation('{"translation": "研究系统", "detectedLang": "en"}'), { text: '研究系统', complete: true });
});

test('partial translation decodes escapes and waits for incomplete ones', () => {
  assert.deepEqual(extractPartialTranslation('{"translation": "a\\"b\\nc\\\\d"'), { text: 'a"b\nc\\d', complete: true });
  // A trailing backslash must not be shown until its escaped char arrives.
  assert.deepEqual(extractPartialTranslation('{"translation": "line\\'), { text: 'line', complete: false });
});

test('partial translation decodes \\u escapes used by ASCII-only models', () => {
  assert.deepEqual(extractPartialTranslation('{"translation": "\\u4f60\\u597d"}'), { text: '你好', complete: true });
  // Incomplete hex digits are held back rather than shown as "u4f".
  assert.deepEqual(extractPartialTranslation('{"translation": "\\u4f60\\u59'), { text: '你', complete: false });
  // Surrogate pairs are emitted only once both halves have arrived.
  assert.deepEqual(extractPartialTranslation('{"translation": "ok \\ud83d'), { text: 'ok ', complete: false });
  assert.deepEqual(extractPartialTranslation('{"translation": "ok \\ud83d\\ude00"'), { text: 'ok 😀', complete: true });
});

test('reasoning blocks are hidden while open and stripped once closed', () => {
  assert.equal(extractPartialTranslation('<think>let me consider'), null);
  assert.deepEqual(
    extractPartialTranslation('<think>plan</think>\n{"translation": "完成"'),
    { text: '完成', complete: true },
  );
});

test('plain-text model output streams as-is, fenced JSON waits for the key', () => {
  assert.deepEqual(extractPartialTranslation('你好，世界'), { text: '你好，世界', complete: false });
  assert.equal(extractPartialTranslation('```json\n{'), null);
  assert.equal(extractPartialTranslation('{"detectedLang": "en"'), null);
});
