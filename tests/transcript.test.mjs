import test from "node:test";
import assert from "node:assert/strict";
import { mergePartial } from "../js/transcript.js";

test("transcript fragments trim boundary whitespace before merging", () => {
  assert.equal(mergePartial("  第一段  ", "  第二段  "), "第一段第二段");
  assert.equal(mergePartial("", "  單一片段  "), "單一片段");
  assert.equal(mergePartial("保留內容", "   "), "保留內容");
});

test("cumulative transcript updates keep their internal spacing", () => {
  assert.equal(mergePartial("Hello", "  Hello world  "), "Hello world");
  assert.equal(mergePartial("Hello world", " world "), "Hello world");
});

test("streamed Latin text keeps meaningful boundary spaces without spacing CJK text", () => {
  assert.equal(mergePartial("Hello ", "world"), "Hello world");
  assert.equal(mergePartial("Hello,", " world"), "Hello, world");
  assert.equal(mergePartial("第一段 ", "第二段"), "第一段第二段");
});
