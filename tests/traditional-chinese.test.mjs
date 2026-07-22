import test from "node:test";
import assert from "node:assert/strict";
import { toTraditionalChinese } from "../js/traditional-chinese.js";

test("simplified Chinese STT text is converted to traditional Chinese", () => {
  assert.equal(toTraditionalChinese("我喜欢看电视剧"), "我喜歡看電視劇");
});

test("traditional Chinese and non-Chinese text stay unchanged", () => {
  assert.equal(toTraditionalChinese("今天天氣很好"), "今天天氣很好");
  assert.equal(toTraditionalChinese("Hello, world! 123"), "Hello, world! 123");
});
