import { MAX_FILE_BYTES } from "./constants.js";

const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);

export async function parseSourceFile(file, options = {}) {
  if (!file) throw new Error("請選擇檔案。");
  if (file.size > MAX_FILE_BYTES) throw new Error("檔案超過 10 MiB 上限。");
  if (file.size === 0) throw new Error("檔案是空的。");

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extension === "pdf") return parsePdf(file, options.pdfjs || globalThis.pdfjsLib);
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error("僅支援 PDF、TXT、Markdown、CSV 與 JSON。");
  }

  const text = decodeText(await file.arrayBuffer());
  if (extension === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw new Error("JSON 檔案格式不正確。");
    }
  }
  return text;
}

// Taiwanese TXT/CSV exports are often Big5; invalid UTF-8 means it is not UTF-8.
function decodeText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("big5").decode(buffer);
  }
}

async function parsePdf(file, pdfjs) {
  if (!pdfjs?.getDocument) throw new Error("PDF 解析器尚未載入，請重新開啟 PageAsk。");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let document;
  let pages;
  try {
    document = await loadingTask.promise;
    pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinPdfTextItems(content.items));
      page.cleanup?.();
    }
  } catch (error) {
    throw new Error(`無法解析 PDF：${error?.message || "檔案可能已損壞或受密碼保護。"}`);
  } finally {
    await document?.destroy?.();
  }
  if (!pages.some((text) => text.trim())) {
    throw new Error("這份 PDF 沒有可選取的文字（可能是掃描檔），目前不支援 OCR。");
  }
  return formatPdfPages(pages);
}

const CJK_CHARACTER = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;

// pdf.js splits text into runs: break lines at hasEOL and avoid spaces between CJK characters.
export function joinPdfTextItems(items) {
  let text = "";
  let lineBreak = false;
  for (const item of items) {
    const str = item.str || "";
    if (str) {
      if (text) {
        if (lineBreak) text += "\n";
        else if (!(CJK_CHARACTER.test(text.at(-1)) && CJK_CHARACTER.test(str[0]))) text += " ";
      }
      text += str;
      lineBreak = false;
    }
    if (item.hasEOL) lineBreak = true;
  }
  return text;
}

export function formatPdfPages(pages) {
  return pages.map((text, index) => `【第 ${index + 1} 頁】\n${String(text).trim()}`).join("\n\n");
}
