import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingPcmPlayer, audioPlayer } from './audio';

const RATE = 24000;

/** Minimal AudioContext stand-in: records when each buffer was scheduled. */
class FakeAudioContext {
  static last: FakeAudioContext;
  currentTime = 0;
  destination = {};
  scheduled: Array<{ when: number; samples: Float32Array }> = [];
  constructor() {
    FakeAudioContext.last = this;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
  createBufferSource() {
    const ctx = this;
    return {
      buffer: null as any,
      connect() {},
      disconnect() {},
      stop() {},
      start(when: number) {
        ctx.scheduled.push({ when, samples: this.buffer.getChannelData(0) });
      },
    };
  }
  close() {}
}

(globalThis as any).window = {
  AudioContext: FakeAudioContext,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

/** base64 PCM16 of `seconds` of audio, every sample set to `value`. */
function pcmChunk(seconds: number, value = 1000): string {
  const samples = new Int16Array(Math.round(seconds * RATE)).fill(value);
  return Buffer.from(samples.buffer).toString('base64');
}

function newPlayer() {
  const player = new StreamingPcmPlayer();
  assert.ok(player.start(RATE));
  return { player, ctx: FakeAudioContext.last };
}

test('streamed audio waits for a buffer before playback starts', () => {
  const { player, ctx } = newPlayer();
  player.appendBase64(pcmChunk(0.2));
  player.appendBase64(pcmChunk(0.2));
  assert.equal(ctx.scheduled.length, 0);
  player.appendBase64(pcmChunk(0.2));
  assert.equal(ctx.scheduled.length, 1);
  assert.equal(ctx.scheduled[0].samples.length, Math.round(0.6 * RATE));
});

test('chunks that arrive in time are scheduled back-to-back', () => {
  const { player, ctx } = newPlayer();
  player.appendBase64(pcmChunk(0.6));
  ctx.currentTime = 0.3;
  player.appendBase64(pcmChunk(0.2));
  assert.equal(ctx.scheduled.length, 2);
  const first = ctx.scheduled[0];
  assert.equal(ctx.scheduled[1].when, first.when + first.samples.length / RATE);
});

test('when playback catches up it rebuffers a larger amount', () => {
  const { player, ctx } = newPlayer();
  player.appendBase64(pcmChunk(0.6));
  ctx.currentTime = 2; // queue ran dry before the next chunk arrived
  player.appendBase64(pcmChunk(0.6));
  assert.equal(ctx.scheduled.length, 1, 'waits for 1.2s instead of playing 0.6s');
  player.appendBase64(pcmChunk(0.6));
  assert.equal(ctx.scheduled.length, 2);
  assert.equal(ctx.scheduled[1].samples.length, Math.round(1.2 * RATE));
});

test('finish plays audio that is still buffered', () => {
  const { player, ctx } = newPlayer();
  player.appendBase64(pcmChunk(0.1));
  player.finish();
  assert.equal(ctx.scheduled.length, 1);
});

test('a sample split across chunks is not dropped', () => {
  const { player, ctx } = newPlayer();
  const bytes = Buffer.from(new Int16Array([1000, -2000, 3000]).buffer);
  player.appendBase64(bytes.subarray(0, 3).toString('base64'));
  player.appendBase64(bytes.subarray(3).toString('base64'));
  player.finish();
  const out = Array.from(ctx.scheduled[0].samples, (v) => Math.round(v * 32768));
  assert.deepEqual(out, [1000, -2000, 3000]);
});

test('audioPlayer caches cloud TTS audio and avoids duplicate requests', async () => {
  audioPlayer.clearCache();
  let fetchCount = 0;
  const origFetch = globalThis.fetch;
  const origAudio = (globalThis as any).Audio;
  const origURL = (globalThis as any).URL;
  const origBlob = (globalThis as any).Blob;

  globalThis.fetch = (async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        audioBase64: pcmChunk(0.1),
        mimeType: 'audio/pcm',
        sampleRate: RATE,
      }),
    } as any;
  }) as any;

  // Stub Audio/URL/Blob in case playAudioData uses HTMLAudioElement
  (globalThis as any).Blob = class { constructor(public parts: any[], public opts: any) {} };
  (globalThis as any).URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
  (globalThis as any).Audio = class {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    async play() { this.onended?.(); }
    pause() {}
  };

  try {
    await audioPlayer.speak({ text: 'hello', lang: 'en', engine: 'openai', voice: 'alloy', rate: 1.0 });
    await audioPlayer.speak({ text: 'hello', lang: 'en', engine: 'openai', voice: 'alloy', rate: 1.0 });
    assert.equal(fetchCount, 1);
    assert.equal(audioPlayer.getCacheSize(), 1);
  } finally {
    globalThis.fetch = origFetch;
    (globalThis as any).Audio = origAudio;
    (globalThis as any).URL = origURL;
    (globalThis as any).Blob = origBlob;
    audioPlayer.clearCache();
  }
});
