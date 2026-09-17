import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';

test('microphone worklet is an external asset allowed by extension CSP', async () => {
  const result = await build({ build: { write: false }, logLevel: 'silent' });
  const output = result.output;
  const audio = output.find(item => item.type === 'chunk' && item.code.includes('audioWorklet.addModule'));
  assert.ok(audio);
  assert.doesNotMatch(audio.code, /audioWorklet\.addModule\(new URL\(["']data:/);
  assert.ok(output.some(item => item.type === 'asset' && /audio-capture-worklet.*\.js$/.test(item.fileName)));
});
