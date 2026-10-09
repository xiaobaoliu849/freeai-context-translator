import test from 'node:test';
import assert from 'node:assert/strict';
import { getFloatingSize, clampFloatingPosition } from './floatingLayout';

test('reading and expanded sizes fit a small viewport', () => {
  assert.deepEqual(getFloatingSize({ width: 1440, height: 900 }), { width: 560, height: 720 });
  assert.deepEqual(getFloatingSize({ width: 390, height: 480 }, true), { width: 366, height: 456 });
});

test('selection near the lower right leaves the entire card visible on a scrolled page', () => {
  const viewport = { width: 1000, height: 800, scrollX: 200, scrollY: 1500 };
  assert.deepEqual(clampFloatingPosition({ x: 1180, y: 2290 }, { width: 560, height: 720 }, viewport), { x: 628, y: 1568 });
});

test('expansion and dragging keep all edges inside the viewport', () => {
  const viewport = { width: 1200, height: 960, scrollX: 0, scrollY: 300 };
  const size = getFloatingSize(viewport, true);
  assert.deepEqual(clampFloatingPosition({ x: -500, y: 9999 }, size, viewport), { x: 12, y: 348 });
});
