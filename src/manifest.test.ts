import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Chrome Web Store review rejects extensions that request permissions they
// never use. Every API permission in manifest.json must have a matching
// chrome.<api> call somewhere in src/ (tests excluded).
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$|\.d\.ts$/.test(entry.name)) {
        out.push(fs.readFileSync(p, 'utf8'));
      }
    }
  };
  walk(path.join(root, 'src'));
  return out.join('\n');
}

const src = sourceText();

test('every API permission in manifest.json is used in source', () => {
  for (const perm of manifest.permissions as string[]) {
    assert.ok(src.includes(`chrome.${perm}`), `permission "${perm}" is declared but chrome.${perm} is never used`);
  }
});

test('manifest drops activeTab and tts, which the extension does not need', () => {
  // activeTab: all-sites host access already covers it.
  // tts: read-aloud uses window.speechSynthesis and network TTS, never chrome.tts.
  for (const perm of ['activeTab', 'tts']) {
    assert.ok(!(manifest.permissions as string[]).includes(perm), `${perm} should not be requested`);
  }
});

test('permission justifications doc covers every declared permission', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/CHROME_STORE_PERMISSIONS.md'), 'utf8');
  for (const perm of [...manifest.permissions, 'host_permissions'] as string[]) {
    assert.ok(doc.includes(`\`${perm}\``), `docs/CHROME_STORE_PERMISSIONS.md is missing "${perm}"`);
  }
});

test('privacy policy names every third-party endpoint the extension can send text to', () => {
  const policy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
  for (const needle of ['translate.google.com', 'chrome.storage.local', 'Ollama', 'remote code']) {
    assert.ok(policy.includes(needle), `PRIVACY.md should mention "${needle}"`);
  }
});

test('web_accessible_resources exposes only what the content script loads', () => {
  const resources = (manifest.web_accessible_resources as { resources: string[] }[]).flatMap((r) => r.resources);
  assert.deepEqual([...resources].sort(), ['assets/yumai-mark.svg', 'content.css']);
  assert.ok(!resources.some((r) => r.includes('*')), 'no wildcard resources: they let any site fingerprint the extension');
});

test('store listing short description fits the 132-character limit', () => {
  assert.ok((manifest.description as string).length <= 132, 'manifest description is too long for the store');
});
