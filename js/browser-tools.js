export const BROWSER_TOOL_PERMISSIONS = Object.freeze([
  "tabs", "history", "bookmarks", "readingList", "downloads",
]);

export const BROWSER_TOOL_ORIGINS = Object.freeze(["http://*/*", "https://*/*"]);
export const PAGE_ACCESS_PERMISSIONS = Object.freeze(["tabs"]);

export const BROWSER_TOOL_SYSTEM_INSTRUCTION = `
## 瀏覽器工具
- 只有在使用者明確要求你查詢或操作瀏覽器時，才使用瀏覽器工具。
- 目前視窗、歷史紀錄、書籤、Reading List 與下載資料都屬於使用者資料，回答時只使用工具回傳的內容。
- activate_tab、add_bookmark、add_to_reading_list、download_file、navigate_tab、close_tab 會改變瀏覽器狀態；呼叫前必須讓 PageAsk 顯示確認，未確認前不得假設動作已完成。
- 工具失敗、權限不足或使用者拒絕時，請明確說明，不要聲稱已完成。
`;

export const BROWSER_TOOL_DECLARATIONS = Object.freeze([
  {
    name: "list_open_tabs",
    description: "列出目前瀏覽器中開啟的分頁。只能讀取，不會改變分頁。",
    parameters: {
      type: "OBJECT",
      properties: { window_id: { type: "NUMBER", description: "選填；只列出指定視窗的分頁。" } },
    },
  },
  {
    name: "activate_tab",
    description: "切換到指定分頁並聚焦該視窗。這會改變瀏覽器目前狀態，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: { tab_id: { type: "NUMBER", description: "要切換的分頁 ID。" } },
      required: ["tab_id"],
    },
  },
  {
    name: "search_history",
    description: "搜尋瀏覽器歷史紀錄。",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "搜尋文字。" },
        max_results: { type: "NUMBER", description: "最多回傳幾筆，預設 10，最多 50。" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_bookmarks",
    description: "搜尋瀏覽器書籤。",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "搜尋文字。" },
        max_results: { type: "NUMBER", description: "最多回傳幾筆，預設 10，最多 50。" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_reading_list",
    description: "列出稍後閱讀清單，可用文字過濾。Chrome 不支援時會回傳明確錯誤。",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "選填；比對標題或網址。" } },
    },
  },
  {
    name: "add_bookmark",
    description: "將網址加入瀏覽器書籤。這會改變資料，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: "書籤標題。" },
        url: { type: "STRING", description: "只能使用 http 或 https 網址。" },
        parent_id: { type: "STRING", description: "選填；Chrome 書籤資料夾 ID。" },
      },
      required: ["title", "url"],
    },
  },
  {
    name: "add_to_reading_list",
    description: "將網址加入稍後閱讀清單。這會改變資料，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: "項目標題。" },
        url: { type: "STRING", description: "只能使用 http 或 https 網址。" },
      },
      required: ["title", "url"],
    },
  },
  {
    name: "list_downloads",
    description: "查詢下載項目與目前下載狀態。",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "選填；搜尋檔名或網址。" } },
    },
  },
  {
    name: "download_file",
    description: "下載指定網址的檔案。這會改變瀏覽器狀態，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "只能使用 http 或 https 網址。" },
        filename: { type: "STRING", description: "選填；希望使用的檔名。" },
      },
      required: ["url"],
    },
  },
  {
    name: "navigate_tab",
    description: "將指定分頁導向新的網址。這會改變瀏覽器狀態，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: {
        tab_id: { type: "NUMBER", description: "要導覽的分頁 ID。" },
        url: { type: "STRING", description: "只能使用 http 或 https 網址。" },
      },
      required: ["tab_id", "url"],
    },
  },
  {
    name: "close_tab",
    description: "關閉指定分頁。這會改變瀏覽器狀態，必須先取得使用者確認。",
    parameters: {
      type: "OBJECT",
      properties: { tab_id: { type: "NUMBER", description: "要關閉的分頁 ID。" } },
      required: ["tab_id"],
    },
  },
]);

export const MUTATING_BROWSER_TOOLS = Object.freeze(new Set([
  "activate_tab", "add_bookmark", "add_to_reading_list", "download_file", "navigate_tab", "close_tab",
]));

export function isMutatingBrowserTool(name) {
  return MUTATING_BROWSER_TOOLS.has(name);
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function maxResults(value, fallback = 10) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(50, Math.floor(number))) : fallback;
}
