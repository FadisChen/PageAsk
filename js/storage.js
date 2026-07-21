import { DEFAULT_SETTINGS, SETTINGS_KEY, SOURCE_KEY, VOICES } from "./constants.js";

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
