import test from "node:test";
import assert from "node:assert/strict";
import { BrowserAudioEngine, floatToPcm16, resample } from "../js/audio.js";

test("float samples are clipped and encoded as little-endian PCM16", () => {
  const bytes = floatToPcm16(new Float32Array([-2, -1, 0, 1, 2]));
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), -32768);
  assert.equal(view.getInt16(4, true), 0);
  assert.equal(view.getInt16(6, true), 32767);
  assert.equal(view.getInt16(8, true), 32767);
});

test("audio is downsampled to the expected length", () => {
  const input = new Float32Array(48000).fill(0.25);
  const output = resample(input, 48000, 16000);
  assert.equal(output.length, 16000);
  assert.ok(Math.abs(output[100] - 0.25) < 1e-6);
});

test("flushing playback reports output drained exactly once", () => {
  let drained = 0;
  const audio = new BrowserAudioEngine({ onOutputDrained: () => { drained += 1; } });
  const sources = [1, 2, 3].map(() => {
    const source = { stop() { queueMicrotask(() => this.onended?.()); } };
    source.onended = () => { audio.activeSources.delete(source); if (!audio.activeSources.size) audio.onOutputDrained?.(); };
    audio.activeSources.add(source);
    return source;
  });
  audio.flushPlayback();
  assert.equal(drained, 1);
  assert.ok(sources.every((source) => source.onended === null));
  audio.flushPlayback();
  assert.equal(drained, 1);
});

test("closing while microphone permission is pending stops the late stream", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalContext = globalThis.AudioContext;
  let resolveMicrophone;
  let trackStops = 0;
  let contextCloses = 0;
  const node = () => ({ gain: {}, connect() {}, disconnect() {} });
  globalThis.AudioContext = class {
    state = "running";
    async resume() {}
    createGain() { return node(); }
    createAnalyser() { return node(); }
    async close() { this.state = "closed"; contextCloses += 1; }
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolveMicrophone = resolve; }) },
  } });
  try {
    const audio = new BrowserAudioEngine();
    const starting = audio.start();
    await Promise.resolve();
    await audio.stop();
    resolveMicrophone({ getTracks: () => [{ stop() { trackStops += 1; } }] });
    await assert.rejects(starting, { name: "AbortError" });
    assert.equal(trackStops, 1);
    assert.equal(contextCloses, 1);
    assert.equal(audio.running, false);
    assert.equal(audio.stream, null);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalContext) globalThis.AudioContext = originalContext;
    else delete globalThis.AudioContext;
  }
});
