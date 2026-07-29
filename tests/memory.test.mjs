import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMemoryOperations,
  fitMemoriesToBudget,
  memoryTokens,
  processCompanionMemory,
} from "../js/memory.js";
import { createMemory } from "../js/storage.js";

test("empty transcript skips all Gemini memory work", async () => {
  let called = false;
  const current = [createMemory("使用者喜歡茶", true)];
  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [],
    memories: current,
    budgetTokens: 3000,
    extractImpl: async () => { called = true; return []; },
  });
  assert.equal(called, false);
  assert.equal(result.memories, current);
});

test("memory consolidation only receives unlocked memories and preserves locked entries", async () => {
  const locked = createMemory("使用者的生日是 1 月 2 日", true);
  const unlocked = createMemory("舊的未鎖定記憶".repeat(30), false);
  let consolidatedInput;
  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "我最近開始學陶藝" }],
    memories: [locked, unlocked],
    budgetTokens: 200,
    extractImpl: async () => [{ action: "add", content: "使用者最近開始學陶藝".repeat(20) }],
    consolidateImpl: async (_key, memories) => {
      consolidatedInput = memories;
      const target = memories.find((memory) => memory.id === unlocked.id);
      return [
        { action: "update", targetId: target.id, content: "使用者最近開始學陶藝" },
        ...memories
          .filter((memory) => memory.id !== target.id)
          .map((memory) => ({ action: "delete", targetId: memory.id })),
      ];
    },
  });

  assert.ok(consolidatedInput.every((memory) => !memory.locked));
  assert.ok(result.memories.some((memory) => memory.id === locked.id && memory.locked));
  assert.ok(result.memories.some((memory) => memory.content === "使用者最近開始學陶藝" && !memory.locked));
  assert.equal(result.consolidated, true);
});

test("failed consolidation keeps the newest extracted memory within the hard budget", async () => {
  const existing = createMemory("舊".repeat(150), false, {
    userConfirmed: false,
    lastConfirmedAt: 1,
  });
  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "我喜歡爵士樂" }],
    memories: [existing],
    budgetTokens: 200,
    extractImpl: async () => [{ action: "add", content: "新".repeat(100) }],
    consolidateImpl: async () => { throw new Error("quota"); },
  });

  assert.equal(result.additions, 1);
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].content, "新".repeat(100));
  assert.ok(memoryTokens(result.memories) <= 200);
  assert.match(result.warning, /整併失敗/);
});

test("memory operations preserve identity and cannot update or delete locked memories", () => {
  const locked = createMemory("使用者喜歡茶", true);
  const unlocked = createMemory("使用者住在臺北", false);
  const result = applyMemoryOperations(
    [locked, unlocked],
    [
      { action: "update", targetId: locked.id, content: "不得修改" },
      { action: "delete", targetId: locked.id },
      { action: "update", targetId: unlocked.id, content: "使用者住在新竹" },
      { action: "add", content: "使用者喜歡陶藝" },
    ],
    { allowDelete: true, now: 12345 },
  );

  assert.equal(result.additions, 1);
  assert.equal(result.updates, 1);
  assert.equal(result.deletions, 0);
  assert.equal(result.memories.find((memory) => memory.id === locked.id).content, "使用者喜歡茶");
  const updated = result.memories.find((memory) => memory.id === unlocked.id);
  assert.equal(updated.content, "使用者住在新竹");
  assert.equal(updated.lastConfirmedAt, 12345);
  assert.equal(updated.userConfirmed, false);
});

test("prompt selection never exceeds budget even when locked storage does", () => {
  const locked = createMemory("鎖".repeat(250), true);
  const unlocked = createMemory("新".repeat(100), false);

  const stored = fitMemoriesToBudget([locked, unlocked], 200, { preserveAllLocked: true });
  assert.deepEqual(stored.memories, [locked]);
  assert.equal(stored.lockedOverBudget, true);

  const prompt = fitMemoriesToBudget(stored.memories, 200);
  assert.equal(memoryTokens(prompt.memories), 0);
  assert.equal(prompt.omittedCount, 1);
});

test("memory extraction only receives existing memories that fit the budget", async () => {
  const locked = createMemory("鎖".repeat(150), true);
  const unlocked = createMemory("舊".repeat(100), false);
  let extractionContext;

  await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "沒有新資訊" }],
    memories: [locked, unlocked],
    budgetTokens: 200,
    extractImpl: async (_key, _transcript, memories) => {
      extractionContext = memories;
      return [];
    },
  });

  assert.ok(memoryTokens(extractionContext) <= 200);
  assert.deepEqual(extractionContext, [locked]);
});

test("existing over-budget memories are consolidated even without new operations", async () => {
  const first = createMemory("甲".repeat(150), false);
  const second = createMemory("乙".repeat(100), false);
  let consolidated = false;

  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "沒有新資訊" }],
    memories: [first, second],
    budgetTokens: 200,
    extractImpl: async () => [],
    consolidateImpl: async () => {
      consolidated = true;
      return [{ action: "delete", targetId: second.id }];
    },
  });

  assert.equal(consolidated, true);
  assert.deepEqual(result.memories, [first]);
  assert.ok(memoryTokens(result.memories) <= 200);
});

test("overlong consolidation output is fitted before it can be saved", async () => {
  const existing = createMemory("舊".repeat(150), false);
  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "新資訊" }],
    memories: [existing],
    budgetTokens: 200,
    extractImpl: async () => [{ action: "add", content: "新".repeat(100) }],
    consolidateImpl: async (_key, memories) => [{
      action: "update",
      targetId: memories[0].id,
      content: "整".repeat(400),
    }],
  });

  assert.ok(memoryTokens(result.memories) <= 200);
  assert.match(result.warning, /仍超過預算/);
});
