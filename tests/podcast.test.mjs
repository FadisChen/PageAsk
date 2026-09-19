import test from "node:test";
import assert from "node:assert/strict";
import { AUXILIARY_MODEL, PODCAST_TTS_MODEL } from "../js/constants.js";
import {
  base64ToPcmBytes,
  buildPodcastScriptPrompt,
  createPodcastWavBlob,
  generatePodcastAudio,
  generatePodcastAudioSegment,
  generatePodcastScript,
  mergePcmSegments,
  splitPodcastScript,
} from "../js/podcast.js";

test("solo prompt asks for a single narrator and omits speaker labels", () => {
  const prompt = buildPodcastScriptPrompt("素材內容", "solo", "Kore", "Puck");
  assert.match(prompt, /單人 Podcast 講稿/);
  assert.doesNotMatch(prompt, /Kore:/);
  assert.match(prompt, /素材內容/);
});

test("podcast prompt scales depth and length with the source", () => {
  const shortPrompt = buildPodcastScriptPrompt("短文內容。".repeat(100), "solo", "Kore", "Puck");
  const longPrompt = buildPodcastScriptPrompt("長文內容，包含多個論點與背景脈絡。".repeat(1500), "solo", "Kore", "Puck");

  assert.match(shortPrompt, /約 650–900 字/);
  assert.match(longPrompt, /約 2,800–4,200 字/);
  assert.match(longPrompt, /核心主旨|必要背景|證據／數據／例子/);
  assert.doesNotMatch(shortPrompt, /約 420 字/);
});

test("duo prompt names both speakers using their voice ids as labels", () => {
  const prompt = buildPodcastScriptPrompt("素材內容", "duo", "Kore", "Puck");
  assert.match(prompt, /「Kore」與「Puck」/);
  assert.match(prompt, /「Kore:」與「Puck:」/);
});

test("generatePodcastScript posts to the auxiliary model with the api key header and returns trimmed text", async () => {
  let requestedUrl = "";
  let requestedOptions;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "  講稿內容  " }] } }] }),
    };
  };
  const script = await generatePodcastScript("key", "素材", "solo", { voice1: "Kore" }, { fetchImpl });
  assert.match(requestedUrl, new RegExp(`${AUXILIARY_MODEL}:generateContent$`));
  assert.equal(requestedOptions.headers["x-goog-api-key"], "key");
  assert.equal(JSON.parse(requestedOptions.body).generationConfig.maxOutputTokens, 4096);
  assert.equal(script, "講稿內容");
});

test("generatePodcastScript rejects an empty response", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [] }) });
  await assert.rejects(
    generatePodcastScript("key", "素材", "solo", { voice1: "Kore" }, { fetchImpl }),
    /沒有回傳可用的 Podcast 講稿/,
  );
});

test("generatePodcastScript surfaces HTTP errors from the API", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    json: async () => ({ error: { message: "quota exceeded" } }),
  });
  await assert.rejects(
    generatePodcastScript("key", "素材", "solo", { voice1: "Kore" }, { fetchImpl }),
    /HTTP 429.*quota exceeded/,
  );
});

test("splitPodcastScript keeps short scripts as a single segment", () => {
  assert.deepEqual(splitPodcastScript("一段很短的講稿。", "solo"), ["一段很短的講稿。"]);
  assert.deepEqual(splitPodcastScript("", "solo"), []);
});

test("splitPodcastScript splits long solo scripts on sentence boundaries", () => {
  const sentence = "這是一段用來測試切段邏輯的中文句子。";
  const script = sentence.repeat(120);
  const segments = splitPodcastScript(script, "solo", 500);
  assert.ok(segments.length > 1);
  for (const segment of segments) assert.ok(segment.length <= 500 + sentence.length);
  assert.equal(segments.join(""), script);
});

test("splitPodcastScript splits long duo scripts on dialogue lines and preserves line breaks", () => {
  const lines = Array.from({ length: 80 }, (_, index) => `Kore: 第 ${index} 句對白內容補滿長度長度長度`);
  const script = lines.join("\n");
  const segments = splitPodcastScript(script, "duo", 400);
  assert.ok(segments.length > 1);
  for (const segment of segments) {
    for (const line of segment.split("\n")) assert.match(line, /^Kore: /);
  }
});

test("generatePodcastAudioSegment builds a single-voice speechConfig for solo format", async () => {
  let requestedUrl = "";
  let requestedBody;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAA=" } }] } }] }),
    };
  };
  const audio = await generatePodcastAudioSegment("key", "講稿片段", "solo", "Kore", "Puck", { fetchImpl });
  assert.match(requestedUrl, new RegExp(`${PODCAST_TTS_MODEL}:generateContent$`));
  assert.deepEqual(requestedBody.generationConfig.speechConfig, {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
  });
  assert.equal(audio, "AAA=");
});

test("generatePodcastAudioSegment builds a multi-speaker speechConfig for duo format", async () => {
  let requestedBody;
  const fetchImpl = async (_url, options) => {
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAA=" } }] } }] }),
    };
  };
  await generatePodcastAudioSegment("key", "Kore: 嗨\nPuck: 你好", "duo", "Kore", "Puck", { fetchImpl });
  assert.deepEqual(requestedBody.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs, [
    { speaker: "Kore", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    { speaker: "Puck", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
  ]);
});

test("generatePodcastAudioSegment rejects a response without inline audio data", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{}] } }] }) });
  await assert.rejects(
    generatePodcastAudioSegment("key", "片段", "solo", "Kore", "Puck", { fetchImpl }),
    /沒有回傳可用的語音內容/,
  );
});

test("mergePcmSegments concatenates byte arrays in order", () => {
  const merged = mergePcmSegments([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
  assert.deepEqual([...merged], [1, 2, 3, 4, 5]);
});

test("createPodcastWavBlob writes a 44-byte RIFF/WAVE header and pads odd-length PCM data", async () => {
  const blob = createPodcastWavBlob(new Uint8Array([1, 2, 3]));
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 44 + 4);
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const header = String.fromCharCode(...buffer.slice(0, 4));
  assert.equal(header, "RIFF");
  assert.equal(String.fromCharCode(...buffer.slice(8, 12)), "WAVE");
});

test("generatePodcastAudio segments long scripts, reports progress, and returns a merged wav blob", async () => {
  const sentence = "這是一段用來測試整合流程的中文句子。";
  const script = sentence.repeat(120);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAA=" } }] } }] }) };
  };
  const progress = [];
  const blob = await generatePodcastAudio("key", script, "solo", "Kore", "Puck", {
    fetchImpl,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.ok(calls > 1, "long scripts should be split into more than one TTS call");
  assert.equal(progress.length, calls + 1);
  assert.equal(progress[progress.length - 1][0], progress[progress.length - 1][1]);
  assert.equal(blob.type, "audio/wav");
});

test("generatePodcastAudio rejects an empty script before calling the API", async () => {
  let fetched = false;
  await assert.rejects(
    generatePodcastAudio("key", "   ", "solo", "Kore", "Puck", { fetchImpl: async () => { fetched = true; } }),
    /講稿內容是空的/,
  );
  assert.equal(fetched, false);
});

test("base64ToPcmBytes decodes standard base64 into raw bytes", () => {
  assert.deepEqual([...base64ToPcmBytes("AAECAw==")], [0, 1, 2, 3]);
});
