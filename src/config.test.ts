import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CEREBRAS_MODELS, DEFAULT_SETTINGS, GLM_FLASH_MODELS, SETTINGS_VERSION,
  mergeKnownFreeModels, migrateSettings, parseSavedSettings,
} from './config';
import { parseSettingsFile, SETTINGS_EXPORT_FORMAT } from './utils/settingsExport';

test('missing or corrupt settings fall back to defaults', () => {
  assert.equal(parseSavedSettings(null), DEFAULT_SETTINGS);
  assert.equal(parseSavedSettings(''), DEFAULT_SETTINGS);
  assert.equal(parseSavedSettings('{not json'), DEFAULT_SETTINGS);
  assert.equal(parseSavedSettings('null'), DEFAULT_SETTINGS);
});

test('saved settings keep user values and gain new defaults', () => {
  const saved = JSON.stringify({ defaultProvider: 'deepseek', defaultTargetLang: 'ja', settingsVersion: SETTINGS_VERSION,
    providerConfigs: { deepseek: { apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', availableModels: [] } } });
  const settings = parseSavedSettings(saved);
  assert.equal(settings.defaultProvider, 'deepseek');
  assert.equal(settings.defaultTargetLang, 'ja');
  assert.equal(settings.providerConfigs.deepseek.apiKey, 'sk-test');
  // Providers the user never configured still exist with defaults.
  assert.equal(settings.providerConfigs.gemini.baseUrl, DEFAULT_SETTINGS.providerConfigs.gemini.baseUrl);
  assert.equal(settings.enableContextMenu, true);
});

test('settings stored as a raw object (older popup builds) are recovered', () => {
  const settings = parseSavedSettings({ defaultProvider: 'qwen', settingsVersion: SETTINGS_VERSION } as any);
  assert.equal(settings.defaultProvider, 'qwen');
});

test('legacy settings are migrated once and stamped with the current version', () => {
  const migrated = migrateSettings({ wordHoverMode: 'hover',
    providerConfigs: { cerebras: { apiKey: 'k', baseUrl: '', model: 'zai-glm-4.6', availableModels: [] } } as any });
  assert.equal(migrated.wordHoverMode, 'off');
  assert.equal(migrated.providerConfigs!.cerebras.model, 'gpt-oss-120b');
  assert.deepEqual(migrated.providerConfigs!.cerebras.availableModels, CEREBRAS_MODELS);
  assert.equal(migrated.settingsVersion, SETTINGS_VERSION);

  // A current install keeps its explicit choices.
  const current = migrateSettings({ settingsVersion: SETTINGS_VERSION, wordHoverMode: 'click',
    providerConfigs: { cerebras: { apiKey: '', baseUrl: '', model: 'gemma-4-31b', availableModels: [] } } as any });
  assert.equal(current.wordHoverMode, 'click');
  assert.equal(current.providerConfigs!.cerebras.model, 'gemma-4-31b');
});

test('free models are merged into fetched model lists without duplicates', () => {
  assert.deepEqual(mergeKnownFreeModels('glm', ['glm-4-plus']), [...GLM_FLASH_MODELS, 'glm-4-plus']);
  assert.deepEqual(mergeKnownFreeModels('glm', [...GLM_FLASH_MODELS]), GLM_FLASH_MODELS);
  assert.deepEqual(mergeKnownFreeModels('cerebras', ['gpt-oss-120b']), ['gemma-4-31b', 'llama-3.3-70b', 'gpt-oss-120b']);
  assert.deepEqual(mergeKnownFreeModels('openai', ['gpt-4o']), ['gpt-4o']);
});

test('settings import accepts the export wrapper and raw objects', () => {
  const wrapped = JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, version: 1, exportedAt: '2026-01-01',
    settings: { defaultProvider: 'moonshot', settingsVersion: SETTINGS_VERSION } });
  assert.equal(parseSettingsFile(wrapped).defaultProvider, 'moonshot');
  assert.equal(parseSettingsFile(JSON.stringify({ defaultProvider: 'groq', settingsVersion: SETTINGS_VERSION })).defaultProvider, 'groq');
});

test('settings import rejects files that are not settings', () => {
  assert.throws(() => parseSettingsFile('not json'), /不是有效的 JSON/);
  assert.throws(() => parseSettingsFile('[1,2]'), /没有有效的设置/);
  assert.throws(() => parseSettingsFile('"text"'), /没有有效的设置/);
  assert.throws(() => parseSettingsFile(JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, settings: null })), /没有有效的设置/);
});

test('legacy "edge" TTS engine migrates to the local browser voice', () => {
  const saved = JSON.stringify({ ttsEngine: 'edge', ttsVoice: 'zh-CN-XiaoxiaoNeural', settingsVersion: 4 });
  const settings = parseSavedSettings(saved);
  assert.equal(settings.ttsEngine, 'browser');
  assert.equal(settings.ttsVoice, 'default');
  assert.equal(settings.settingsVersion, SETTINGS_VERSION);
});

test('a chosen non-edge TTS engine survives the v5 migration', () => {
  const saved = JSON.stringify({ ttsEngine: 'openai', ttsVoice: 'alloy', settingsVersion: 4 });
  const settings = parseSavedSettings(saved);
  assert.equal(settings.ttsEngine, 'openai');
  assert.equal(settings.ttsVoice, 'alloy');
});
