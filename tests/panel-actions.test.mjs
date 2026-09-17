import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const panel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

// Exercise the actual panel handlers with browser/storage dependencies replaced.
function handlers(names, dependencies) {
  const context = vm.createContext(dependencies);
  for (const name of names) {
    const source = panel.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`))?.[0];
    assert.ok(source, `Missing handler ${name}`);
    vm.runInContext(source, context);
  }
  return context;
}

test("clearing and replacing a source during a conversation preserves transcript and source history", async () => {
  const updates = [];
  const oldSource = { title: "第一篇", text: "舊資料" };
  const transcript = { lines: ["既有對話"] };
  const state = {
    started: true, activeMode: "reading", source: oldSource, transcript,
    sessionSources: [{ title: oldSource.title }],
    session: { updateSource: source => updates.push(source) },
  };
  let cleared = false;
  const context = handlers(["applySource", "clearCurrentSource"], {
    state, clearSource: async () => { cleared = true; },
    renderSource() {}, renderControls() {}, toast() {},
  });
  await context.clearCurrentSource();
  assert.ok(cleared);
  assert.equal(state.source, null);
  assert.equal(state.transcript, transcript);
  assert.equal(state.started, true);
  const next = { title: "第二篇", text: "新資料" };
  context.applySource(next);
  context.applySource({ ...next }); // Storage event and upload completion must not send twice.
  assert.deepEqual(updates, [null, next]);
  assert.deepEqual(Array.from(state.sessionSources, item => item.title), ["第一篇", "第二篇"]);
});

test("delete all confirms full scope, clears pinned and filtered records, and preserves an active conversation", async () => {
  const state = { history: [{ id: "1", pinned: true }, { id: "2" }], historyQuery: "搜尋", started: true };
  const elements = { deleteAllHistoryButton: {}, historySearchInput: { value: "搜尋" } };
  let approved = false;
  const writes = [];
  const context = handlers(["deleteAllHistory"], {
    state, elements,
    confirm: message => { assert.match(message, /全部 2 筆/); assert.match(message, /已釘選/); return approved; },
    saveHistory: async value => { writes.push(value); return value; },
    renderHistoryList() {}, toast() {},
  });
  await context.deleteAllHistory();
  assert.equal(writes.length, 0);
  approved = true;
  await context.deleteAllHistory();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 0);
  assert.equal(state.history.length, 0);
  assert.equal(state.historyQuery, "");
  assert.equal(elements.historySearchInput.value, "");
  assert.equal(state.started, true);
});

test("failed bulk deletion retains history and reports the error", async () => {
  const history = [{ id: "1" }];
  const state = { history };
  const notices = [];
  const context = handlers(["deleteAllHistory"], {
    state, elements: { deleteAllHistoryButton: {} }, confirm: () => true,
    saveHistory: async () => { throw new Error("storage failed"); },
    renderHistoryList() {}, toast: message => notices.push(message),
  });
  await context.deleteAllHistory();
  assert.equal(state.history, history);
  assert.match(notices[0], /storage failed/);
});
