import test from "node:test";
import assert from "node:assert/strict";
import {
  createActiveSource,
  estimateSourceTokens,
  normalizeSourceText,
  safePageUrl,
} from "../js/source.js";

test("source normalization preserves paragraphs and removes noisy whitespace", () => {
  assert.equal(normalizeSourceText("  第一段  \r\n\r\n\r\n 第二段\t  內容  "), "第一段\n\n第二段 內容");
});

test("active source records exact truncation metadata", () => {
  const source = createActiveSource({ kind: "web-block", title: " Test  page ", text: "一二三四五六", url: "https://example.com/a" }, 4);
  assert.equal(source.text, "一二三四");
  assert.equal(source.originalChars, 6);
  assert.equal(source.retainedChars, 4);
  assert.equal(source.originalTokens, 6);
  assert.equal(source.retainedTokens, 4);
  assert.equal(source.truncated, true);
  assert.equal(source.title, "Test page");
});

test("source limits use token estimates instead of only character counts", () => {
  const chinese = createActiveSource({ kind: "file", text: "中".repeat(21000) });
  assert.equal(chinese.retainedChars, 20000);
  assert.equal(chinese.retainedTokens, 20000);
  assert.equal(chinese.originalTokens, 21000);
  assert.equal(chinese.truncated, true);
  assert.equal(chinese.tokenWarning, true);

  const english = createActiveSource({ kind: "file", text: "word ".repeat(12000) });
  assert.equal(english.truncated, false);
  assert.equal(english.tokenWarning, false);
  assert.equal(estimateSourceTokens(english.text), english.retainedTokens);
});

test("source metadata warns before the hard token limit", () => {
  const source = createActiveSource({ kind: "web-block", text: "中".repeat(16000) });
  assert.equal(source.truncated, false);
  assert.equal(source.tokenWarning, true);
  assert.equal(source.retainedTokens, 16000);
});

test("active source rejects empty content and unknown kinds", () => {
  assert.throws(() => createActiveSource({ kind: "file", text: "  " }), /沒有可供對談/);
  assert.throws(() => createActiveSource({ kind: "image", text: "x" }), /不支援/);
});

test("page URLs only retain http and https protocols", () => {
  assert.equal(safePageUrl("https://example.com"), "https://example.com/");
  assert.equal(safePageUrl("chrome://extensions"), "");
  assert.equal(safePageUrl("javascript:alert(1)"), "");
});
