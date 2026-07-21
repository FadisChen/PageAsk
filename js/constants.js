export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
export const GROUNDING_MODEL = "gemini-2.5-flash";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const SETTINGS_KEY = "pageAskSettings";
export const SOURCE_KEY = "activeSource";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 60000;

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  voiceName: "Kore",
});

export const VOICES = Object.freeze([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
]);

export const MESSAGE_TYPES = Object.freeze({
  START_BLOCK_PICKER: "START_BLOCK_PICKER",
  BLOCK_PICKED: "BLOCK_PICKED",
  BLOCK_PICK_CANCELLED: "BLOCK_PICK_CANCELLED",
  SOURCE_UPDATED: "SOURCE_UPDATED",
});
