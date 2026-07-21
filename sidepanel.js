import { BrowserAudioEngine } from "./js/audio.js";
import { MESSAGE_TYPES, SOURCE_KEY, VOICES } from "./js/constants.js";
import { parseSourceFile } from "./js/file-parser.js";
import { checkRequiredModels, friendlyApiError, LiveSession, probeLiveModel } from "./js/gemini.js";
import { createActiveSource } from "./js/source.js";
import { loadSettings, loadSource, saveSettings, saveSource } from "./js/storage.js";
import { mergePartial } from "./js/transcript.js";

const OPTIONAL_PAGE_ORIGINS = ["http://*/*", "https://*/*"];

if (globalThis.pdfjsLib?.GlobalWorkerOptions) {
  globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
}

export class TranscriptCollector {
  constructor() {
    this.lines = [];
    this.userBuffer = "";
    this.modelBuffer = "";
  }

  onUser(text) {
    this.flushModel();
    this.userBuffer = mergePartial(this.userBuffer, text);
  }

  onModel(text) {
    this.flushUser();
    this.modelBuffer = mergePartial(this.modelBuffer, text);
  }

  onInterrupted() { this.flushModel(); }
  onTurnComplete() { this.flushUser(); this.flushModel(); }

  addCommitted(role, text) {
    this.flushUser();
    this.flushModel();
    this.lines.push({ role, text });
  }

  flushUser() {
    if (this.userBuffer.trim()) this.lines.push({ role: "user", text: this.userBuffer.trim() });
    this.userBuffer = "";
  }

  flushModel() {
    if (this.modelBuffer.trim()) this.lines.push({ role: "model", text: this.modelBuffer.trim() });
    this.modelBuffer = "";
  }

  preview() {
    const output = [...this.lines];
    if (this.userBuffer.trim()) output.push({ role: "user", text: this.userBuffer.trim() });
    if (this.modelBuffer.trim()) output.push({ role: "model", text: this.modelBuffer.trim() });
    return output;
  }
}

const elements = Object.fromEntries([
  "settingsButton", "sourceState", "sourceCard", "sourceKind", "sourceTitle", "sourcePreview",
  "sourceLink", "sourceWarning", "pickBlockButton", "uploadButton", "fileInput",
  "connectionPill", "connectionText", "voiceStage", "voiceStatus", "voiceHint", "levelBar",
  "callActions", "startButton", "muteButton", "endButton", "transcript", "transcriptEmpty",
  "toolFeed", "toolItems", "composer", "textInput", "sendButton", "toastRegion",
  "microphoneNotice", "microphonePermissionTitle", "microphonePermissionText", "openMicrophoneSettingsButton",
  "textOnlyMode",
  "settingsDialog", "panelSettingsForm", "settingsCloseButton", "settingsCancelButton",
  "settingsApiKey", "settingsToggleKeyButton", "settingsVoiceName", "settingsTestButton", "settingsTestStatus",
].map((id) => [id, document.getElementById(id)]));

let microphonePermissionStatus = null;

const state = {
  settings: await loadSettings(),
  source: await loadSource(),
  session: null,
  audio: null,
  started: false,
  ending: false,
  muted: false,
  microphoneActive: false,
  status: "ready",
  transcript: new TranscriptCollector(),
  tools: new Map(),
};

renderAll();

for (const voice of VOICES) {
  const option = document.createElement("option");
  option.value = voice;
  option.textContent = voice;
  elements.settingsVoiceName.appendChild(option);
}

elements.settingsButton.addEventListener("click", openSettings);
elements.settingsCloseButton.addEventListener("click", closeSettings);
elements.settingsCancelButton.addEventListener("click", closeSettings);
elements.settingsToggleKeyButton.addEventListener("click", toggleSettingsKey);
elements.settingsTestButton.addEventListener("click", testAndSaveSettings);
elements.panelSettingsForm.addEventListener("submit", submitSettings);
elements.settingsDialog.addEventListener("click", (event) => {
  if (event.target === elements.settingsDialog) closeSettings();
});
elements.pickBlockButton.addEventListener("click", startBlockPicker);
elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", handleFileUpload);
elements.startButton.addEventListener("click", startSession);
elements.muteButton.addEventListener("click", toggleMute);
elements.endButton.addEventListener("click", () => endSession());
elements.composer.addEventListener("submit", sendText);
elements.textInput.addEventListener("keydown", handleTextInputKeydown);
elements.openMicrophoneSettingsButton.addEventListener("click", openMicrophoneSettings);
elements.textOnlyMode.addEventListener("change", () => {
  renderMicrophonePermission(microphonePermissionStatus?.state || "unknown");
  renderControls();
});

void monitorMicrophonePermission();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_TYPES.SOURCE_UPDATED && !state.started) {
    state.source = message.source;
    renderSource();
    renderControls();
    toast("已加入新的網頁來源。 ");
  } else if (message?.type === MESSAGE_TYPES.BLOCK_PICK_CANCELLED) {
    toast("已取消選取。 ");
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[SOURCE_KEY]?.newValue && !state.started) {
    state.source = changes[SOURCE_KEY].newValue;
    renderSource();
    renderControls();
  }
});

window.addEventListener("beforeunload", () => {
  state.session?.stop(false);
  void state.audio?.stop();
});

async function startBlockPicker() {
  if (state.started) return;
  setBusy(elements.pickBlockButton, true, "等待選取…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !/^https?:\/\//i.test(tab.url)) {
      throw new Error("這個 Chrome 內建頁面不允許選取內容，請改用一般網頁。");
    }
    if (!tab?.url) {
      const granted = await chrome.permissions.request({ origins: OPTIONAL_PAGE_ORIGINS });
      if (!granted) throw new Error("需要網頁內容存取權限才能選取區塊。");
    }
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.START_BLOCK_PICKER });
    if (!response?.ok) throw new Error(response?.error || "無法啟動網頁選取。");
    toast("請回到網頁，點選要對談的內容區塊。 ");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(elements.pickBlockButton, false);
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || state.started) return;
  setBusy(elements.uploadButton, true, "解析中…");
  try {
    const text = await parseSourceFile(file);
    const source = createActiveSource({ kind: "file", title: file.name, mimeType: file.type, text });
    await saveSource(source);
    state.source = source;
    renderSource();
    renderControls();
    toast(source.truncated ? "檔案已載入，超出部分已截斷。" : "檔案已載入。 ");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(elements.uploadButton, false);
  }
}

async function startSession() {
  if (state.started || state.ending) return;
  state.settings = await loadSettings();
  if (!state.settings.apiKey) {
    toast("請先輸入 Gemini API key。", true);
    await openSettings();
    return;
  }
  if (!state.source) return toast("請先選取網頁內容或上傳檔案。", true);
  const useMicrophone = !elements.textOnlyMode.checked;
  if (useMicrophone && await monitorMicrophonePermission() === "denied") {
    toast("麥克風權限目前已封鎖，請先開啟權限再開始對談。", true);
    return;
  }

  state.started = true;
  state.microphoneActive = useMicrophone;
  state.muted = !useMicrophone;
  state.transcript = new TranscriptCollector();
  state.tools.clear();
  setStatus(useMicrophone ? "permission" : "connecting");
  renderAll();

  try {
    state.audio = new BrowserAudioEngine({
      onAudioChunk: (bytes) => state.session?.sendAudio(bytes),
      onLevel: (level) => { elements.levelBar.style.width = `${Math.round(level * 100)}%`; },
    });
    await state.audio.start({ captureMicrophone: useMicrophone });
    if (useMicrophone) renderMicrophonePermission("granted");
    state.session = new LiveSession({
      apiKey: state.settings.apiKey,
      voiceName: state.settings.voiceName,
      source: state.source,
    }, {
      onStatus: setStatus,
      onAudio: (bytes) => state.audio?.playPcm24k(bytes),
      onUserTranscript: (text) => { state.transcript.onUser(text); renderTranscript(); },
      onModelTranscript: (text) => { state.transcript.onModel(text); renderTranscript(); },
      onInterrupted: () => { state.audio?.flushPlayback(); state.transcript.onInterrupted(); renderTranscript(); },
      onTurnComplete: () => { state.transcript.onTurnComplete(); renderTranscript(); },
      onGrounding: handleGroundingEvent,
      onError: (error) => {
        toast(friendlyApiError(error), true);
        void endSession(false);
      },
    });
    state.session.start();
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      renderMicrophonePermission("denied");
    }
    toast(`無法開始對談：${friendlyApiError(error)}`, true);
    await endSession(false);
  }
}

async function openSettings() {
  state.settings = await loadSettings();
  elements.settingsApiKey.value = state.settings.apiKey;
  elements.settingsVoiceName.value = state.settings.voiceName;
  elements.settingsApiKey.type = "password";
  elements.settingsToggleKeyButton.textContent = "顯示";
  showSettingsTestStatus("");
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
  elements.settingsApiKey.focus();
}

function closeSettings() {
  elements.settingsDialog.close();
  elements.settingsApiKey.type = "password";
  elements.settingsToggleKeyButton.textContent = "顯示";
}

function toggleSettingsKey() {
  const showing = elements.settingsApiKey.type === "text";
  elements.settingsApiKey.type = showing ? "password" : "text";
  elements.settingsToggleKeyButton.textContent = showing ? "顯示" : "隱藏";
}

async function testAndSaveSettings() {
  const next = readSettingsForm();
  if (!next) return;
  setBusy(elements.settingsTestButton, true, "測試中…");
  showSettingsTestStatus("正在建立實際 Live 工作階段…");
  try {
    await checkRequiredModels(next.apiKey);
    await probeLiveModel(next.apiKey, { voiceName: next.voiceName });
    await saveSettings(next);
    state.settings = next;
    showSettingsTestStatus("Live 連線成功，設定已儲存。", false, true);
  } catch (error) {
    showSettingsTestStatus(friendlyApiError(error), true);
  } finally {
    setBusy(elements.settingsTestButton, false);
  }
}

async function submitSettings(event) {
  event.preventDefault();
  const next = readSettingsForm();
  if (!next) return;
  await saveSettings(next);
  state.settings = next;
  closeSettings();
  toast("設定已儲存。 ");
}

function readSettingsForm() {
  const apiKey = elements.settingsApiKey.value.trim();
  if (!apiKey) {
    showSettingsTestStatus("請先輸入 API key。", true);
    elements.settingsApiKey.focus();
    return null;
  }
  return { apiKey, voiceName: elements.settingsVoiceName.value };
}

function showSettingsTestStatus(message, isError = false, isSuccess = false) {
  elements.settingsTestStatus.textContent = message;
  elements.settingsTestStatus.className = `test-status ${isError ? "is-error" : isSuccess ? "is-success" : ""}`;
}

async function endSession(showNotice = true) {
  if ((!state.started && !state.audio) || state.ending) return;
  state.ending = true;
  state.session?.stop();
  state.session = null;
  await state.audio?.stop();
  state.audio = null;
  state.started = false;
  state.muted = false;
  state.microphoneActive = false;
  state.ending = false;
  state.transcript.onTurnComplete();
  setStatus("stopped");
  renderAll();
  if (showNotice) toast("對談已結束，逐字稿不會被保存。 ");
}

function toggleMute() {
  if (!state.started || !state.audio || !state.microphoneActive) return;
  state.muted = !state.muted;
  state.audio.setMuted(state.muted);
  if (state.muted) state.session?.endAudioStream();
  renderControls();
  renderStatus();
  toast(state.muted ? "麥克風已靜音。" : "麥克風已開啟。 ");
}

function sendText(event) {
  event.preventDefault();
  const text = elements.textInput.value.trim();
  if (!text) return;
  if (!state.session?.sendText(text)) return toast("Live 尚未連線完成，請稍候。", true);
  state.transcript.addCommitted("user", text);
  elements.textInput.value = "";
  renderTranscript();
}

function handleTextInputKeydown(event) {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (event.ctrlKey) {
    elements.textInput.setRangeText(
      "\n",
      elements.textInput.selectionStart,
      elements.textInput.selectionEnd,
      "end",
    );
    return;
  }
  elements.composer.requestSubmit();
}

async function monitorMicrophonePermission() {
  if (!navigator.permissions?.query) {
    renderMicrophonePermission("unknown");
    return "unknown";
  }
  try {
    if (!microphonePermissionStatus) {
      microphonePermissionStatus = await navigator.permissions.query({ name: "microphone" });
      microphonePermissionStatus.addEventListener("change", () => {
        renderMicrophonePermission(microphonePermissionStatus.state);
      });
    }
    renderMicrophonePermission(microphonePermissionStatus.state);
    return microphonePermissionStatus.state;
  } catch {
    renderMicrophonePermission("unknown");
    return "unknown";
  }
}

function renderMicrophonePermission(permissionState) {
  if (elements.textOnlyMode.checked) {
    elements.microphonePermissionTitle.textContent = "目前使用文字模式";
    elements.microphonePermissionText.textContent = "不會開啟麥克風；模型語音回覆仍會正常播放。";
    elements.microphoneNotice.className = "microphone-notice is-text-only";
    return;
  }
  const copy = {
    granted: ["麥克風權限已開啟", "開始對談後即可直接說話，也可以隨時靜音。"],
    denied: ["麥克風權限已封鎖", "請先到 Chrome 麥克風設定允許 PageAsk，才能開始語音對談。"],
    prompt: ["開始前請允許麥克風", "首次開始對談時，請在 Chrome 權限提示中選擇「允許」。"],
    unknown: ["開始前請確認麥克風", "Chrome 需要麥克風權限才能進行 Live 語音對談。"],
  };
  const [title, detail] = copy[permissionState] || copy.unknown;
  elements.microphonePermissionTitle.textContent = title;
  elements.microphonePermissionText.textContent = detail;
  elements.microphoneNotice.className = `microphone-notice ${permissionState === "denied" ? "is-denied" : permissionState === "granted" ? "is-granted" : ""}`;
}

async function openMicrophoneSettings() {
  try {
    await chrome.tabs.create({ url: "chrome://settings/content/microphone" });
  } catch {
    toast("請在 Chrome 設定 → 隱私權和安全性 → 網站設定 → 麥克風中允許 PageAsk。", true);
  }
}

function handleGroundingEvent(event) {
  state.tools.set(event.id, event);
  if (state.tools.size > 5) state.tools.delete(state.tools.keys().next().value);
  renderTools();
}

function renderAll() {
  renderSource();
  renderControls();
  renderTranscript();
  renderTools();
  renderStatus();
}

function renderSource() {
  const source = state.source;
  elements.sourceCard.classList.toggle("is-empty", !source);
  if (!source) {
    elements.sourceState.textContent = "尚未加入";
    elements.sourceKind.textContent = "等待資料";
    elements.sourceTitle.textContent = "選一段真正想讀懂的內容";
    elements.sourcePreview.textContent = "從目前網頁挑選區塊、反白文字按右鍵，或上傳 PDF 與文字檔。";
    elements.sourceLink.classList.add("is-hidden");
    elements.sourceWarning.classList.add("is-hidden");
    return;
  }
  const kindLabels = { "web-selection": "網頁反白", "web-block": "網頁區塊", file: "本機檔案" };
  elements.sourceState.textContent = `${source.retainedChars.toLocaleString()} 字`;
  elements.sourceKind.textContent = kindLabels[source.kind] || "參考來源";
  elements.sourceTitle.textContent = source.title;
  elements.sourcePreview.textContent = excerpt(source.text, 220);
  if (source.url) {
    elements.sourceLink.href = source.url;
    elements.sourceLink.classList.remove("is-hidden");
  } else {
    elements.sourceLink.removeAttribute("href");
    elements.sourceLink.classList.add("is-hidden");
  }
  if (source.truncated) {
    elements.sourceWarning.textContent = `原始內容共 ${source.originalChars.toLocaleString()} 字，已保留前 ${source.retainedChars.toLocaleString()} 字。`;
    elements.sourceWarning.classList.remove("is-hidden");
  } else {
    elements.sourceWarning.classList.add("is-hidden");
  }
}

function renderControls() {
  const sourceLocked = state.started || state.ending;
  const textOnly = elements.textOnlyMode.checked;
  elements.pickBlockButton.disabled = sourceLocked;
  elements.uploadButton.disabled = sourceLocked;
  elements.startButton.disabled = sourceLocked || !state.source;
  elements.textOnlyMode.disabled = sourceLocked;
  elements.muteButton.disabled = !state.started || state.ending || !state.microphoneActive;
  elements.muteButton.classList.toggle("is-hidden", textOnly);
  elements.callActions.classList.toggle("is-text-only", textOnly);
  elements.endButton.disabled = !state.started || state.ending;
  elements.muteButton.textContent = state.muted ? "開啟麥克風" : "麥克風靜音";
  const canType = state.started && state.status !== "connecting" && state.status !== "permission" && state.status !== "reconnecting";
  elements.textInput.disabled = !canType;
  elements.sendButton.disabled = !canType;
}

function renderStatus() {
  const statusCopy = {
    ready: ["準備好了", state.source ? "可以開始針對目前來源對談" : "加入內容後即可開始語音或文字對談"],
    permission: ["等待麥克風授權", "請在 Chrome 提示中允許 PageAsk 使用麥克風"],
    connecting: ["正在連線", "正在建立 Gemini Live 工作階段"],
    reconnecting: ["正在重新連線", "保留目前工作階段，請稍候"],
    listening: !state.microphoneActive
      ? ["文字對談已連線", "輸入訊息後按 Enter 送出"]
      : [state.muted ? "麥克風已靜音" : "正在聽你說", state.muted ? "可用文字繼續提問" : "你可以自然說話，隨時插話"],
    speaking: ["頁師傅 正在回答", "開口即可打斷目前回應"],
    failed: ["連線失敗", "請檢查設定、網路與免費配額"],
    stopped: ["對談已結束", "可以保留來源再開始一場新對談"],
  };
  const [title, hint] = statusCopy[state.status] || statusCopy.ready;
  elements.voiceStatus.textContent = title;
  elements.voiceHint.textContent = hint;
  elements.connectionText.textContent = connectionLabel(state.status);
  elements.connectionPill.className = `connection-pill ${state.status === "listening" ? "is-live" : state.status === "speaking" ? "is-speaking" : state.status === "failed" ? "is-error" : ""}`;
  elements.voiceStage.className = `voice-stage ${state.status === "listening" ? "is-listening" : state.status === "speaking" ? "is-speaking" : ""}`;
}

function renderTranscript() {
  const lines = state.transcript.preview();
  elements.transcript.replaceChildren();
  if (!lines.length) {
    const empty = document.createElement("div");
    empty.className = "transcript-empty";
    const title = document.createElement("span");
    title.textContent = "逐字稿";
    const copy = document.createElement("p");
    copy.textContent = "開始後，你和 頁師傅 的即時字幕會留在這裡；關閉面板後不會保存。";
    empty.append(title, copy);
    elements.transcript.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `transcript-line ${line.role === "model" ? "is-model" : ""}`;
    const label = document.createElement("strong");
    label.textContent = line.role === "model" ? "頁師傅" : "你";
    const text = document.createElement("p");
    text.textContent = line.text;
    row.append(label, text);
    elements.transcript.appendChild(row);
  }
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function renderTools() {
  const events = [...state.tools.values()];
  elements.toolFeed.classList.toggle("is-hidden", events.length === 0);
  elements.toolItems.replaceChildren();
  for (const event of events) {
    const item = document.createElement("div");
    item.className = "tool-item";
    const title = document.createElement("strong");
    title.textContent = event.status === "loading" ? "正在查詢 Google Search…" : event.status === "complete" ? "查詢完成" : "查詢失敗";
    const query = document.createElement("span");
    query.textContent = event.query || event.error || "未提供查詢內容";
    item.append(title, query);
    if (event.result?.sources?.length) {
      const links = document.createElement("div");
      links.className = "tool-sources";
      for (const source of event.result.sources) {
        const anchor = document.createElement("a");
        anchor.href = source.url;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.textContent = excerpt(source.title, 28);
        links.appendChild(anchor);
      }
      item.appendChild(links);
    }
    elements.toolItems.appendChild(item);
  }
}

function setStatus(status) {
  state.status = status;
  renderStatus();
  renderControls();
}

function connectionLabel(status) {
  return ({
    ready: "準備中", permission: "等待授權", connecting: "連線中", reconnecting: "重連中",
    listening: "已連線", speaking: "回答中", failed: "錯誤", stopped: "已結束",
  })[status] || status;
}

function excerpt(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function setBusy(button, busy, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `toast ${isError ? "is-error" : ""}`;
  item.textContent = message;
  elements.toastRegion.appendChild(item);
  setTimeout(() => item.remove(), 4300);
}
