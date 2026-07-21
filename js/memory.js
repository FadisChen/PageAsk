import { consolidateMemories, extractMemories } from "./gemini.js";
import { createMemory, estimateTokens } from "./storage.js";

export async function processCompanionMemory({
  apiKey,
  transcript,
  memories,
  budgetTokens,
  extractImpl = extractMemories,
  consolidateImpl = consolidateMemories,
}) {
  const current = Array.isArray(memories) ? memories : [];
  if (!Array.isArray(transcript) || !transcript.length) {
    return { memories: current, additions: 0, consolidated: false, warning: "" };
  }

  const additions = await extractImpl(apiKey, transcript, current);
  if (!additions.length) {
    return { memories: current, additions: 0, consolidated: false, warning: "" };
  }

  let next = [...current, ...additions.map((content) => createMemory(content, false)).filter(Boolean)];
  const budget = Math.max(200, Number(budgetTokens) || 3000);
  if (memoryTokens(next) <= budget) {
    return { memories: next, additions: additions.length, consolidated: false, warning: "" };
  }

  const locked = next.filter((memory) => memory.locked);
  const unlocked = next.filter((memory) => !memory.locked);
  if (!unlocked.length) {
    return {
      memories: next,
      additions: additions.length,
      consolidated: false,
      warning: "鎖定記憶已超過預算；小書僮不會自動刪除它們。",
    };
  }

  const lockedTokens = memoryTokens(locked);
  const targetTokens = Math.max(200, budget - lockedTokens);
  try {
    const merged = await consolidateImpl(apiKey, unlocked, targetTokens);
    if (!merged.length) {
      return {
        memories: next,
        additions: additions.length,
        consolidated: false,
        warning: "記憶已新增，但 Gemini 沒有回傳可用的整併結果。",
      };
    }
    next = [...locked, ...merged.map((content) => createMemory(content, false)).filter(Boolean)];
    return { memories: next, additions: additions.length, consolidated: true, warning: "" };
  } catch (error) {
    return {
      memories: next,
      additions: additions.length,
      consolidated: false,
      warning: `記憶已新增，但超額整併失敗：${error.message}`,
    };
  }
}

export function memoryTokens(memories) {
  return (memories || []).reduce((sum, memory) => sum + estimateTokens(memory?.content), 0);
}
