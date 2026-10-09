import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplainPrompt, buildTranslatePrompt, parseLLMJson } from './prompts';

const quiet = <T>(fn: () => T): T => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

test('translate prompt names both languages and asks for translation first', () => {
  const prompt = buildTranslatePrompt('Hello', 'auto', 'zh-CN');
  assert.match(prompt, /source language 'auto'/);
  assert.match(prompt, /target language 'zh-CN'/);
  assert.match(prompt, /"Hello"/);
  assert.ok(prompt.indexOf('"translation"') < prompt.indexOf('"detectedLang"'), 'translation must be requested first for streaming');
});

test('explain prompt falls back to the word when no sentence is given', () => {
  assert.match(buildExplainPrompt('run', '', 'zh-CN'), /sentence:\n"run"/);
  const withContext = buildExplainPrompt('run', 'I run every day.', 'ja');
  assert.match(withContext, /"I run every day\."/);
  assert.match(withContext, /Target language for explanation: ja/);
});

test('parseLLMJson handles strict JSON, fences and reasoning blocks', () => {
  assert.deepEqual(parseLLMJson('{"translation":"你好"}'), { translation: '你好' });
  assert.deepEqual(parseLLMJson('```json\n{"translation":"你好"}\n```'), { translation: '你好' });
  assert.deepEqual(parseLLMJson('<think>reason</think>{"translation":"好"}'), { translation: '好' });
});

test('parseLLMJson extracts JSON surrounded by prose', () => {
  assert.deepEqual(
    quiet(() => parseLLMJson('Sure! Here it is: {"translation":"好","detectedLang":"English"} Hope it helps.')),
    { translation: '好', detectedLang: 'English' },
  );
});

test('parseLLMJson treats plain text as a translation and rejects errors', () => {
  assert.deepEqual(parseLLMJson('你好世界'), { translation: '你好世界', detectedLang: 'Auto' });
  assert.deepEqual(quiet(() => parseLLMJson('Error: upstream failed')), {});
  assert.deepEqual(quiet(() => parseLLMJson('{"translation": "cut off')), {});
  assert.deepEqual(parseLLMJson(''), {});
});

test('parseLLMJson drops an unclosed reasoning block (token cut-off)', () => {
  assert.deepEqual(quiet(() => parseLLMJson('<think>still thinking about it')), {});
});
