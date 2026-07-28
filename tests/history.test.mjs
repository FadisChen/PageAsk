import test from "node:test";
import assert from "node:assert/strict";

import {
  addHistoryEntry,
  createHistoryEntry,
  deriveHistoryTitle,
  exportHistoryToMarkdown,
  matchesHistorySearch,
} from "../js/history.js";
import { estimateStorageBytes } from "../js/storage.js";

function makeEntry(overrides = {}) {
  return createHistoryEntry({
    mode: "reading",
    transcript: [
      { role: "user", text: "這段內容在說什麼？" },
      { role: "model", text: "這是一段測試逐字稿。" },
    ],
    startedAt: 0,
    endedAt: 0,
    ...overrides,
  });
}

test("createHistoryEntry normalizes transcript and derives source titles", () => {
  const entry = createHistoryEntry({
    mode: "reading",
    sources: [{ title: "測試文章" }],
    transcript: [{ role: "user", text: "重點是什麼？" }, { role: "model", text: "重點是 A 和 B。" }],
    startedAt: 100,
    endedAt: 200,
  });
  assert.equal(entry.mode, "reading");
  assert.deepEqual(entry.sourceTitles, ["測試文章"]);
  assert.equal(entry.transcript.length, 2);
  assert.equal(entry.pinned, false);
});

test("createHistoryEntry drops entries without any transcript content", () => {
  assert.equal(createHistoryEntry({ mode: "companion", transcript: [], startedAt: 1, endedAt: 2 }), null);
});

test("addHistoryEntry evicts oldest unpinned entries once the entry-count budget is exceeded", () => {
  let history = [];
  for (let i = 0; i < 3; i += 1) {
    history = addHistoryEntry(history, makeEntry({ startedAt: i, endedAt: i }), { maxEntries: 3, maxTotalBytes: Infinity }).history;
  }
  const result = addHistoryEntry(history, makeEntry({ startedAt: 10, endedAt: 10 }), { maxEntries: 3, maxTotalBytes: Infinity });
  assert.equal(result.history.length, 3);
  assert.equal(result.evictedCount, 1);
  assert.equal(result.history.some((entry) => entry.endedAt === 0), false);
});

test("addHistoryEntry never evicts pinned entries and reports a warning once none remain", () => {
  const pinned = { ...makeEntry({ startedAt: 0, endedAt: 0 }), pinned: true };
  const result = addHistoryEntry([pinned], makeEntry({ startedAt: 5, endedAt: 5 }), { maxEntries: 1, maxTotalBytes: Infinity });
  assert.equal(result.history.length, 2);
  assert.match(result.warning, /已釘選/);
});

test("addHistoryEntry evicts on the byte budget even under the entry-count limit", () => {
  const first = makeEntry({ startedAt: 0, endedAt: 0 });
  const second = makeEntry({ startedAt: 1, endedAt: 1 });
  const singleEntryBytes = estimateStorageBytes([first]);
  const result = addHistoryEntry([first], second, { maxEntries: 100, maxTotalBytes: Math.round(singleEntryBytes * 1.5) });
  assert.equal(result.evictedCount, 1);
  assert.equal(result.history.length, 1);
});

test("matchesHistorySearch matches transcript content case-insensitively and empty query matches everything", () => {
  const entry = makeEntry();
  assert.equal(matchesHistorySearch(entry, "測試"), true);
  assert.equal(matchesHistorySearch(entry, "找不到的關鍵字"), false);
  assert.equal(matchesHistorySearch(entry, ""), true);
});

test("deriveHistoryTitle prefers source titles over transcript text", () => {
  const withSource = createHistoryEntry({
    mode: "reading",
    sources: [{ title: "來源標題" }],
    transcript: [{ role: "user", text: "問題" }],
    startedAt: 1,
    endedAt: 2,
  });
  assert.equal(deriveHistoryTitle(withSource), "來源標題");

  const withoutSource = createHistoryEntry({
    mode: "companion",
    transcript: [{ role: "user", text: "今天天氣真好" }],
    startedAt: 1,
    endedAt: 2,
  });
  assert.equal(deriveHistoryTitle(withoutSource), "今天天氣真好");
});

test("exportHistoryToMarkdown renders role labels and metadata", () => {
  const markdown = exportHistoryToMarkdown(makeEntry());
  assert.match(markdown, /^# /);
  assert.match(markdown, /模式：閱讀/);
  assert.match(markdown, /\*\*你\*\*：這段內容在說什麼？/);
  assert.match(markdown, /\*\*小書僮\*\*：這是一段測試逐字稿。/);
});
