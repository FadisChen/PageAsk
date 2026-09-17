import {
  MAX_SOURCE_CHARS,
  MAX_SOURCE_TOKENS,
  SOURCE_TOKEN_WARNING_TOKENS,
} from "./constants.js";

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

export function createActiveSource(input, limit = MAX_SOURCE_CHARS, tokenLimit = MAX_SOURCE_TOKENS) {
  if (!input || !SOURCE_KINDS.has(input.kind)) {
    throw new Error("不支援的來源類型。");
  }
  const normalized = normalizeSourceText(input.text);
  if (!normalized) throw new Error("來源中沒有可供對談的文字。");

  const characters = Array.from(normalized);
  const originalChars = characters.length;
  const originalTokens = estimateSourceTokens(normalized);
  const retained = retainWithinLimits(characters, limit, tokenLimit);
  const url = safePageUrl(input.url);

  return {
    kind: input.kind,
    title: cleanLabel(input.title) || defaultTitle(input.kind),
    ...(url ? { url } : {}),
    ...(input.mimeType ? { mimeType: String(input.mimeType).slice(0, 120) } : {}),
    text: retained.text,
    originalChars,
    retainedChars: retained.chars,
    originalTokens,
    retainedTokens: retained.tokens,
    tokenWarning: retained.tokens >= SOURCE_TOKEN_WARNING_TOKENS,
    truncated: retained.chars < originalChars,
  };
}

export function estimateSourceTokens(value) {
  let cjk = 0;
  let other = 0;
  for (const character of String(value || "")) {
    const code = character.codePointAt(0);
    if (
      (code >= 0x3000 && code <= 0x30ff)
      || (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

function retainWithinLimits(characters, maxChars, maxTokens) {
  let cjk = 0;
  let other = 0;
  let end = 0;
  for (const character of characters) {
    if (end >= maxChars) break;
    const code = character.codePointAt(0);
    const isCjk = (
      (code >= 0x3000 && code <= 0x30ff)
      || (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0xff00 && code <= 0xffef)
    );
    const nextCjk = cjk + Number(isCjk);
    const nextOther = other + Number(!isCjk);
    if (nextCjk + Math.ceil(nextOther / 4) > maxTokens) break;
    cjk = nextCjk;
    other = nextOther;
    end += 1;
  }

  return {
    text: characters.slice(0, end).join(""),
    chars: end,
    tokens: cjk + Math.ceil(other / 4),
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
