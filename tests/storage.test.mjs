import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_COMPANION_SYSTEM_PROMPT } from "../js/constants.js";
import {
  cleanMemories,
  cleanSettings,
  createMemory,
  estimateTokens,
  updateMemory,
} from "../js/storage.js";

test("legacy settings receive companion defaults without losing existing values", () => {
  const settings = cleanSettings({ apiKey: " key ", voiceName: "Aoede" });
  assert.equal(settings.apiKey, "key");
  assert.equal(settings.voiceName, "Aoede");
  assert.equal(settings.conversationMode, "reading");
  assert.equal(settings.companionSystemPrompt, DEFAULT_COMPANION_SYSTEM_PROMPT);
  assert.equal(settings.companionMemoryEnabled, true);
  assert.equal(settings.companionMemoryBudgetTokens, 3000);
});

test("companion settings are validated and bounded", () => {
  const settings = cleanSettings({
    conversationMode: "unknown",
    companionSystemPrompt: "   ",
    companionMemoryEnabled: false,
    companionMemoryBudgetTokens: 999999,
  });
  assert.equal(settings.conversationMode, "reading");
  assert.equal(settings.companionSystemPrompt, DEFAULT_COMPANION_SYSTEM_PROMPT);
  assert.equal(settings.companionMemoryEnabled, false);
  assert.equal(settings.companionMemoryBudgetTokens, 100000);
});

test("memories clean, create, and update with stable identity", () => {
  const memory = createMemory("  使用者喜歡爬山  ", true);
  assert.equal(memory.content, "使用者喜歡爬山");
  assert.equal(memory.locked, true);

  const updated = updateMemory(memory, "使用者喜歡週末爬山", false);
  assert.equal(updated.id, memory.id);
  assert.equal(updated.createdAt, memory.createdAt);
  assert.equal(updated.content, "使用者喜歡週末爬山");
  assert.equal(updated.locked, false);
  assert.ok(updated.updatedAt >= memory.updatedAt);

  assert.deepEqual(cleanMemories([null, { content: " " }, updated]), [updated]);
});

test("token estimation weighs CJK characters directly", () => {
  assert.equal(estimateTokens("中文"), 2);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("中文abcd"), 3);
});
