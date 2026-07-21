import test from "node:test";
import assert from "node:assert/strict";
import { formatPdfPages, parseSourceFile } from "../js/file-parser.js";

function fakeFile(name, text, type = "text/plain") {
  const bytes = new TextEncoder().encode(text);
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
}

test("text, markdown, and CSV files are decoded locally", async () => {
  assert.equal(await parseSourceFile(fakeFile("note.txt", "hello")), "hello");
  assert.equal(await parseSourceFile(fakeFile("note.md", "# hello", "text/markdown")), "# hello");
  assert.equal(await parseSourceFile(fakeFile("data.csv", "a,b\n1,2", "text/csv")), "a,b\n1,2");
});

test("JSON input is validated and formatted", async () => {
  assert.equal(await parseSourceFile(fakeFile("data.json", "{\"ok\":true}", "application/json")), "{\n  \"ok\": true\n}");
  await assert.rejects(() => parseSourceFile(fakeFile("bad.json", "{")), /JSON 檔案格式不正確/);
});

test("PDF pages are extracted in page order", async () => {
  let destroyed = false;
  const pdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber) => ({
          getTextContent: async () => ({ items: [{ str: `page-${pageNumber}` }, { str: "text" }] }),
          cleanup: () => {},
        }),
        destroy: async () => { destroyed = true; },
      }),
    }),
  };
  const file = fakeFile("sample.pdf", "not-a-real-pdf", "application/pdf");
  assert.equal(await parseSourceFile(file, { pdfjs }), "【第 1 頁】\npage-1 text\n\n【第 2 頁】\npage-2 text");
  assert.equal(destroyed, true);
});

test("PDF formatter keeps explicit page markers", () => {
  assert.equal(formatPdfPages(["a", "b"]), "【第 1 頁】\na\n\n【第 2 頁】\nb");
});

test("empty, oversized, and unsupported files are rejected", async () => {
  await assert.rejects(() => parseSourceFile({ name: "empty.txt", size: 0 }), /空的/);
  await assert.rejects(() => parseSourceFile({ name: "huge.txt", size: 11 * 1024 * 1024 }), /10 MiB/);
  await assert.rejects(() => parseSourceFile(fakeFile("photo.png", "x", "image/png")), /僅支援/);
});
