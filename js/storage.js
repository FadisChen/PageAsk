import {
  CONVERSATION_MODES,
  DEFAULT_SETTINGS,
  MAX_COMPANION_PROMPT_CHARS,
  MAX_MEMORY_CHARS,
  MEMORIES_KEY,
  SETTINGS_KEY,
  SOURCE_KEY,
  VOICES,
} from "./constants.js";

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return cleanSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(value) {
  const settings = cleanSettings(value);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

export function cleanSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  return {
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
    voiceName: VOICES.includes(settings.voiceName) ? settings.voiceName : DEFAULT_SETTINGS.voiceName,
    conversationMode: CONVERSATION_MODES.includes(settings.conversationMode)
      ? settings.conversationMode
      : DEFAULT_SETTINGS.conversationMode,
    companionSystemPrompt: cleanString(
      settings.companionSystemPrompt,
      DEFAULT_SETTINGS.companionSystemPrompt,
      MAX_COMPANION_PROMPT_CHARS,
    ),
    companionMemoryEnabled: settings.companionMemoryEnabled !== false,
    companionMemoryBudgetTokens: numberInRange(
      settings.companionMemoryBudgetTokens,
      200,
      100000,
      DEFAULT_SETTINGS.companionMemoryBudgetTokens,
    ),
  };
}

export async function loadSource() {
  const stored = await chrome.storage.session.get(SOURCE_KEY);
  return stored[SOURCE_KEY] || null;
}

export async function saveSource(source) {
  await chrome.storage.session.set({ [SOURCE_KEY]: source });
  return source;
}

export async function clearSource() {
  await chrome.storage.session.remove(SOURCE_KEY);
}

export async function loadMemories() {
  const stored = await chrome.storage.local.get(MEMORIES_KEY);
  return cleanMemories(stored[MEMORIES_KEY]);
}

export async function saveMemories(value) {
  const memories = cleanMemories(value);
  await chrome.storage.local.set({ [MEMORIES_KEY]: memories });
  return memories;
}

export function cleanMemories(value) {
  return Array.isArray(value) ? value.map(cleanMemory).filter(Boolean) : [];
}

export function cleanMemory(value) {
  if (!value || typeof value !== "object") return null;
  const content = typeof value.content === "string" ? value.content.trim().slice(0, MAX_MEMORY_CHARS) : "";
  if (!content) return null;
  const now = Date.now();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId(),
    content,
    locked: Boolean(value.locked),
    createdAt: Number(value.createdAt) || now,
    updatedAt: Number(value.updatedAt) || Number(value.createdAt) || now,
  };
}

export function createMemory(content, locked = true) {
  const now = Date.now();
  return cleanMemory({ id: makeId(), content, locked, createdAt: now, updatedAt: now });
}

export function updateMemory(current, content, locked = current?.locked) {
  if (!current) return null;
  return cleanMemory({
    ...current,
    content,
    locked,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  });
}

export function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const character of String(text || "")) {
    const code = character.codePointAt(0);
    if ((code >= 0x3000 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function cleanString(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
