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

  const text = new TextDecoder("utf-8", { fatal: false }).decode(await file.arrayBuffer());
  if (extension === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw new Error("JSON 檔案格式不正確。");
    }
  }
  return text;
}

async function parsePdf(file, pdfjs) {
  if (!pdfjs?.getDocument) throw new Error("PDF 解析器尚未載入，請重新開啟 PageAsk。");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let document;
  try {
    document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
      page.cleanup?.();
    }
    return formatPdfPages(pages);
  } catch (error) {
    throw new Error(`無法解析 PDF：${error?.message || "檔案可能已損壞或受密碼保護。"}`);
  } finally {
    await document?.destroy?.();
  }
}

export function formatPdfPages(pages) {
  return pages.map((text, index) => `【第 ${index + 1} 頁】\n${String(text).trim()}`).join("\n\n");
}
