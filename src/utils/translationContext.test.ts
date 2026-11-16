import test from 'node:test';
import assert from 'node:assert/strict';
import { contextForRange } from './selectionMode';
import { buildExplainPrompt, buildTranslatePrompt, parseExplanation, parseTranslation } from '../services/prompts';

test('context is bounded around the selected occurrence, including long excerpts', () => {
  const source = 'We stopped at the bank for cash.' + ' '.repeat(160) + 'The river flooded its bank.';
  const start = source.lastIndexOf('bank');
  const context = contextForRange(source, start, start + 4);
  assert.equal(context, 'The river flooded its bank.');
  const article = 'before ' + 'long excerpt '.repeat(100) + ' after';
  const around = contextForRange(article, 7, article.length - 6);
  assert.ok(around.length <= 380 && around.includes('before') && around.includes('after'));
  assert.equal(contextForRange('bank', 0, 4), '');
});

test('only the excerpt is the translation target; optional notes and context are bounded', () => {
  const excerpt = 'We call it "the bank".\nIt is nearby.';
  const prompt = buildTranslatePrompt(excerpt, 'auto', 'zh-CN', 'r'.repeat(400), 's'.repeat(260));
  assert.ok(prompt.endsWith(JSON.stringify(excerpt)));
  assert.ok(prompt.includes('r'.repeat(380)) && !prompt.includes('r'.repeat(381)));
  assert.ok(prompt.includes('s'.repeat(240)) && !prompt.includes('s'.repeat(241)));
  assert.ok(!buildTranslatePrompt(excerpt, 'en', 'ja', excerpt).includes('Surrounding text for reference:'));
});

test('invalid model payloads are failures, while plain-text translations remain supported', () => {
  assert.throws(() => parseTranslation('{"translation":[]}'));
  assert.throws(() => parseExplanation('{"translation":"bank"}', 'bank'));
  assert.equal(parseTranslation('河岸').translation, '河岸');
  const entry = parseExplanation('{"contextualMeaning":"河岸","examples":[null],"collocations":"river bank"}', 'bank');
  assert.equal(entry.word, 'bank');
  assert.deepEqual(entry.examples, []);
  assert.deepEqual(entry.collocations, []);
});

test('prompts name the target language and keep concise lookups free of vocabulary extras', () => {
  assert.ok(buildTranslatePrompt('bank', 'en', 'zh-CN').includes('Simplified Chinese (zh-CN)'));
  const concise = buildExplainPrompt('bank', 'The river flooded its bank.', 'zh-TW', 'geology notes', 'concise');
  assert.ok(concise.includes('Traditional Chinese (zh-TW)'));
  assert.ok(concise.includes('collocations, synonymsInContext, antonyms: []'));
  // Concise in-context lookups still teach pronunciation and the sense with examples.
  assert.ok(concise.includes('IPA') && concise.includes('at most two objects') && concise.includes('inContext'));
  assert.ok(buildExplainPrompt('bank', 'x bank', 'xx').includes('at most two objects'));
});

test('a word without surrounding text gets a full dictionary entry', () => {
  for (const excerpt of ['', 'tyres', ' Tyres. ']) {
    const prompt = buildExplainPrompt('tyres', excerpt, 'zh-CN', undefined, 'concise');
    assert.match(prompt, /bilingual learner's dictionary/);
    assert.match(prompt, /three objects/);
    assert.match(prompt, /phoneticUk, phoneticUs/);
    assert.match(prompt, /etymology/);
    assert.match(prompt, /spellingSuggestion/);
  }
  assert.doesNotMatch(buildExplainPrompt('tyres', 'The tyres screeched.', 'zh-CN'), /learner's dictionary/);
});

test('dictionary fields are parsed and malformed senses dropped', () => {
  const entry = parseExplanation(JSON.stringify({
    contextualMeaning: '轮胎', phoneticUk: '/ˈtaɪəz/', phoneticUs: '/ˈtaɪərz/', rootOrLemma: 'tyre', etymology: '源自 attire。',
    senses: [{ pos: 'n.', meaning: '轮胎', inContext: true }, { pos: 'v.' }, null, { meaning: '使疲倦', inContext: 'yes' }],
  }), 'tyres');
  assert.equal(entry.phoneticUk, '/ˈtaɪəz/');
  assert.equal(entry.rootOrLemma, 'tyre');
  assert.deepEqual(entry.senses, [
    { pos: 'n.', meaning: '轮胎', inContext: true },
    { pos: '', meaning: '使疲倦', inContext: false },
  ]);
});
