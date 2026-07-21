import test from "node:test";
import assert from "node:assert/strict";
import { floatToPcm16, resample } from "../js/audio.js";

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
