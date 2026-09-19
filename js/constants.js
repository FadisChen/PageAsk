export const LIVE_MODEL_OPTIONS = Object.freeze([
  Object.freeze({
    id: "gemini-3.8-live",
    label: "Gemini 3.8 Live（非同步工具）",
  }),
]);

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

export function getLiveModelOption(id) {
  return LIVE_MODEL_OPTIONS.find((option) => option.id === id)
    || LIVE_MODEL_OPTIONS.find((option) => option.id === DEFAULT_LIVE_MODEL);
}

export const GROUNDING_MODEL = "gemini-2.5-flash";
export const AUXILIARY_MODEL = "gemini-3.5-flash-lite";
export const PODCAST_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const SETTINGS_KEY = "pageAskSettings";
export const SOURCE_KEY = "activeSource";
export const MEMORIES_KEY = "pageAskMemories";
export const HISTORY_KEY = "pageAskHistory";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Keep a generous character guard for unusually token-efficient text, but use
// the token limit below as the actual Live source budget.
export const MAX_SOURCE_CHARS = 60000;
export const SOURCE_TOKEN_WARNING_TOKENS = 16000;
export const MAX_SOURCE_TOKENS = 20000;
export const MAX_COMPANION_PROMPT_CHARS = 12000;
export const MAX_MEMORY_CHARS = 4000;
export const MAX_MEMORY_BUDGET_TOKENS = 12000;
export const MAX_HISTORY_ENTRIES = 300;
export const MAX_HISTORY_ENTRY_CHARS = 40000;
export const MAX_HISTORY_TOTAL_BYTES = 8 * 1024 * 1024;

export const CONVERSATION_MODES = Object.freeze(["reading", "companion"]);
export const AVATAR_MODES = Object.freeze(["vrm", "true-man"]);
export const DEFAULT_AVATAR_MODE = "vrm";

export const DEFAULT_COMPANION_SYSTEM_PROMPT = `你是「小書僮」，一位溫暖、真誠、有分寸的陪伴者。你的首要任務是陪使用者自然聊天、傾聽並回應情緒。先理解再回應，不急著說教、下結論或一次提供大量建議；需要給建議時，先確認使用者是否想聽。回應適合口語聆聽，通常簡短自然，但在使用者想深入談時可以展開。你可以溫和幽默並延續目前話題，但不要假裝具有真實世界的身體、生活經歷或人類關係。`;

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  liveModel: DEFAULT_LIVE_MODEL,
  voiceName: "Kore",
  conversationMode: "reading",
  avatarMode: DEFAULT_AVATAR_MODE,
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
  EXECUTE_BROWSER_TOOL: "EXECUTE_BROWSER_TOOL",
});
