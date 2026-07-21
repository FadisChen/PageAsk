import { MAX_SOURCE_CHARS } from "./constants.js";

const SOURCE_KINDS = new Set(["web-selection", "web-block", "file"]);

export function normalizeSourceText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+\n/g, "\n")
    .replace(/\n[\t\f\v ]+/g, "\n")
    .replace(/[\t\f\v ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createActiveSource(input, limit = MAX_SOURCE_CHARS) {
  if (!input || !SOURCE_KINDS.has(input.kind)) {
    throw new Error("不支援的來源類型。");
  }
  const normalized = normalizeSourceText(input.text);
  if (!normalized) throw new Error("來源中沒有可供對談的文字。");

  const characters = Array.from(normalized);
  const originalChars = characters.length;
  const retained = characters.slice(0, limit).join("");
  const url = safePageUrl(input.url);

  return {
    kind: input.kind,
    title: cleanLabel(input.title) || defaultTitle(input.kind),
    ...(url ? { url } : {}),
    ...(input.mimeType ? { mimeType: String(input.mimeType).slice(0, 120) } : {}),
    text: retained,
    originalChars,
    retainedChars: Array.from(retained).length,
    truncated: originalChars > limit,
  };
}

export function safePageUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function cleanLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function defaultTitle(kind) {
  if (kind === "web-selection") return "網頁反白文字";
  if (kind === "web-block") return "網頁內容區塊";
  return "上傳檔案";
}
