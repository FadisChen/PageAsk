import { API_BASE, AUXILIARY_MODEL, PODCAST_TTS_MODEL } from "./constants.js";

export const PODCAST_FORMATS = Object.freeze(["solo", "duo"]);
export const PODCAST_TARGET_WORDS = 420;
export const PODCAST_SEGMENT_MAX_CHARS = 1800;
const PODCAST_SAMPLE_RATE = 24000;

function readJson(response) {
  return response.json().catch(() => ({}));
}

function httpErrorFromData(response, data, model) {
  return new Error(`HTTP ${response.status}：${data?.error?.message || response.statusText || "請求失敗"}（${model}）`);
}

export function buildPodcastScriptPrompt(sourceText, format, voice1, voice2) {
  const material = String(sourceText || "").trim();
  if (format === "duo") {
    return `請將以下素材整理成一段約 ${PODCAST_TARGET_WORDS} 字的繁體中文 Podcast 雙人對談講稿。
兩位講者代號分別是「${voice1}」與「${voice2}」，語氣要輕鬆自然、像在錄音給聽眾聽，兩人需互相問答、補充或延伸重點，不是各自獨白。
請用「${voice1}:」與「${voice2}:」開頭區分台詞，只輸出對話內容本身，不要標題、不要其他說明文字，全程使用台灣用語與連接詞。

素材：
${material}`;
  }
  return `請將以下素材整理成一篇約 ${PODCAST_TARGET_WORDS} 字的繁體中文單人 Podcast 講稿，語氣輕鬆自然、像主持人講給聽眾聽，開頭簡短破題、結尾自然收尾。只輸出講稿內容本身，不要標題或其他說明文字，全程使用台灣用語與連接詞。

素材：
${material}`;
}

export async function generatePodcastScript(apiKey, sourceText, format, { voice1, voice2 } = {}, { signal, fetchImpl = fetch } = {}) {
  const prompt = buildPodcastScriptPrompt(sourceText, format, voice1, voice2);
  const response = await fetchImpl(`${API_BASE}/models/${AUXILIARY_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  });
  const data = await readJson(response);
  if (!response.ok) throw httpErrorFromData(response, data, AUXILIARY_MODEL);
  const script = (data?.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text)
    .join("")
    .trim();
  if (!script) throw new Error("Gemini 沒有回傳可用的 Podcast 講稿，可能被安全過濾，請調整來源後再試。");
  return script;
}

export function splitPodcastScript(script, format, maxChars = PODCAST_SEGMENT_MAX_CHARS) {
  const text = String(script || "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const lines = format === "duo"
    ? text.split("\n").filter((line) => line.trim())
    : text.split(/(?<=[。！？])/).filter((line) => line.trim());

  const segments = [];
  let current = "";
  for (const line of lines) {
    const joiner = current && format === "duo" ? "\n" : "";
    const candidate = current ? `${current}${joiner}${line}` : line;
    if (candidate.length > maxChars && current) {
      segments.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function buildSpeechConfig(format, voice1, voice2) {
  if (format === "duo") {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: voice1, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } },
          { speaker: voice2, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
        ],
      },
    };
  }
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } };
}

export async function generatePodcastAudioSegment(apiKey, segmentScript, format, voice1, voice2, { signal, fetchImpl = fetch } = {}) {
  const promptPrefix = format === "duo"
    ? "請以自然的 Podcast 對談語氣朗讀以下對白：\n"
    : "請以自然的 Podcast 主持語氣朗讀以下講稿：\n";
  const response = await fetchImpl(`${API_BASE}/models/${PODCAST_TTS_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${promptPrefix}${segmentScript}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: buildSpeechConfig(format, voice1, voice2),
      },
    }),
  });
  const data = await readJson(response);
  if (!response.ok) throw httpErrorFromData(response, data, PODCAST_TTS_MODEL);
  const audioBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) throw new Error("Gemini 沒有回傳可用的語音內容。");
  return audioBase64;
}

export function base64ToPcmBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function mergePcmSegments(segments) {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const segment of segments) {
    merged.set(segment, offset);
    offset += segment.length;
  }
  return merged;
}

export function createPodcastWavBlob(pcmBytes) {
  let data = pcmBytes;
  if (data.length % 2 !== 0) {
    const padded = new Uint8Array(data.length + 1);
    padded.set(data);
    data = padded;
  }
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = PODCAST_SAMPLE_RATE * blockAlign;
  const buffer = new ArrayBuffer(44 + data.length);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, PODCAST_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, data.length, true);
  new Uint8Array(buffer, 44).set(data);
  return new Blob([buffer], { type: "audio/wav" });
}

export async function generatePodcastAudio(apiKey, script, format, voice1, voice2, { signal, fetchImpl = fetch, onProgress } = {}) {
  const segments = splitPodcastScript(script, format);
  if (!segments.length) throw new Error("講稿內容是空的，請先產生講稿。");
  const pcmSegments = [];
  for (let index = 0; index < segments.length; index += 1) {
    onProgress?.(index, segments.length);
    const audioBase64 = await generatePodcastAudioSegment(apiKey, segments[index], format, voice1, voice2, { signal, fetchImpl });
    pcmSegments.push(base64ToPcmBytes(audioBase64));
  }
  onProgress?.(segments.length, segments.length);
  return createPodcastWavBlob(mergePcmSegments(pcmSegments));
}
