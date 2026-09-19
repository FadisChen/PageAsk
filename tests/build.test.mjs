import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

test('source manifest loads the bundled extension entrypoints', async () => {
  const manifest = JSON.parse(await readFile(resolve('manifest.json'), 'utf8'));

  assert.equal(manifest.background.service_worker, 'dist/background.js');
  assert.equal(manifest.side_panel.default_path, 'dist/sidepanel.html');
});

test('microphone worklet is an external asset allowed by extension CSP', async () => {
  const result = await build({ build: { write: false }, logLevel: 'silent' });
  const output = result.output;
  const audio = output.find(item => item.type === 'chunk' && item.code.includes('audioWorklet.addModule'));
  const html = output.find(item => item.type === 'asset' && item.fileName === 'sidepanel.html');
  const chunks = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');

  assert.ok(audio);
  assert.ok(html);
  assert.doesNotMatch(audio.code, /audioWorklet\.addModule\(new URL\(["']data:/);
  assert.match(html.source, /(?:src|href)="\.\/assets\//);
  assert.doesNotMatch(html.source, /(?:src|href)="\/assets\//);
  assert.doesNotMatch(chunks, /(?:from|import)\s*["'](?:three|@pixiv\/three-vrm)(?:\/[^"']*)?["']/);
  assert.ok(output.some(item => item.type === 'asset' && /audio-capture-worklet.*\.js$/.test(item.fileName)));
});
