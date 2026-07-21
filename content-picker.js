(() => {
  if (globalThis.__pageAskPicker?.active) return;

  const state = { active: true, current: null, previousOutline: "", previousOffset: "" };
  globalThis.__pageAskPicker = state;

  const banner = document.createElement("div");
  banner.dataset.pageAskUi = "true";
  banner.setAttribute("role", "status");
  banner.textContent = "選取要對談的內容區塊 · Esc 取消";
  Object.assign(banner.style, {
    position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
    zIndex: "2147483647", padding: "10px 16px", borderRadius: "999px",
    background: "#173f3a", color: "#fffaf0", font: "600 14px/1.3 sans-serif",
    boxShadow: "0 8px 30px rgba(17, 34, 31, .25)", pointerEvents: "none",
  });
  document.documentElement.appendChild(banner);

  function isUi(element) {
    return element?.closest?.("[data-page-ask-ui='true']");
  }

  function restore() {
    if (!state.current) return;
    state.current.style.outline = state.previousOutline;
    state.current.style.outlineOffset = state.previousOffset;
    state.current = null;
  }

  function highlight(element) {
    if (!element || element === state.current || isUi(element)) return;
    restore();
    state.current = element;
    state.previousOutline = element.style.outline;
    state.previousOffset = element.style.outlineOffset;
    element.style.outline = "3px solid #2c8175";
    element.style.outlineOffset = "3px";
  }

  function cleanup() {
    if (!state.active) return;
    state.active = false;
    restore();
    banner.remove();
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    delete globalThis.__pageAskPicker;
  }

  function cancel() {
    cleanup();
    chrome.runtime.sendMessage({ type: "BLOCK_PICK_CANCELLED" }).catch(() => {});
  }

  function onPointerOver(event) {
    highlight(event.target);
  }

  function onClick(event) {
    if (isUi(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.target;
    const text = (element.innerText || element.textContent || "").trim();
    if (!text) {
      banner.textContent = "這個區塊沒有可讀文字，請選擇其他區塊";
      return;
    }
    cleanup();
    chrome.runtime.sendMessage({
      type: "BLOCK_PICKED",
      title: document.title,
      url: location.href,
      text,
    }).catch(() => {});
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
})();
