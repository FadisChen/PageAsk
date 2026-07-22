import { BrowserAudioEngine } from "./js/audio.js";
import {
  DEFAULT_COMPANION_SYSTEM_PROMPT,
  describeLiveThinking,
  LIVE_MODEL_OPTIONS,
  LIVE_THINKING_OPTIONS,
  MESSAGE_TYPES,
  SOURCE_KEY,
  VOICES,
} from "./js/constants.js";
import { parseSourceFile } from "./js/file-parser.js";
import {
  buildCompanionSystemInstruction,
  buildSystemInstruction,
  checkRequiredModels,
  friendlyApiError,
  LiveSession,
  probeLiveModel,
} from "./js/gemini.js";
import { processCompanionMemory } from "./js/memory.js";
import { createActiveSource } from "./js/source.js";
import {
  createMemory,
  clearSource,
  estimateTokens,
  loadMemories,
  loadSettings,
  loadSource,
  saveMemories,
  saveSettings,
  saveSource,
  updateMemory,
} from "./js/storage.js";
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

  snapshot() {
    this.onTurnComplete();
    return this.lines.map((line) => ({ ...line }));
  }
}

const elements = Object.fromEntries([
  "settingsButton", "readingModeButton", "companionModeButton",
  "sourceSection", "sourceState", "sourceCard", "sourceKind", "sourceTitle", "sourcePreview",
  "sourceLink", "sourceWarning", "pickBlockButton", "uploadButton", "fileInput",
  "conversationHeading", "connectionPill", "connectionText", "voiceStage", "voiceStatus", "voiceHint", "levelBar",
  "callActions", "startButton", "muteButton", "endButton", "transcript", "transcriptEmpty",
  "toolFeed", "toolFeedState", "toolItems", "composer", "textInput", "sendButton", "toastRegion",
  "microphoneNotice", "microphonePermissionTitle", "microphonePermissionText", "openMicrophoneSettingsButton",
  "textOnlyMode",
  "settingsDialog", "panelSettingsForm", "settingsCloseButton", "settingsCancelButton",
  "settingsApiKey", "settingsToggleKeyButton", "settingsLiveModel", "settingsThinkingLevel", "settingsThinkingValue", "settingsThinkingHint",
  "settingsVoiceName", "settingsTestButton", "settingsTestStatus",
  "settingsCompanionPrompt", "settingsResetPromptButton", "settingsMemoryEnabled", "settingsMemoryBudget",
  "memoryUsage", "newMemoryButton", "newMemoryEditor", "newMemoryContent", "newMemoryLocked",
  "saveNewMemoryButton", "cancelNewMemoryButton", "memoryList",
].map((id) => [id, document.getElementById(id)]));

let microphonePermissionStatus = null;
let transcriptRenderPending = false;

const state = {
  settings: await loadSettings(),
  source: await loadSource(),
  memories: await loadMemories(),
  session: null,
  audio: null,
  started: false,
  ending: false,
  muted: false,
  microphoneActive: false,
  activeMode: null,
  activeMemoryEnabled: false,
  activeMemoryConfig: null,
  memoryProcessing: false,
  status: "ready",
  transcript: new TranscriptCollector(),
  tools: new Map(),
};

renderAll();

for (const model of LIVE_MODEL_OPTIONS) {
  const option = document.createElement("option");
  option.value = model.id;
  option.textContent = model.label;
  elements.settingsLiveModel.appendChild(option);
}

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
elements.settingsLiveModel.addEventListener("change", renderSettingsThinking);
elements.settingsThinkingLevel.addEventListener("input", renderSettingsThinking);
elements.settingsTestButton.addEventListener("click", testAndSaveSettings);
elements.settingsResetPromptButton.addEventListener("click", () => {
  elements.settingsCompanionPrompt.value = DEFAULT_COMPANION_SYSTEM_PROMPT;
});
elements.settingsMemoryBudget.addEventListener("input", renderMemoryList);
elements.settingsMemoryEnabled.addEventListener("change", renderMemoryList);
elements.newMemoryButton.addEventListener("click", openNewMemoryEditor);
elements.cancelNewMemoryButton.addEventListener("click", closeNewMemoryEditor);
elements.saveNewMemoryButton.addEventListener("click", saveNewMemory);
elements.memoryList.addEventListener("click", handleMemoryListClick);
elements.panelSettingsForm.addEventListener("submit", submitSettings);
elements.settingsDialog.addEventListener("click", (event) => {
  if (event.target === elements.settingsDialog) closeSettings();
});
elements.readingModeButton.addEventListener("click", () => setConversationMode("reading"));
elements.companionModeButton.addEventListener("click", () => setConversationMode("companion"));
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
  if (areaName === "session" && SOURCE_KEY in changes && !state.started) {
    state.source = changes[SOURCE_KEY].newValue || null;
    renderSource();
    renderControls();
  }
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "hidden" &&
    !state.started &&
    !state.ending &&
    !state.memoryProcessing
  ) {
    void clearTemporaryContent();
  }
});

window.addEventListener("beforeunload", () => {
  state.session?.stop(false);
  void state.audio?.stop();
  void clearTemporaryContent();
});

async function clearTemporaryContent() {
  state.transcript = new TranscriptCollector();
  state.source = null;
  await clearSource();
}

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
  if (state.started || state.ending || state.memoryProcessing) return;
  state.settings = await loadSettings();
  if (!state.settings.apiKey) {
    toast("請先輸入 Gemini API key。", true);
    await openSettings();
    return;
  }

  const mode = state.settings.conversationMode;
  if (mode === "reading" && !state.source) {
    return toast("請先選取網頁內容或上傳檔案。", true);
  }
  const useMicrophone = !elements.textOnlyMode.checked;
  if (useMicrophone && await monitorMicrophonePermission() === "denied") {
    toast("麥克風權限目前已封鎖，請先開啟權限再開始對談。", true);
    return;
  }

  state.started = true;
  state.activeMode = mode;
  state.activeMemoryEnabled = mode === "companion" && state.settings.companionMemoryEnabled;
  state.activeMemoryConfig = state.activeMemoryEnabled ? {
    apiKey: state.settings.apiKey,
    budgetTokens: state.settings.companionMemoryBudgetTokens,
  } : null;
  state.microphoneActive = useMicrophone;
  state.muted = !useMicrophone;
  state.transcript = new TranscriptCollector();
  state.tools.clear();
  elements.toolFeed.open = false;
  setStatus(useMicrophone ? "permission" : "connecting");
  renderAll();

  const systemInstruction = mode === "companion"
    ? buildCompanionSystemInstruction(
      state.settings.companionSystemPrompt,
      state.activeMemoryEnabled ? state.memories.map((memory) => memory.content) : [],
    )
    : buildSystemInstruction(state.source);

  try {
    state.audio = new BrowserAudioEngine({
      onAudioChunk: (bytes) => state.session?.sendAudio(bytes),
      onLevel: (level) => { elements.levelBar.style.width = `${Math.round(level * 100)}%`; },
    });
    await state.audio.start({ captureMicrophone: useMicrophone });
    if (useMicrophone) renderMicrophonePermission("granted");
    state.session = new LiveSession({
      apiKey: state.settings.apiKey,
      liveModel: state.settings.liveModel,
      liveThinkingLevel: state.settings.liveThinkingLevel,
      voiceName: state.settings.voiceName,
      systemInstruction,
      autoContinueIncompleteText: !useMicrophone,
    }, {
      onStatus: setStatus,
      onAudio: (bytes) => state.audio?.playPcm24k(bytes),
      onUserTranscript: (text) => { state.transcript.onUser(text); scheduleTranscriptRender(); },
      onModelTranscript: (text) => { state.transcript.onModel(text); scheduleTranscriptRender(); },
      onInterrupted: () => { state.audio?.flushPlayback(); state.transcript.onInterrupted(); scheduleTranscriptRender(); },
      onTurnComplete: () => { state.transcript.onTurnComplete(); scheduleTranscriptRender(); },
      onGrounding: handleGroundingEvent,
      onError: (error) => {
        toast(friendlyApiError(error), true);
        void endSession(false, false);
      },
    });
    state.session.start();
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      renderMicrophonePermission("denied");
    }
    toast(`無法開始對談：${friendlyApiError(error)}`, true);
    await endSession(false, false);
  }
}

async function openSettings() {
  state.settings = await loadSettings();
  state.memories = await loadMemories();
  elements.settingsApiKey.value = state.settings.apiKey;
  elements.settingsLiveModel.value = state.settings.liveModel;
  elements.settingsThinkingLevel.value = Math.max(
    0,
    LIVE_THINKING_OPTIONS.findIndex((option) => option.id === state.settings.liveThinkingLevel),
  );
  elements.settingsVoiceName.value = state.settings.voiceName;
  elements.settingsCompanionPrompt.value = state.settings.companionSystemPrompt;
  elements.settingsMemoryEnabled.checked = state.settings.companionMemoryEnabled;
  elements.settingsMemoryBudget.value = state.settings.companionMemoryBudgetTokens;
  elements.settingsApiKey.type = "password";
  elements.settingsToggleKeyButton.textContent = "顯示";
  closeNewMemoryEditor();
  renderSettingsThinking();
  renderMemoryList();
  showSettingsTestStatus("");
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
  elements.settingsApiKey.focus();
}

function closeSettings() {
  elements.settingsDialog.close();
  elements.settingsApiKey.type = "password";
  elements.settingsToggleKeyButton.textContent = "顯示";
}

async function setConversationMode(mode) {
  if (state.started || state.ending || state.memoryProcessing || state.settings.conversationMode === mode) return;
  state.settings = await saveSettings({ ...state.settings, conversationMode: mode });
  await clearTemporaryContent();
  setStatus("ready");
  renderAll();
}

function openNewMemoryEditor() {
  elements.newMemoryContent.value = "";
  elements.newMemoryLocked.checked = true;
  elements.newMemoryEditor.classList.remove("is-hidden");
  elements.newMemoryContent.focus();
}

function closeNewMemoryEditor() {
  elements.newMemoryEditor.classList.add("is-hidden");
  elements.newMemoryContent.value = "";
  elements.newMemoryLocked.checked = true;
}

async function saveNewMemory() {
  const memory = createMemory(elements.newMemoryContent.value, elements.newMemoryLocked.checked);
  if (!memory) return toast("記憶內容不可空白。", true);
  state.memories = await saveMemories([...state.memories, memory]);
  closeNewMemoryEditor();
  renderMemoryList();
  toast("已新增一條記憶。 ");
}

async function handleMemoryListClick(event) {
  const button = event.target.closest("button[data-memory-action]");
  if (!button) return;
  const item = button.closest("[data-memory-id]");
  const memory = state.memories.find((entry) => entry.id === item?.dataset.memoryId);
  if (!memory) return;

  if (button.dataset.memoryAction === "delete") {
    if (!confirm("確定要刪除這條長期記憶嗎？")) return;
    state.memories = await saveMemories(state.memories.filter((entry) => entry.id !== memory.id));
    renderMemoryList();
    toast("記憶已刪除。 ");
    return;
  }

  const updated = updateMemory(
    memory,
    item.querySelector("textarea").value,
    item.querySelector('input[type="checkbox"]').checked,
  );
  if (!updated) return toast("記憶內容不可空白。", true);
  state.memories = await saveMemories(state.memories.map((entry) => entry.id === memory.id ? updated : entry));
  renderMemoryList();
  toast("記憶已更新。 ");
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
    await checkRequiredModels(next.apiKey, { liveModel: next.liveModel });
    await probeLiveModel(next.apiKey, {
      liveModel: next.liveModel,
      liveThinkingLevel: next.liveThinkingLevel,
      voiceName: next.voiceName,
    });
    state.settings = await saveSettings(next);
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
  state.settings = await saveSettings(next);
  closeSettings();
  renderAll();
  toast("設定已儲存。 ");
}

function readSettingsForm() {
  const apiKey = elements.settingsApiKey.value.trim();
  if (!apiKey) {
    showSettingsTestStatus("請先輸入 API key。", true);
    elements.settingsApiKey.focus();
    return null;
  }
  return {
    ...state.settings,
    apiKey,
    liveModel: elements.settingsLiveModel.value,
    liveThinkingLevel: selectedThinkingOption(elements.settingsThinkingLevel).id,
    voiceName: elements.settingsVoiceName.value,
    companionSystemPrompt: elements.settingsCompanionPrompt.value,
    companionMemoryEnabled: elements.settingsMemoryEnabled.checked,
    companionMemoryBudgetTokens: Number(elements.settingsMemoryBudget.value),
  };
}

function selectedThinkingOption(slider) {
  return LIVE_THINKING_OPTIONS[Number(slider.value)] || LIVE_THINKING_OPTIONS[0];
}

function renderSettingsThinking() {
  const option = selectedThinkingOption(elements.settingsThinkingLevel);
  elements.settingsThinkingValue.value = option.label;
  elements.settingsThinkingHint.textContent = describeLiveThinking(elements.settingsLiveModel.value, option.id);
}

function showSettingsTestStatus(message, isError = false, isSuccess = false) {
  elements.settingsTestStatus.textContent = message;
  elements.settingsTestStatus.className = `test-status ${isError ? "is-error" : isSuccess ? "is-success" : ""}`;
}

async function endSession(showNotice = true, processMemory = true) {
  if ((!state.started && !state.audio) || state.ending) return;
  state.ending = true;
  const completedMode = state.activeMode;
  const shouldProcessMemory = processMemory && completedMode === "companion" && state.activeMemoryEnabled;
  const transcript = state.transcript.snapshot();

  state.session?.stop();
  state.session = null;
  await state.audio?.stop();
  state.audio = null;
  state.started = false;
  state.muted = false;
  state.microphoneActive = false;

  let notice = "對談已結束，逐字稿不會被保存。 ";
  let noticeIsError = false;
  if (shouldProcessMemory && transcript.length) {
    state.memoryProcessing = true;
    setStatus("processing-memory");
    renderAll();
    try {
      const result = await processCompanionMemory({
        apiKey: state.activeMemoryConfig.apiKey,
        transcript,
        memories: state.memories,
        budgetTokens: state.activeMemoryConfig.budgetTokens,
      });
      state.memories = await saveMemories(result.memories);
      notice = result.additions
        ? `已整理完成，新增 ${result.additions} 條長期記憶。`
        : "這次對話沒有需要新增的長期記憶。";
      if (result.warning) {
        notice = `${notice} ${result.warning}`;
        noticeIsError = true;
      }
    } catch (error) {
      notice = `記憶更新失敗：${friendlyApiError(error)}`;
      noticeIsError = true;
    } finally {
      state.transcript = new TranscriptCollector();
      state.memoryProcessing = false;
    }
  }

  state.ending = false;
  state.activeMode = null;
  state.activeMemoryEnabled = false;
  state.activeMemoryConfig = null;
  setStatus("stopped");
  renderAll();
  if (showNotice) toast(notice, noticeIsError);
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

function renderMemoryList() {
  const budget = Number(elements.settingsMemoryBudget.value) || state.settings.companionMemoryBudgetTokens;
  const used = state.memories.reduce((sum, memory) => sum + estimateTokens(memory.content), 0);
  const paused = !elements.settingsMemoryEnabled.checked;
  elements.memoryUsage.textContent = `${state.memories.length} 條 · 約 ${used.toLocaleString()} / ${budget.toLocaleString()} tokens${paused ? " · 已暫停" : ""}`;
  elements.memoryUsage.classList.toggle("is-over-budget", used > budget);
  elements.memoryList.replaceChildren();

  if (!state.memories.length) {
    const empty = document.createElement("p");
    empty.className = "memory-empty";
    empty.textContent = "還沒有留下記憶。你可以手動新增，或在陪伴對談結束後交給小書僮整理。";
    elements.memoryList.appendChild(empty);
    return;
  }

  const memories = [...state.memories].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const memory of memories) {
    const item = document.createElement("article");
    item.className = "memory-item";
    item.dataset.memoryId = memory.id;

    const textarea = document.createElement("textarea");
    textarea.maxLength = 4000;
    textarea.rows = 3;
    textarea.value = memory.content;
    textarea.setAttribute("aria-label", "記憶內容");

    const meta = document.createElement("div");
    meta.className = "memory-meta";
    const lock = document.createElement("label");
    lock.className = "memory-lock-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = memory.locked;
    lock.append(checkbox, document.createTextNode(" 鎖定"));

    const updated = document.createElement("span");
    updated.textContent = `${new Date(memory.updatedAt).toLocaleDateString("zh-TW")} · 約 ${estimateTokens(memory.content)} tokens`;

    const actions = document.createElement("div");
    actions.className = "memory-item-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.memoryAction = "save";
    save.textContent = "儲存";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.memoryAction = "delete";
    remove.textContent = "刪除";
    actions.append(save, remove);
    meta.append(lock, updated, actions);
    item.append(textarea, meta);
    elements.memoryList.appendChild(item);
  }
}

function renderMode() {
  const mode = state.activeMode || state.settings.conversationMode;
  const locked = state.started || state.ending || state.memoryProcessing;
  const companion = mode === "companion";
  elements.readingModeButton.classList.toggle("is-active", !companion);
  elements.companionModeButton.classList.toggle("is-active", companion);
  elements.readingModeButton.setAttribute("aria-pressed", String(!companion));
  elements.companionModeButton.setAttribute("aria-pressed", String(companion));
  elements.readingModeButton.disabled = locked;
  elements.companionModeButton.disabled = locked;
  elements.sourceSection.classList.toggle("is-hidden", companion);
  elements.conversationHeading.textContent = companion ? "陪伴對談" : "即時對談";
  elements.startButton.textContent = companion ? "開始陪伴" : "開始對談";
}

function renderAll() {
  renderMode();
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
  const controlsLocked = state.started || state.ending || state.memoryProcessing;
  const requiresSource = state.settings.conversationMode === "reading";
  const textOnly = elements.textOnlyMode.checked;
  elements.pickBlockButton.disabled = controlsLocked;
  elements.uploadButton.disabled = controlsLocked;
  elements.startButton.disabled = controlsLocked || (requiresSource && !state.source);
  elements.textOnlyMode.disabled = controlsLocked;
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
  const companion = (state.activeMode || state.settings.conversationMode) === "companion";
  const readyHint = companion
    ? (state.settings.companionMemoryEnabled ? "不用準備來源，小書僮會帶著你們的長期記憶來陪你" : "不用準備來源，隨時可以直接聊聊")
    : (state.source ? "可以開始針對目前來源對談" : "加入內容後即可開始語音或文字對談");
  const statusCopy = {
    ready: ["準備好了", readyHint],
    permission: ["等待麥克風授權", "請在 Chrome 提示中允許 PageAsk 使用麥克風"],
    connecting: ["正在連線", "正在建立 Gemini Live 工作階段"],
    reconnecting: ["正在重新連線", "保留目前工作階段，請稍候"],
    listening: !state.microphoneActive
      ? ["文字對談已連線", "輸入訊息後按 Enter 送出"]
      : [state.muted ? "麥克風已靜音" : "正在聽你說", state.muted ? "可用文字繼續提問" : "你可以自然說話，隨時插話"],
    speaking: ["小書僮 正在回答", "開口即可打斷目前回應"],
    failed: ["連線失敗", "請檢查設定、網路與免費配額"],
    "processing-memory": ["正在整理記憶", "從這次對話挑出值得長期記住的事"],
    stopped: ["對談已結束", companion ? "隨時可以再開始一場陪伴對談" : "可以保留來源再開始一場新對談"],
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
    const companion = (state.activeMode || state.settings.conversationMode) === "companion";
    copy.textContent = companion && state.settings.companionMemoryEnabled
      ? "逐字稿只用於會後整理長期記憶，整理完成即捨棄；關閉面板不會保存。"
      : "開始後，你和 小書僮 的即時字幕會留在這裡；關閉面板後不會保存。";
    empty.append(title, copy);
    elements.transcript.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `transcript-line ${line.role === "model" ? "is-model" : ""}`;
    const label = document.createElement("strong");
    label.textContent = line.role === "model" ? "小書僮" : "你";
    const text = document.createElement("p");
    text.textContent = line.text;
    row.append(label, text);
    elements.transcript.appendChild(row);
  }
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function scheduleTranscriptRender() {
  if (transcriptRenderPending) return;
  transcriptRenderPending = true;
  requestAnimationFrame(() => {
    transcriptRenderPending = false;
    renderTranscript();
  });
}

function renderTools() {
  const events = [...state.tools.values()];
  elements.toolFeed.classList.toggle("is-hidden", events.length === 0);
  const loading = events.some((event) => event.status === "loading");
  elements.toolFeedState.textContent = loading ? "查詢中…" : `${events.length} 項結果`;
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
    listening: "已連線", speaking: "回答中", "processing-memory": "整理中", failed: "錯誤", stopped: "已結束",
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
