import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest uses minimum MV3 permissions and local-only extension code", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"].sort());
  assert.deepEqual(manifest.host_permissions, ["https://generativelanguage.googleapis.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions.sort(), ["http://*/*", "https://*/*"].sort());
  assert.equal("options_page" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-inline|unsafe-eval/);
});

test("HTML IDs are unique and all script resources are local", async () => {
  for (const file of ["sidepanel.html", "options.html"]) {
    const html = await readFile(path.join(root, file), "utf8");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} contains duplicate IDs`);
    for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.doesNotMatch(match[1], /^https?:\/\//, `${file} loads a remote script`);
    }
  }
});

test("production source contains no unapproved models or fallback providers", async () => {
  const files = await collectJavaScript(root);
  const productionFiles = files.filter((file) => !file.includes(`${path.sep}tests${path.sep}`));
  const source = (await Promise.all(productionFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const modelNames = [...source.matchAll(/gemini-[a-z0-9.-]+/gi)].map((match) => match[0]);
  assert.deepEqual([...new Set(modelNames)].sort(), [
    "gemini-2.5-flash",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-3.1-flash-live-preview",
  ]);
  assert.doesNotMatch(source, /tavily|googleMaps|<all_urls>/i);
});

test("side panel declares TranscriptCollector before creating state", async () => {
  const source = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const declaration = source.indexOf("export class TranscriptCollector");
  const initialization = source.indexOf("transcript: new TranscriptCollector()");
  assert.ok(declaration >= 0, "TranscriptCollector declaration is missing");
  assert.ok(initialization >= 0, "TranscriptCollector initialization is missing");
  assert.ok(declaration < initialization, "TranscriptCollector must be declared before initialization");
});

test("temporary content clears only when hiding an idle side panel or changing modes", async () => {
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const storage = await readFile(path.join(root, "js", "storage.js"), "utf8");
  assert.match(storage, /export async function clearSource\(\)[\s\S]*?storage\.session\.remove\(SOURCE_KEY\)/);
  assert.match(panel, /document\.addEventListener\("visibilitychange",[\s\S]*?document\.visibilityState === "hidden" &&[\s\S]*?!state\.started &&[\s\S]*?!state\.ending &&[\s\S]*?!state\.memoryProcessing[\s\S]*?clearTemporaryContent\(\)/);
  assert.match(panel, /window\.addEventListener\("beforeunload",[\s\S]*?state\.session\?\.stop\(false\);[\s\S]*?clearTemporaryContent\(\)/);
  assert.match(panel, /async function clearTemporaryContent\(\)[\s\S]*?state\.transcript = new TranscriptCollector\(\);[\s\S]*?state\.source = null;[\s\S]*?await clearSource\(\)/);
  assert.match(panel, /async function setConversationMode\(mode\)[\s\S]*?await clearTemporaryContent\(\)/);
});

test("settings stay inside the side panel dialog", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const script = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /<dialog[^>]+id="settingsDialog"/);
  assert.match(html, /id="settingsLiveModel"/);
  assert.match(html, /id="settingsThinkingLevel"[^>]+type="range"/);
  assert.match(script, /settingsDialog\.showModal\(\)/);
  assert.doesNotMatch(script, /openOptionsPage/);
});

test("block picker does not reject a tab only because its URL is unavailable", async () => {
  const background = await readFile(path.join(root, "background.js"), "utf8");
  assert.doesNotMatch(background, /isInjectableUrl\(tab\.url\)/);
  assert.match(background, /chrome\.scripting\.executeScript/);
});

test("composer sends on Enter and inserts a newline only on Ctrl+Enter", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const script = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /Enter 送出 · Ctrl\+Enter 換行/);
  assert.match(script, /event\.ctrlKey/);
  assert.match(script, /setRangeText\(/);
  assert.match(script, /composer\.requestSubmit\(\)/);
  assert.match(script, /event\.isComposing/);
});

test("side panel warns about microphone permission before starting", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const script = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /id="microphoneNotice"/);
  assert.match(script, /navigator\.permissions\.query\(\{ name: "microphone" \}\)/);
  assert.match(script, /chrome:\/\/settings\/content\/microphone/);
  assert.match(script, /monitorMicrophonePermission\(\) === "denied"/);
});

test("text-only mode starts Live without requesting microphone capture", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const audio = await readFile(path.join(root, "js", "audio.js"), "utf8");
  const worklet = await readFile(path.join(root, "js", "audio-capture-worklet.js"), "utf8");
  assert.match(html, /id="textOnlyMode"/);
  assert.match(panel, /captureMicrophone: useMicrophone/);
  assert.match(panel, /文字對談已連線/);
  assert.match(panel, /muteButton\.classList\.toggle\("is-hidden", textOnly\)/);
  assert.match(panel, /callActions\.classList\.toggle\("is-text-only", textOnly\)/);
  assert.match(audio, /if \(captureMicrophone\) \{/);
  assert.match(audio, /audioWorklet\.addModule/);
  assert.match(audio, /new AudioWorkletNode/);
  assert.doesNotMatch(audio, /createScriptProcessor|onaudioprocess/);
  assert.match(worklet, /registerProcessor\("pageask-audio-capture"/);
  assert.match(worklet, /const CAPTURE_SIZE = 1024/);
  assert.match(panel, /requestAnimationFrame\(\(\) => \{/);
});

test("options page exposes the same Live thinking slider", async () => {
  const html = await readFile(path.join(root, "options.html"), "utf8");
  const script = await readFile(path.join(root, "options.js"), "utf8");
  assert.match(html, /id="liveThinkingLevel"[^>]+type="range"/);
  assert.match(script, /liveThinkingLevel/);
  assert.match(script, /describeLiveThinking/);
});

test("streaming transcript updates existing rows instead of rebuilding the full list", async () => {
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const renderer = panel.match(/function renderTranscript\(\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction scheduleTranscriptRender/)?.[0] || "";
  assert.match(renderer, /elements\.transcript\.children\[index\]/);
  assert.match(renderer, /text\.textContent !== line\.text/);
  assert.doesNotMatch(renderer, /replaceChildren\(\)/);
});

test("companion mode can start without a source and exposes local memory controls", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /id="readingModeButton"/);
  assert.match(html, /id="companionModeButton"/);
  assert.match(html, /id="settingsCompanionPrompt"/);
  assert.match(html, /id="settingsMemoryEnabled"/);
  assert.match(html, /id="settingsMemoryBudget"[^>]+max="12000"/);
  assert.match(html, /id="memoryList"/);
  assert.match(panel, /mode === "reading" && !state\.source/);
  assert.match(panel, /buildCompanionSystemInstruction/);
  assert.match(panel, /fitMemoriesToBudget\(state\.memories, state\.activeMemoryConfig\.budgetTokens\)/);
  assert.match(panel, /promptMemories\.memories\.map/);
  assert.match(panel, /processCompanionMemory/);
  assert.match(panel, /state\.memoryProcessing/);
});

test("grounding feed is collapsed by default and remains user-expandable", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const details = html.match(/<details[^>]+id="toolFeed"[^>]*>/)?.[0] || "";
  assert.match(details, /<details/);
  assert.doesNotMatch(details, /\sopen(?:\s|=|>)/);
  assert.match(html, /<summary>/);
});

async function collectJavaScript(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") output.push(...await collectJavaScript(target));
    } else if (entry.name.endsWith(".js")) {
      output.push(target);
    }
  }
  return output;
}
