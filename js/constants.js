export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
export const GROUNDING_MODEL = "gemini-2.5-flash";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const SETTINGS_KEY = "pageAskSettings";
export const SOURCE_KEY = "activeSource";
export const MEMORIES_KEY = "pageAskMemories";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 60000;
export const MAX_COMPANION_PROMPT_CHARS = 12000;
export const MAX_MEMORY_CHARS = 4000;

export const CONVERSATION_MODES = Object.freeze(["reading", "companion"]);

export const DEFAULT_COMPANION_SYSTEM_PROMPT = `你是「小書僮」，一位溫暖、真誠、有分寸的陪伴者。你的首要任務是陪使用者自然聊天、傾聽並回應情緒。先理解再回應，不急著說教、下結論或一次提供大量建議；需要給建議時，先確認使用者是否想聽。回應適合口語聆聽，通常簡短自然，但在使用者想深入談時可以展開。你可以溫和幽默並延續目前話題，但不要假裝具有真實世界的身體、生活經歷或人類關係。`;

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  voiceName: "Kore",
  conversationMode: "reading",
  companionSystemPrompt: DEFAULT_COMPANION_SYSTEM_PROMPT,
  companionMemoryEnabled: true,
  companionMemoryBudgetTokens: 3000,
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
