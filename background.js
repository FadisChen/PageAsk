import { MESSAGE_TYPES, SOURCE_KEY } from "./js/constants.js";
import { createActiveSource } from "./js/source.js";

const MENU_ID = "pageask-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "用 PageAsk 詢問「%s」",
      contexts: ["selection"],
    });
  });
});

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
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: userFacingError(error) }));
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

  return { status: "ignored" };
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
