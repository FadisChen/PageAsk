import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest uses minimum MV3 permissions and local-only extension code", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "120");
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "contextMenus", "scripting", "sidePanel", "storage", "unlimitedStorage"].sort());
  assert.deepEqual(manifest.optional_permissions.sort(), ["bookmarks", "downloads", "history", "readingList", "tabs"].sort());
  assert.deepEqual(manifest.host_permissions, ["https://generativelanguage.googleapis.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions.sort(), ["http://*/*", "https://*/*"].sort());
  assert.equal("options_page" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-inline|unsafe-eval/);
});

test("HTML IDs are unique and all script resources are local", async () => {
  for (const file of ["sidepanel.html"]) {
    const html = await readFile(path.join(root, file), "utf8");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} contains duplicate IDs`);
    for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.doesNotMatch(match[1], /^https?:\/\//, `${file} loads a remote script`);
    }
  }
});

test("production source contains only the approved models and no fallback providers", async () => {
  const files = await collectJavaScript(root);
  const productionFiles = files.filter((file) => !file.includes(`${path.sep}tests${path.sep}`));
  const source = (await Promise.all(productionFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const modelNames = [...source.matchAll(/gemini-[a-z0-9.-]+/gi)].map((match) => match[0]);
  assert.deepEqual([...new Set(modelNames)].sort(), [
    "gemini-2.5-flash",
    "gemini-3.1-flash-tts-preview",
    "gemini-3.5-flash-lite",
    "gemini-3.8-live",
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

test("temporary content clears only when closing the side panel or changing modes", async () => {
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const storage = await readFile(path.join(root, "js", "storage.js"), "utf8");
  assert.match(storage, /export async function clearSource\(\)[\s\S]*?storage\.session\.remove\(SOURCE_KEY\)/);
  assert.doesNotMatch(panel, /visibilitychange/);
  assert.match(panel, /window\.addEventListener\("beforeunload",[\s\S]*?state\.session\?\.stop\(false\);[\s\S]*?clearTemporaryContent\(\)/);
  assert.match(panel, /async function clearTemporaryContent\(\)[\s\S]*?state\.transcript = new TranscriptCollector\(\);[\s\S]*?state\.source = null;[\s\S]*?await clearSource\(\)/);
  assert.match(panel, /async function setConversationMode\(mode\)[\s\S]*?await clearTemporaryContent\(\)/);
});

test("settings stay inside the side panel dialog", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const script = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /<dialog[^>]+id="settingsDialog"/);
  assert.match(html, /固定使用 Gemini 3\.8 Live/);
  assert.doesNotMatch(html, /settingsLiveModel/);
  assert.doesNotMatch(html, /thinkingLevel|thinkingConfig/);
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
  assert.doesNotMatch(panel, /elements\.voiceStatus|elements\.voiceHint/);
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

test("settings live only in the side panel without a separate options page", async () => {
  const config = await readFile(path.join(root, "vite.config.js"), "utf8");
  assert.doesNotMatch(config, /options\.html/);
  await assert.rejects(readFile(path.join(root, "options.html"), "utf8"));
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

test("Avatar stays in the side panel with subtitles over the canvas", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  assert.match(html, /id="avatarCanvas"/);
  assert.match(html, /id="trueManAvatarCanvas"/);
  assert.match(html, /id="settingsTrueManMode"/);
  assert.match(html, /id="captionText"/);
  assert.match(panel, /TrueManAvatarController/);
  assert.match(panel, /saveSettingsWithAvatar/);
  assert.doesNotMatch(html, /showOverlayButton|closeOverlaysButton|voiceStatus|voiceHint/);
  assert.doesNotMatch(panel, /syncOverlay|claimSidePanelSession/);
});

test("真人 Avatar keeps the shared output-drained controller interface", async () => {
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const controller = await readFile(path.join(root, "js", "avatar", "true-man-avatar-controller.js"), "utf8");
  assert.match(panel, /avatarController\?\.resetAnimation\(\)/);
  assert.match(controller, /resetAnimation\(\)\s*\{\s*this\.reset\(\);\s*\}/);
});

test("真人 Avatar assets are local and use only the required variants", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "avatars", "true-man", "avatar-manifest.json"), "utf8"));
  const required = [
    manifest.base,
    manifest.blink,
    ...Object.values(manifest.visemes),
    ...Object.values(manifest.emotions).filter(Boolean),
  ];
  for (const relativePath of required) {
    await readFile(path.resolve(root, "avatars", "true-man", relativePath.replace(/^\.\//, "")));
  }
  assert.equal("gaze" in manifest, false);
  await assert.rejects(readFile(path.join(root, "avatars", "true-man", "assets", "variants-v5", "gaze-left.png")));
});

test("screen sharing uses the Chrome picker and stops with the session", async () => {
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const share = await readFile(path.join(root, "js", "screen-share.js"), "utf8");
  assert.match(html, /id="screenShareButton"[^>]*disabled/);
  assert.match(share, /getDisplayMedia\(/);
  assert.match(share, /image\/jpeg/);
  assert.match(panel, /sendVideoFrame\(bytes\)/);
  assert.match(panel, /async function endSession[\s\S]*?state\.screenShare\?\.stop\(\)/);
});

test("screen frames are scaled down to the maximum edge", async () => {
  const { fitFrame } = await import("../js/screen-share.js");
  assert.deepEqual(fitFrame(1920, 1080, 1024), { width: 1024, height: 576 });
  assert.deepEqual(fitFrame(800, 600, 1024), { width: 800, height: 600 });
});

test("browser tools are confirmation-aware and use safe web URLs", async () => {
  const { BROWSER_TOOL_DECLARATIONS, isMutatingBrowserTool, safeHttpUrl } = await import("../js/browser-tools.js");
  assert.ok(BROWSER_TOOL_DECLARATIONS.some((tool) => tool.name === "list_open_tabs"));
  assert.equal(isMutatingBrowserTool("add_bookmark"), true);
  assert.equal(isMutatingBrowserTool("search_history"), false);
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("https://example.com/path"), "https://example.com/path");
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

test("side panel element bindings all exist in the HTML", async () => {
  const panel = await readFile(path.join(root, "sidepanel.js"), "utf8");
  const html = await readFile(path.join(root, "sidepanel.html"), "utf8");
  const bindings = panel.slice(panel.indexOf("const elements ="), panel.indexOf("let microphonePermissionStatus"));
  for (const [, id] of bindings.matchAll(/"([A-Za-z]+)"/g)) {
    assert.ok(html.includes(`id="${id}"`), `Missing element: ${id}`);
  }
});
