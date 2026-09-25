export const AVATAR_EMOTIONS = Object.freeze(["neutral", "happy", "sad", "angry", "surprised"]);
export const AVATAR_EMOTION_HOLD_SECONDS = 3;

export const AVATAR_EMOTION_TOOL = Object.freeze({
  name: "set_avatar_emotion",
  behavior: "NON_BLOCKING",
  description: "只有在回覆需要明顯表情或情緒轉折時選擇一個表情；每個回覆最多呼叫一次。",
  parameters: {
    type: "OBJECT",
    properties: {
      emotion: { type: "STRING", enum: [...AVATAR_EMOTIONS], description: "回覆的主要表情。" },
    },
    required: ["emotion"],
  },
});

export function normalizeAvatarEmotion(args) {
  const emotion = args && typeof args === "object" && !Array.isArray(args) ? args.emotion : undefined;
  if (!AVATAR_EMOTIONS.includes(emotion)) {
    return { ok: false, error: `不支援的 emotion：${String(emotion ?? "")}。` };
  }
  return { ok: true, emotion };
}
