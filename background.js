import { MESSAGE_TYPES, SOURCE_KEY } from "./js/constants.js";
import { createActiveSource } from "./js/source.js";
import {
  BROWSER_TOOL_DECLARATIONS,
  maxResults,
  safeHttpUrl,
} from "./js/browser-tools.js";

const MENU_ID = "pageask-selection";

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "用 PageAsk 詢問「%s」",
      contexts: ["selection"],
    });
  });
});

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Chrome versions without side panel support are handled by the manifest gate.
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText?.trim()) return;
  try {
    const source = createActiveSource({
      kind: "web-selection",
      title: tab?.title || "網頁反白文字",
      url: tab?.url,
      text: info.selectionText,
    });
    await storeAndAnnounce(source);
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.warn("PageAsk selection failed:", error.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!Object.values(MESSAGE_TYPES).includes(message?.type)) return;
  void (async () => {
    try {
      const result = await handleMessage(message, sender);
      sendResponse({ ok: true, ...result });
    } catch (error) {
      sendResponse({ ok: false, error: userFacingError(error) });
    }
  })();
  return true;
});

async function handleMessage(message, sender) {
  if (message?.type === MESSAGE_TYPES.START_BLOCK_PICKER) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("找不到目前作用中的網頁分頁。");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-picker.js"] });
    return { status: "picker-started" };
  }

  if (message?.type === MESSAGE_TYPES.BLOCK_PICKED) {
    const source = createActiveSource({
      kind: "web-block",
      title: message.title || sender.tab?.title || "網頁內容區塊",
      url: message.url || sender.tab?.url,
      text: message.text,
    });
    await storeAndAnnounce(source);
    return { source };
  }

  if (message?.type === MESSAGE_TYPES.BLOCK_PICK_CANCELLED) {
    await announce({ type: MESSAGE_TYPES.BLOCK_PICK_CANCELLED });
    return { status: "picker-cancelled" };
  }

  if (message?.type === MESSAGE_TYPES.OPEN_SIDE_PANEL) {
    const tab = await findTargetTab(message.tabId, sender);
    if (tab?.windowId == null) throw new Error("找不到要開啟 PageAsk 的視窗。");
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return { status: "side-panel-opened", tabId: tab.id };
  }

  if (message?.type === MESSAGE_TYPES.EXECUTE_BROWSER_TOOL) {
    return { result: await executeBrowserTool(message.name, message.args || {}) };
  }

  return { status: "ignored" };
}

async function findTargetTab(tabId, sender = {}) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
  if (Number.isInteger(sender.tab?.id)) return chrome.tabs.get(sender.tab.id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function executeBrowserTool(name, args) {
  if (!BROWSER_TOOL_DECLARATIONS.some((tool) => tool.name === name)) throw new Error("不支援的瀏覽器工具。");
  switch (name) {
    case "list_open_tabs": {
      const query = Number.isInteger(args.window_id) ? { windowId: args.window_id } : {};
      const tabs = await chrome.tabs.query(query);
      return { tabs: tabs.slice(0, 100).map((tab) => ({ id: tab.id, title: tab.title || "未命名分頁", url: tab.url || "", active: Boolean(tab.active), windowId: tab.windowId })) };
    }
    case "activate_tab": {
      const tab = await requireTab(args.tab_id);
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      return { tab_id: tab.id, title: tab.title || "未命名分頁", url: tab.url || "", activated: true };
    }
    case "search_history": {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("歷史紀錄搜尋需要 query。");
      const entries = await chrome.history.search({ text: query, maxResults: maxResults(args.max_results) });
      return { items: entries.map((entry) => ({ id: entry.id, title: entry.title || "未命名頁面", url: entry.url || "", lastVisitTime: entry.lastVisitTime || null, visitCount: entry.visitCount || 0 })) };
    }
    case "search_bookmarks": {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("書籤搜尋需要 query。");
      const entries = await chrome.bookmarks.search(query);
      return { items: entries.filter((entry) => entry.url).slice(0, maxResults(args.max_results)).map((entry) => ({ id: entry.id, title: entry.title || "未命名書籤", url: entry.url, parentId: entry.parentId })) };
    }
    case "list_reading_list": {
      if (!chrome.readingList?.query) throw new Error("目前 Chrome 版本不支援 Reading List 工具。");
      const query = String(args.query || "").trim().toLocaleLowerCase("zh-TW");
      const entries = await chrome.readingList.query({});
      return { items: entries.filter((entry) => !query || `${entry.title} ${entry.url}`.toLocaleLowerCase("zh-TW").includes(query)).slice(0, 50) };
    }
    case "add_bookmark": {
      const url = requireHttpUrl(args.url);
      const title = String(args.title || url).trim().slice(0, 240);
      const bookmark = await chrome.bookmarks.create({ title, url, ...(args.parent_id ? { parentId: String(args.parent_id) } : {}) });
      return { created: true, id: bookmark.id, title: bookmark.title, url: bookmark.url };
    }
    case "add_to_reading_list": {
      if (!chrome.readingList?.addEntry) throw new Error("目前 Chrome 版本不支援 Reading List 工具。");
      const url = requireHttpUrl(args.url);
      const title = String(args.title || url).trim().slice(0, 240);
      await chrome.readingList.addEntry({ title, url, hasBeenRead: false });
      return { added: true, title, url };
    }
    case "list_downloads": {
      const query = String(args.query || "").trim();
      const options = { limit: 50 };
      if (query) options.query = [query];
      const entries = await chrome.downloads.search(options);
      return { items: entries.map((entry) => ({ id: entry.id, filename: entry.filename || "", url: entry.url || "", state: entry.state, bytesReceived: entry.bytesReceived, totalBytes: entry.totalBytes, error: entry.error || null })) };
    }
    case "download_file": {
      const url = requireHttpUrl(args.url);
      const filename = String(args.filename || "").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 240);
      const id = await chrome.downloads.download({ url, ...(filename ? { filename, saveAs: false } : { saveAs: false }) });
      return { started: true, download_id: id, url, filename: filename || null };
    }
    case "navigate_tab": {
      const url = requireHttpUrl(args.url);
      const tab = await requireTab(args.tab_id);
      const updated = await chrome.tabs.update(tab.id, { url });
      return { navigated: true, tab_id: updated.id, url: updated.url || url };
    }
    case "close_tab": {
      const tab = await requireTab(args.tab_id);
      await chrome.tabs.remove(tab.id);
      return { closed: true, tab_id: tab.id };
    }
    default: throw new Error("不支援的瀏覽器工具。");
  }
}

async function requireTab(value) {
  const tabId = Number(value);
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("需要有效的 tab_id。");
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.id) throw new Error("找不到指定分頁，可能已經關閉。");
  return tab;
}

function requireHttpUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) throw new Error("只允許 http 或 https 網址。");
  return url;
}

async function storeAndAnnounce(source) {
  await chrome.storage.session.set({ [SOURCE_KEY]: source });
  await announce({ type: MESSAGE_TYPES.SOURCE_UPDATED, source });
}

async function announce(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // The side panel may not be open yet; storage remains the source of truth.
  }
}

function userFacingError(error) {
  const message = error?.message || "操作失敗。";
  if (/chrome:\/\/|edge:\/\/|about:|extensions gallery|Chrome Web Store/i.test(message)) {
    return "這個 Chrome 內建頁面不允許選取內容，請改用一般網頁。";
  }
  if (/Cannot access|Missing host permission|Cannot access contents/i.test(message)) {
    return "PageAsk 尚未取得這個網頁的內容存取權限，請重新按下選取並允許存取。";
  }
  return message;
}
