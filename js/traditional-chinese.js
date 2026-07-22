import OpenCC from "../vendor/opencc-cn2t.js";

// Gemini Live 的 inputAudioTranscription 目前無法指定繁體字形；比照 Android
// 在顯示與收集使用者逐字稿前，於本機將簡體中文轉為繁體中文。
const convertToTraditional = OpenCC.Converter({ from: "cn", to: "t" });

export function toTraditionalChinese(text) {
  return convertToTraditional(String(text ?? ""));
}
