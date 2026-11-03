import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LANGUAGES } from '../config';
import {
  describeTranslationError, formatHistoryTime, formatLanguagePair, getLanguageName, getTranslateShortcutLabel, isApplePlatform,
} from './uiText';

test('shortcut label follows the platform', () => {
  assert.equal(getTranslateShortcutLabel('MacIntel'), '⌘ + Enter');
  assert.equal(getTranslateShortcutLabel('macOS'), '⌘ + Enter');
  assert.equal(getTranslateShortcutLabel('iPad'), '⌘ + Enter');
  assert.equal(getTranslateShortcutLabel('Win32'), 'Ctrl + Enter');
  assert.equal(getTranslateShortcutLabel('Linux x86_64'), 'Ctrl + Enter');
  assert.equal(getTranslateShortcutLabel(undefined), 'Ctrl + Enter');
  assert.equal(isApplePlatform(''), false);
});

test('language codes and model-reported names resolve to selector names', () => {
  assert.equal(getLanguageName('zh-CN', SUPPORTED_LANGUAGES), '简体中文');
  assert.equal(getLanguageName('ZH-tw', SUPPORTED_LANGUAGES), '繁體中文');
  assert.equal(getLanguageName('auto', SUPPORTED_LANGUAGES), '自动识别');
  assert.equal(getLanguageName('', SUPPORTED_LANGUAGES), '自动识别');
  assert.equal(getLanguageName('en-US', SUPPORTED_LANGUAGES), 'English');
  assert.equal(getLanguageName('zh', SUPPORTED_LANGUAGES), '简体中文');
  assert.equal(getLanguageName('english', SUPPORTED_LANGUAGES), 'English');
  // Unknown values are shown verbatim rather than hidden.
  assert.equal(getLanguageName('Klingon', SUPPORTED_LANGUAGES), 'Klingon');
});

test('history language pairs are readable', () => {
  assert.equal(formatLanguagePair('auto', 'zh-CN', SUPPORTED_LANGUAGES), '自动识别 → 简体中文');
  assert.equal(formatLanguagePair('ja', 'en', SUPPORTED_LANGUAGES), '日本語 → English');
});

test('history timestamps carry a date once they are not from today', () => {
  const now = new Date(2026, 9, 9, 11, 0).getTime();
  assert.equal(formatHistoryTime(new Date(2026, 9, 9, 3, 9).getTime(), now), '今天 03:09');
  assert.equal(formatHistoryTime(new Date(2026, 9, 8, 23, 59).getTime(), now), '昨天 23:59');
  assert.equal(formatHistoryTime(new Date(2026, 0, 2, 8, 5).getTime(), now), '1月2日 08:05');
  assert.equal(formatHistoryTime(new Date(2025, 11, 31, 8, 5).getTime(), now), '2025年12月31日');
  assert.equal(formatHistoryTime(Number.NaN, now), '');
});

test('history timestamps handle the first day of a month and year', () => {
  const newYear = new Date(2027, 0, 1, 9, 0).getTime();
  assert.equal(formatHistoryTime(new Date(2026, 11, 31, 22, 0).getTime(), newYear), '昨天 22:00');
});

test('configuration errors point to settings', () => {
  for (const message of ['Invalid API Key', 'HTTP 401 Unauthorized', '402 Payment Required', 'insufficient_quota', 'Model not found (404)', 'Please check Settings']) {
    const info = describeTranslationError(message, 'openai');
    assert.equal(info.kind, 'config', message);
    assert.equal(info.suggestSettings, true, message);
  }
});

test('rate limits, network and local-service failures get distinct guidance', () => {
  assert.equal(describeTranslationError('429 Too Many Requests').kind, 'rate-limit');
  assert.equal(describeTranslationError('Rate limit exceeded').suggestSettings, false);
  assert.equal(describeTranslationError('TypeError: Failed to fetch', 'gemini').kind, 'network');
  const local = describeTranslationError('TypeError: Failed to fetch', 'ollama');
  assert.equal(local.kind, 'local-service');
  assert.equal(local.suggestSettings, true);
  const unknown = describeTranslationError('Something odd happened');
  assert.equal(unknown.kind, 'unknown');
  assert.ok(unknown.hint.length > 0);
});
