import {
  CONVERSATION_MODES,
  DEFAULT_SETTINGS,
  getLiveModelOption,
  getLiveThinkingOption,
  HISTORY_KEY,
  MAX_COMPANION_PROMPT_CHARS,
  MAX_HISTORY_ENTRY_CHARS,
  MAX_MEMORY_BUDGET_TOKENS,
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
    liveModel: getLiveModelOption(settings.liveModel).id,
    liveThinkingLevel: getLiveThinkingOption(settings.liveThinkingLevel).id,
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
      MAX_MEMORY_BUDGET_TOKENS,
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
  const createdAt = Number(value.createdAt) || now;
  const updatedAt = Number(value.updatedAt) || createdAt;
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId(),
    content,
    locked: Boolean(value.locked),
    userConfirmed: typeof value.userConfirmed === "boolean" ? value.userConfirmed : Boolean(value.locked),
    lastConfirmedAt: Number(value.lastConfirmedAt) || updatedAt,
    createdAt,
    updatedAt,
  };
}

export function createMemory(content, locked = true, {
  userConfirmed = true,
  lastConfirmedAt = Date.now(),
} = {}) {
  const now = Date.now();
  return cleanMemory({
    id: makeId(),
    content,
    locked,
    userConfirmed,
    lastConfirmedAt,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateMemory(current, content, locked = current?.locked, {
  userConfirmed = true,
  lastConfirmedAt = Date.now(),
} = {}) {
  if (!current) return null;
  return cleanMemory({
    ...current,
    content,
    locked,
    userConfirmed,
    lastConfirmedAt,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  });
}

export async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return cleanHistory(stored[HISTORY_KEY]);
}

export async function saveHistory(value) {
  const history = cleanHistory(value);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return history;
}

export function cleanHistory(value) {
  return Array.isArray(value) ? value.map(cleanHistoryEntry).filter(Boolean) : [];
}

export function cleanHistoryEntry(value) {
  if (!value || typeof value !== "object") return null;
  const rawTranscript = Array.isArray(value.transcript)
    ? value.transcript.map(cleanTranscriptLine).filter(Boolean)
    : [];
  if (!rawTranscript.length) return null;
  const originalChars = rawTranscript.reduce((sum, line) => sum + line.text.length, 0);
  const { transcript, truncated } = capTranscript(rawTranscript, MAX_HISTORY_ENTRY_CHARS);
  const now = Date.now();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId(),
    mode: value.mode === "companion" ? "companion" : "reading",
    personaId: typeof value.personaId === "string" && value.personaId ? value.personaId : null,
    personaName: cleanString(value.personaName, "", 120),
    sourceTitles: Array.isArray(value.sourceTitles)
      ? value.sourceTitles.map((title) => cleanString(title, "", 240)).filter(Boolean)
      : [],
    transcript,
    startedAt: Number(value.startedAt) || now,
    endedAt: Number(value.endedAt) || now,
    pinned: Boolean(value.pinned),
    truncated: Boolean(value.truncated) || truncated,
    originalChars,
    createdAt: Number(value.createdAt) || now,
    updatedAt: Number(value.updatedAt) || Number(value.createdAt) || now,
  };
}

function cleanTranscriptLine(value) {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return null;
  return { role: value.role === "model" ? "model" : "user", text };
}

function capTranscript(lines, limit) {
  let used = 0;
  const kept = [];
  for (const line of lines) {
    if (used + line.text.length > limit) break;
    kept.push(line);
    used += line.text.length;
  }
  if (!kept.length && lines.length) kept.push({ role: lines[0].role, text: lines[0].text.slice(0, limit) });
  return { transcript: kept, truncated: kept.length < lines.length };
}

export function estimateStorageBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
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

export function cleanString(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

export function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export function makeId() {
  return globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
