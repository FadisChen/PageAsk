import test from "node:test";
import assert from "node:assert/strict";

import { processCompanionMemory } from "../js/memory.js";
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
    extractImpl: async () => ["使用者最近開始學陶藝".repeat(20)],
    consolidateImpl: async (_key, memories) => {
      consolidatedInput = memories;
      return ["使用者最近開始學陶藝"];
    },
  });

  assert.ok(consolidatedInput.every((memory) => !memory.locked));
  assert.ok(result.memories.some((memory) => memory.id === locked.id && memory.locked));
  assert.ok(result.memories.some((memory) => memory.content === "使用者最近開始學陶藝" && !memory.locked));
  assert.equal(result.consolidated, true);
});

test("failed consolidation keeps newly extracted memories", async () => {
  const result = await processCompanionMemory({
    apiKey: "key",
    transcript: [{ role: "user", text: "我喜歡爵士樂" }],
    memories: [],
    budgetTokens: 200,
    extractImpl: async () => ["使用者喜歡爵士樂".repeat(30)],
    consolidateImpl: async () => { throw new Error("quota"); },
  });

  assert.equal(result.additions, 1);
  assert.equal(result.memories.length, 1);
  assert.match(result.warning, /整併失敗/);
});
