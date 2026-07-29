import { consolidateMemories, extractMemories } from "./gemini.js";
import { DEFAULT_SETTINGS, MAX_MEMORY_BUDGET_TOKENS } from "./constants.js";
import { createMemory, estimateTokens, updateMemory } from "./storage.js";

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
    return memoryResult(current);
  }

  const budget = normalizeMemoryBudget(budgetTokens);
  const extractionContext = fitMemoriesToBudget(current, budget).memories;
  const operations = await extractImpl(apiKey, transcript, extractionContext);
  const applied = applyMemoryOperations(current, operations);
  if (!applied.additions && !applied.updates && memoryTokens(current) <= budget) {
    return memoryResult(current);
  }

  let next = applied.memories;
  if (memoryTokens(next) <= budget) {
    return memoryResult(next, applied);
  }

  const locked = next.filter((memory) => memory.locked);
  const unlocked = next.filter((memory) => !memory.locked);
  const lockedTokens = memoryTokens(locked);
  if (lockedTokens >= budget || !unlocked.length) {
    const fitted = fitMemoriesToBudget(next, budget, { preserveAllLocked: true });
    const omittedNotice = fitted.omittedCount
      ? `另有 ${fitted.omittedCount} 條未鎖定記憶因超額而移除。`
      : "";
    return memoryResult(fitted.memories, applied, {
      warning: lockedTokens > budget
        ? `鎖定記憶已超過預算；內容仍保留在本機，下次對談只會載入預算容許的部分。${omittedNotice}`
        : `鎖定記憶已用盡預算。${omittedNotice}`,
    });
  }

  const targetTokens = budget - lockedTokens;
  try {
    const consolidationOperations = await consolidateImpl(apiKey, unlocked, targetTokens);
    const consolidated = applyMemoryOperations(next, consolidationOperations, { allowDelete: true });
    next = consolidated.updates || consolidated.deletions ? consolidated.memories : next;
    const beforeFitTokens = memoryTokens(next);
    const fitted = fitMemoriesToBudget(next, budget, { preserveAllLocked: true });
    const noUsableResult = !consolidated.updates && !consolidated.deletions;
    const stillOverBudget = beforeFitTokens > budget;
    const warnings = [];
    if (noUsableResult) warnings.push("Gemini 沒有回傳可用的整併操作。");
    if (stillOverBudget) warnings.push("Gemini 整併後仍超過預算，已自動保留較重要且較近期的記憶。");
    return memoryResult(fitted.memories, applied, {
      consolidated: !noUsableResult,
      warning: warnings.join(" "),
    });
  } catch (error) {
    const fitted = fitMemoriesToBudget(next, budget, { preserveAllLocked: true });
    return memoryResult(fitted.memories, applied, {
      warning: `記憶已更新，但超額整併失敗：${error.message} 已自動保留預算內較重要且較近期的記憶。`,
    });
  }
}

export function applyMemoryOperations(memories, operations, {
  allowDelete = false,
  now = Date.now(),
} = {}) {
  const current = Array.isArray(memories) ? memories : [];
  const validOperations = Array.isArray(operations) ? operations : [];
  const byId = new Map(current.map((memory) => [memory.id, memory]));
  const deleteIds = new Set();
  if (allowDelete) {
    for (const operation of validOperations) {
      const target = byId.get(operation?.targetId);
      if (operation?.action === "delete" && target && !target.locked) deleteIds.add(target.id);
    }
  }

  let next = current.filter((memory) => !deleteIds.has(memory.id));
  const seenContent = new Set(next.map((memory) => normalizeMemory(memory.content)));
  let additions = 0;
  let updates = 0;

  for (const operation of validOperations) {
    if (!operation || typeof operation !== "object") continue;
    if (operation.action === "add") {
      const memory = createMemory(operation.content, false, {
        userConfirmed: false,
        lastConfirmedAt: now,
      });
      const key = normalizeMemory(memory?.content);
      if (!memory || seenContent.has(key)) continue;
      next.push(memory);
      seenContent.add(key);
      additions += 1;
      continue;
    }
    if (operation.action !== "update" || deleteIds.has(operation.targetId)) continue;
    const index = next.findIndex((memory) => memory.id === operation.targetId);
    const target = next[index];
    if (!target || target.locked) continue;
    const updated = updateMemory(target, operation.content, false, {
      userConfirmed: false,
      lastConfirmedAt: now,
    });
    const oldKey = normalizeMemory(target.content);
    const newKey = normalizeMemory(updated?.content);
    if (!updated || newKey === oldKey || (seenContent.has(newKey) && newKey !== oldKey)) continue;
    seenContent.delete(oldKey);
    seenContent.add(newKey);
    next[index] = updated;
    updates += 1;
  }

  return { memories: next, additions, updates, deletions: deleteIds.size };
}

export function fitMemoriesToBudget(memories, budgetTokens, {
  preserveAllLocked = false,
} = {}) {
  const source = Array.isArray(memories) ? memories : [];
  const budget = normalizeMemoryBudget(budgetTokens);
  const locked = sortByPriority(source.filter((memory) => memory?.locked));
  const unlocked = sortByPriority(source.filter((memory) => !memory?.locked));
  const selected = [];
  let usedTokens = 0;

  for (const memory of locked) {
    const tokens = estimateTokens(memory.content);
    if (preserveAllLocked || usedTokens + tokens <= budget) {
      selected.push(memory);
      usedTokens += tokens;
    }
  }
  for (const memory of unlocked) {
    const tokens = estimateTokens(memory.content);
    if (usedTokens + tokens > budget) continue;
    selected.push(memory);
    usedTokens += tokens;
  }

  return {
    memories: selected,
    budget,
    usedTokens,
    omittedCount: source.length - selected.length,
    lockedOverBudget: memoryTokens(locked) > budget,
  };
}

export function memoryTokens(memories) {
  return (memories || []).reduce((sum, memory) => sum + estimateTokens(memory?.content), 0);
}

function memoryResult(memories, counts = {}, overrides = {}) {
  return {
    memories,
    additions: counts.additions || 0,
    updates: counts.updates || 0,
    consolidated: false,
    warning: "",
    ...overrides,
  };
}

function normalizeMemoryBudget(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.companionMemoryBudgetTokens;
  return Math.min(MAX_MEMORY_BUDGET_TOKENS, Math.max(200, Math.round(number)));
}

function sortByPriority(memories) {
  return [...memories].sort((a, b) =>
    Number(Boolean(b.userConfirmed)) - Number(Boolean(a.userConfirmed))
    || memoryRecency(b) - memoryRecency(a));
}

function memoryRecency(memory) {
  return Number(memory?.lastConfirmedAt) || Number(memory?.updatedAt) || Number(memory?.createdAt) || 0;
}

function normalizeMemory(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-TW");
}
