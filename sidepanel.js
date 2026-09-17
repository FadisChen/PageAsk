import { BrowserAudioEngine } from "./js/audio.js";
import { AvatarStateMachine } from "./js/avatar/state-machine.js";
import { LipSyncAnalyzer } from "./js/avatar/lip-sync.js";
import { VrmAvatarController } from "./js/avatar/vrm-avatar-controller.js";
import {
  BROWSER_TOOL_DECLARATIONS,
  BROWSER_TOOL_ORIGINS,
  BROWSER_TOOL_PERMISSIONS,
  BROWSER_TOOL_SYSTEM_INSTRUCTION,
  PAGE_ACCESS_PERMISSIONS,
  isMutatingBrowserTool,
} from "./js/browser-tools.js";
import {
  DEFAULT_COMPANION_SYSTEM_PROMPT,
  DEFAULT_LIVE_MODEL,
  MESSAGE_TYPES,
  SOURCE_KEY,
  SOURCE_TOKEN_WARNING_TOKENS,
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
import {
  addHistoryEntry,
  createHistoryEntry,
  deriveHistoryTitle,
  exportHistoryListToMarkdown,
  excerpt,
  exportHistoryToMarkdown,
  matchesHistorySearch,
} from "./js/history.js";
import { fitMemoriesToBudget, processCompanionMemory } from "./js/memory.js";
import { ScreenShare } from "./js/screen-share.js";
import { createActiveSource, estimateSourceTokens } from "./js/source.js";
import {
  createMemory,
  clearSource,
  estimateTokens,
  loadHistory,
  loadMemories,
  loadSettings,
  loadSource,
  saveHistory,
  saveMemories,
  saveSettings,
  saveSource,
  updateMemory,
} from "./js/storage.js";
import { mergePartial } from "./js/transcript.js";

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
  "settingsButton", "historyButton", "readingModeButton", "companionModeButton",
  "sourceSection", "sourceState", "sourceCard", "sourceKind", "sourceTitle", "sourcePreview",
  "sourceLink", "sourceWarning", "pickBlockButton", "uploadButton", "fileInput",
  "conversationHeading", "connectionPill", "connectionText", "voiceStage", "levelBar", "avatarCanvas", "avatarFallback",
  "enableBrowserToolsButton",
  "sourceDetailsButton", "sourceSummaryTitle", "sourceDialog", "sourceCloseButton",
  "captionText", "transcriptButton", "transcriptDialog", "transcriptCloseButton", "latestTranscriptButton",
  "callActions", "startButton", "muteButton", "screenShareButton", "endButton", "transcript", "transcriptEmpty",
  "toolFeed", "toolFeedState", "toolItems", "toolConfirmation", "confirmationCount", "confirmationItems", "composer", "textInput", "sendButton", "toastRegion",
  "microphoneNotice", "microphonePermissionTitle", "microphonePermissionText", "openMicrophoneSettingsButton",
  "textOnlyMode",
  "settingsDialog", "panelSettingsForm", "settingsCloseButton", "settingsCancelButton",
  "settingsApiKey", "settingsToggleKeyButton",
  "settingsVoiceName", "settingsTestButton", "settingsTestStatus",
  "settingsCompanionPrompt", "settingsResetPromptButton", "settingsMemoryEnabled", "settingsMemoryBudget",
  "memoryUsage", "newMemoryButton", "newMemoryEditor", "newMemoryContent", "newMemoryLocked",
  "saveNewMemoryButton", "cancelNewMemoryButton", "memoryList",
  "historyDialog", "historyCloseButton", "historySearchInput", "exportAllHistoryButton", "historyList",
].map((id) => [id, document.getElementById(id)]));

let microphonePermissionStatus = null;
let transcriptRenderPending = false;
let followTranscript = true;
let avatarController = null;
let lipSync = null;
let avatarFrameTime = performance.now();
let avatarPendingDelta = 0;
const AVATAR_IDLE_FRAME_SECONDS = 1 / 20;
const avatarStateMachine = new AvatarStateMachine();
const pendingConfirmations = new Map();

const state = {
  settings: await loadSettings(),
  source: await loadSource(),
  memories: await loadMemories(),
  history: await loadHistory(),
  session: null,
  audio: null,
  screenShare: null,
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
  browserToolsGranted: false,
  historyQuery: "",
  sessionStartedAt: null,
};

renderAll();
void initializeAvatar();
void refreshBrowserToolPermission();

for (const voice of VOICES) {
  const option = document.createElement("option");
  option.value = voice;
  option.textContent = voice;
  elements.settingsVoiceName.appendChild(option);
}

elements.settingsButton.addEventListener("click", openSettings);
elements.historyButton.addEventListener("click", openHistory);
elements.historyCloseButton.addEventListener("click", closeHistory);
elements.historyDialog.addEventListener("click", (event) => {
  if (event.target === elements.historyDialog) closeHistory();
});
elements.historySearchInput.addEventListener("input", () => {
  state.historyQuery = elements.historySearchInput.value;
  renderHistoryList();
});
elements.exportAllHistoryButton.addEventListener("click", exportAllHistory);
elements.historyList.addEventListener("click", handleHistoryListClick);
elements.historyList.addEventListener("change", handleHistoryListChange);
elements.settingsCloseButton.addEventListener("click", closeSettings);
elements.settingsCancelButton.addEventListener("click", closeSettings);
elements.settingsToggleKeyButton.addEventListener("click", toggleSettingsKey);
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
elements.screenShareButton.addEventListener("click", toggleScreenShare);
elements.endButton.addEventListener("click", () => endSession());
elements.composer.addEventListener("submit", sendText);
elements.textInput.addEventListener("keydown", handleTextInputKeydown);
elements.openMicrophoneSettingsButton.addEventListener("click", openMicrophoneSettings);
elements.textOnlyMode.addEventListener("change", () => {
  renderMicrophonePermission(microphonePermissionStatus?.state || "unknown");
  renderControls();
});
elements.sourceDetailsButton.addEventListener("click", () => elements.sourceDialog.showModal());
elements.sourceCloseButton.addEventListener("click", () => elements.sourceDialog.close());
elements.transcriptButton.addEventListener("click", () => {
  elements.transcriptDialog.showModal();
  renderTranscript();
});
elements.transcriptCloseButton.addEventListener("click", () => elements.transcriptDialog.close());
elements.latestTranscriptButton.addEventListener("click", () => {
  followTranscript = true;
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
  elements.latestTranscriptButton.classList.add("is-hidden");
});
elements.transcript.addEventListener("scroll", () => {
  if (!elements.transcriptDialog.open) return;
  followTranscript = elements.transcript.scrollHeight - elements.transcript.clientHeight - elements.transcript.scrollTop < 32;
  elements.latestTranscriptButton.classList.toggle("is-hidden", followTranscript);
});
for (const dialog of [elements.sourceDialog, elements.transcriptDialog]) {
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}
elements.enableBrowserToolsButton.addEventListener("click", enableBrowserTools);
elements.confirmationItems.addEventListener("click", handleConfirmationClick);

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

window.addEventListener("beforeunload", () => {
  state.screenShare?.stop();
  state.session?.stop(false);
  void state.audio?.stop();
  void clearTemporaryContent();
});

async function clearTemporaryContent() {
  state.transcript = new TranscriptCollector();
  followTranscript = true;
  state.source = null;
  await clearSource();
}

async function initializeAvatar() {
  try {
    avatarController = new VrmAvatarController(elements.avatarCanvas, {
      onLoading: (progress) => { elements.avatarFallback.classList.remove("is-hidden"); elements.avatarFallback.querySelector("span:last-child").textContent = `Avatar ${Math.round(progress * 100)}%`; },
      onReady: () => elements.avatarFallback.classList.add("is-hidden"),
      onError: (error) => { elements.avatarFallback.classList.remove("is-hidden"); elements.avatarFallback.querySelector("span:last-child").textContent = "Avatar 無法載入"; console.warn("PageAsk Avatar:", error.message); },
    });
    await avatarController.load(chrome.runtime.getURL("avatars/sha.vrm"));
  } catch (error) {
    elements.avatarFallback.querySelector("span:last-child").textContent = "語音模式";
    console.warn("PageAsk Avatar 初始化失敗：", error.message);
  }
  requestAnimationFrame(updateAvatarFrame);
}

function updateAvatarFrame(now) {
  const delta = Math.min(0.1, Math.max(0, (now - avatarFrameTime) / 1000));
  avatarFrameTime = now;
  if (document.visibilityState === "visible" && avatarController) {
    const playing = Boolean(state.audio?.isPlaying());
    avatarPendingDelta += delta;
    // Idle panels only need a gentle breathing loop, so render at a lower rate.
    if (state.started || playing || avatarPendingDelta >= AVATAR_IDLE_FRAME_SECONDS) {
      const mouth = lipSync?.update(playing);
      if (mouth) avatarController.setViseme(mouth.viseme, mouth.weight, mouth.rms);
      avatarController.setState(avatarStateMachine.state);
      avatarController.update(avatarPendingDelta, playing);
      avatarPendingDelta = 0;
    }
  }
  requestAnimationFrame(updateAvatarFrame);
}

async function refreshBrowserToolPermission() {
  try {
    state.browserToolsGranted = await chrome.permissions.contains({ permissions: BROWSER_TOOL_PERMISSIONS });
  } catch {
    state.browserToolsGranted = false;
  }
  renderSurface();
  return state.browserToolsGranted;
}

async function enableBrowserTools() {
  if (state.browserToolsGranted) return toast("瀏覽器工具已啟用。 ");
  setBusy(elements.enableBrowserToolsButton, true, "等待權限…");
  try {
    const granted = await chrome.permissions.request({ permissions: BROWSER_TOOL_PERMISSIONS });
    if (!granted) return toast("未取得瀏覽器工具權限。", true);
    state.browserToolsGranted = true;
    toast("瀏覽器工具已啟用；下一場對談即可使用。 ");
  } catch (error) {
    toast(`權限設定失敗：${error.message}`, true);
  } finally {
    setBusy(elements.enableBrowserToolsButton, false);
    renderSurface();
  }
}

async function startBlockPicker() {
  if (state.started) return;
  setBusy(elements.pickBlockButton, true, "等待選取…");
  try {
    const pageAccessGranted = await chrome.permissions.request({ permissions: PAGE_ACCESS_PERMISSIONS, origins: BROWSER_TOOL_ORIGINS });
    if (!pageAccessGranted) throw new Error("需要網頁內容存取權限才能選取區塊。");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !/^https?:\/\//i.test(tab.url)) {
      throw new Error("這個 Chrome 內建頁面不允許選取內容，請改用一般網頁。");
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
    toast(source.truncated
      ? "檔案已載入，超出 Live 來源上限的部分已截斷。"
      : source.tokenWarning
        ? "檔案已載入，來源較長，可能增加 Live 對談延遲。"
        : "檔案已載入。 ");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(elements.uploadButton, false);
  }
}

async function startSession() {
  if (state.started || state.ending || state.memoryProcessing) return;
  state.settings = await loadSettings();
  await refreshBrowserToolPermission();
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
  state.sessionStartedAt = Date.now();
  state.activeMode = mode;
  state.activeMemoryEnabled = mode === "companion" && state.settings.companionMemoryEnabled;
  state.activeMemoryConfig = state.activeMemoryEnabled ? {
    apiKey: state.settings.apiKey,
    budgetTokens: state.settings.companionMemoryBudgetTokens,
  } : null;
  const promptMemories = state.activeMemoryEnabled
    ? fitMemoriesToBudget(state.memories, state.activeMemoryConfig.budgetTokens)
    : { memories: [], omittedCount: 0 };
  if (promptMemories.omittedCount) {
    toast(`記憶超過本次預算，已省略 ${promptMemories.omittedCount} 條。`);
  }
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
      promptMemories.memories.map((memory) => memory.content),
    )
    : buildSystemInstruction(state.source);
  const workspaceInstruction = state.browserToolsGranted ? BROWSER_TOOL_SYSTEM_INSTRUCTION : "";

  try {
    state.audio = new BrowserAudioEngine({
      onAudioChunk: (bytes) => state.session?.sendAudio(bytes),
      onLevel: (level) => { elements.levelBar.style.width = `${Math.round(level * 100)}%`; },
      onOutputStarted: () => { avatarStateMachine.toSpeaking(); avatarController?.finishTurn(); },
      onOutputDrained: () => { lipSync?.reset(); avatarController?.resetAnimation(); if (state.started) avatarStateMachine.toListening(); },
    });
    await state.audio.start({ captureMicrophone: useMicrophone });
    lipSync = new LipSyncAnalyzer(state.audio.getAnalyser());
    if (useMicrophone) renderMicrophonePermission("granted");
    state.session = new LiveSession({
      apiKey: state.settings.apiKey,
      liveModel: DEFAULT_LIVE_MODEL,
      voiceName: state.settings.voiceName,
      systemInstruction: `${systemInstruction}${workspaceInstruction}`,
      additionalToolDeclarations: state.browserToolsGranted ? BROWSER_TOOL_DECLARATIONS : [],
      toolHandlers: state.browserToolsGranted ? createBrowserToolHandlers() : {},
      autoContinueIncompleteText: !useMicrophone,
    }, {
      onStatus: setStatus,
      onAudio: (bytes) => state.audio?.playPcm24k(bytes),
      onUserTranscript: (text) => { state.transcript.onUser(text); scheduleTranscriptRender(); },
      onModelTranscript: (text) => { state.transcript.onModel(text); scheduleTranscriptRender(); },
      onInterrupted: () => { state.audio?.flushPlayback(); state.transcript.onInterrupted(); scheduleTranscriptRender(); },
      onTurnComplete: () => { state.transcript.onTurnComplete(); scheduleTranscriptRender(); },
      onGrounding: handleGroundingEvent,
      onYoutubeAnalysis: handleYoutubeAnalysisEvent,
      onEmotion: (emotion) => {
        avatarController?.setEmotion(emotion);
      },
      onGesture: (gesture) => {
        avatarController?.playGesture(gesture);
      },
      onTool: handleToolEvent,
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
  elements.settingsVoiceName.value = state.settings.voiceName;
  elements.settingsCompanionPrompt.value = state.settings.companionSystemPrompt;
  elements.settingsMemoryEnabled.checked = state.settings.companionMemoryEnabled;
  elements.settingsMemoryBudget.value = state.settings.companionMemoryBudgetTokens;
  elements.settingsApiKey.type = "password";
  elements.settingsToggleKeyButton.textContent = "顯示";
  closeNewMemoryEditor();
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

function memoryEditingBlocked() {
  if (!state.memoryProcessing) return false;
  toast("小書僮正在整理記憶，請稍候再編輯。", true);
  return true;
}

function openNewMemoryEditor() {
  if (memoryEditingBlocked()) return;
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
  if (memoryEditingBlocked()) return;
  const memory = createMemory(elements.newMemoryContent.value, elements.newMemoryLocked.checked);
  if (!memory) return toast("記憶內容不可空白。", true);
  const fitted = await saveMemoriesWithinBudget([...state.memories, memory], undefined, memory.id);
  if (!fitted.saved) return toast("這條記憶超過目前可用預算，請縮短內容或提高預算。", true);
  closeNewMemoryEditor();
  renderMemoryList();
  toast(memoryBudgetNotice(fitted, "已新增一條記憶。"), fitted.lockedOverBudget);
}

async function handleMemoryListClick(event) {
  const button = event.target.closest("button[data-memory-action]");
  if (!button || memoryEditingBlocked()) return;
  const item = button.closest("[data-memory-id]");
  const memory = state.memories.find((entry) => entry.id === item?.dataset.memoryId);
  if (!memory) return;

  if (button.dataset.memoryAction === "delete") {
    if (!confirm("確定要刪除這條長期記憶嗎？")) return;
    await saveMemoriesWithinBudget(state.memories.filter((entry) => entry.id !== memory.id));
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
  const fitted = await saveMemoriesWithinBudget(
    state.memories.map((entry) => entry.id === memory.id ? updated : entry),
    undefined,
    updated.id,
  );
  if (!fitted.saved) return toast("更新後的記憶超過目前可用預算，請縮短內容或提高預算。", true);
  renderMemoryList();
  toast(memoryBudgetNotice(fitted, "記憶已更新。"), fitted.lockedOverBudget);
}

async function saveMemoriesWithinBudget(
  memories,
  budgetTokens = Number(elements.settingsMemoryBudget.value),
  requiredMemoryId = null,
) {
  const fitted = fitMemoriesToBudget(
    memories,
    budgetTokens || state.settings.companionMemoryBudgetTokens,
    { preserveAllLocked: true },
  );
  if (requiredMemoryId && !fitted.memories.some((memory) => memory.id === requiredMemoryId)) {
    return { ...fitted, saved: false };
  }
  state.memories = await saveMemories(fitted.memories);
  return { ...fitted, saved: true };
}

function memoryBudgetNotice(fitted, successMessage) {
  if (fitted.lockedOverBudget) {
    const omittedNotice = fitted.omittedCount
      ? `另有 ${fitted.omittedCount} 條未鎖定記憶因超額而移除。`
      : "";
    return `${successMessage} 鎖定記憶已超過預算，仍保留在本機；對談時只會載入預算容許的部分。${omittedNotice}`;
  }
  if (fitted.omittedCount) {
    return `${successMessage} 另有 ${fitted.omittedCount} 條較舊的未鎖定記憶因超額而移除。`;
  }
  return successMessage;
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
    await probeLiveModel(next.apiKey, {
      voiceName: next.voiceName,
    });
    state.settings = await saveSettings(next);
    showSettingsTestStatus("Live 連線成功，設定已儲存。", false, true);
    if (state.memoryProcessing) return;
    const fitted = await saveMemoriesWithinBudget(state.memories, state.settings.companionMemoryBudgetTokens);
    if (fitted.omittedCount || fitted.lockedOverBudget) {
      toast(memoryBudgetNotice(fitted, "記憶已依新預算整理。"), fitted.lockedOverBudget);
    }
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
  if (state.memoryProcessing) {
    renderAll();
    return toast("設定已儲存；記憶預算會在本次整理完成後的下次儲存套用。");
  }
  const fitted = await saveMemoriesWithinBudget(state.memories, state.settings.companionMemoryBudgetTokens);
  renderAll();
  toast(memoryBudgetNotice(fitted, "設定已儲存。"), fitted.lockedOverBudget);
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
    voiceName: elements.settingsVoiceName.value,
    companionSystemPrompt: elements.settingsCompanionPrompt.value,
    companionMemoryEnabled: elements.settingsMemoryEnabled.checked,
    companionMemoryBudgetTokens: Number(elements.settingsMemoryBudget.value),
  };
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

  cancelPendingConfirmations();
  state.screenShare?.stop();
  state.screenShare = null;
  state.session?.stop();
  state.session = null;
  await state.audio?.stop();
  state.audio = null;
  lipSync?.reset();
  lipSync = null;
  state.started = false;
  state.muted = false;
  state.microphoneActive = false;

  if (transcript.length) {
    const entry = createHistoryEntry({
      mode: completedMode,
      sources: completedMode === "reading" && state.source ? [state.source] : [],
      transcript,
      startedAt: state.sessionStartedAt,
      endedAt: Date.now(),
    });
    const { history, evictedCount, warning } = addHistoryEntry(state.history, entry);
    try {
      state.history = await saveHistory(history);
      if (evictedCount) toast(`已清除 ${evictedCount} 筆最舊且未釘選的歷史紀錄。`);
      if (warning) toast(warning, true);
    } catch (error) {
      toast(`歷史紀錄儲存失敗：${error.message}`, true);
    }
  }

  let notice = transcript.length ? "對談已結束，逐字稿已保存至歷史紀錄。" : "對談已結束。";
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
      const changes = [];
      if (result.additions) changes.push(`新增 ${result.additions} 條`);
      if (result.updates) changes.push(`更新 ${result.updates} 條`);
      if (result.consolidated) changes.push("完成超額整併");
      notice = changes.length
        ? `已整理完成，長期記憶${changes.join("、")}。`
        : "這次對話沒有需要更新的長期記憶。";
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
      if (elements.settingsDialog.open) renderMemoryList();
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

async function toggleScreenShare() {
  if (state.screenShare) {
    state.screenShare.stop();
    state.screenShare = null;
    renderControls();
    return toast("已停止分享畫面。 ");
  }
  if (!state.started || state.ending || !state.session) return;
  const share = new ScreenShare({
    onFrame: (bytes) => state.session?.sendVideoFrame(bytes),
    onEnded: () => {
      if (state.screenShare !== share) return;
      state.screenShare = null;
      renderControls();
      toast("已停止分享畫面。 ");
    },
  });
  state.screenShare = share;
  renderControls();
  try {
    await share.start();
    if (state.screenShare !== share) return share.stop();
    toast("正在分享畫面，小書僮每秒會看到一張截圖。 ");
  } catch (error) {
    if (state.screenShare === share) state.screenShare = null;
    share.stop();
    toast(error?.name === "NotAllowedError" ? "已取消分享畫面。" : `無法分享畫面：${error.message}`, error?.name !== "NotAllowedError");
  } finally {
    renderControls();
  }
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
  handleToolEvent({ ...event, name: "ground_with_google_search" });
}

function handleYoutubeAnalysisEvent(event) {
  handleToolEvent({ ...event, name: "analyze_youtube_video" });
}

function handleToolEvent(event) {
  if (!event?.id) return;
  state.tools.set(event.id, event);
  while (state.tools.size > 8) state.tools.delete(state.tools.keys().next().value);
  renderTools();
}

function createBrowserToolHandlers() {
  return Object.fromEntries(BROWSER_TOOL_DECLARATIONS.map((tool) => [
    tool.name,
    ({ call, signal }) => runBrowserTool(call, signal),
  ]));
}

async function runBrowserTool(call, signal) {
  if (isMutatingBrowserTool(call.name)) {
    const allowed = await waitForConfirmation(call, signal);
    if (!allowed) return { response: { result: "使用者拒絕或取消了這項操作。" }, scheduling: "SILENT" };
  }
  if (signal.aborted) return { response: { result: "工具已取消。" }, scheduling: "SILENT" };
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.EXECUTE_BROWSER_TOOL,
    name: call.name,
    args: call.args || {},
  });
  if (!response?.ok) throw new Error(response?.error || "瀏覽器工具執行失敗。");
  return { response: response.result || { result: "操作完成。" }, scheduling: "WHEN_IDLE" };
}

function waitForConfirmation(call, signal) {
  return new Promise((resolve) => {
    const request = { call, resolve };
    pendingConfirmations.set(call.id, request);
    renderConfirmations();
    const abort = () => {
      if (!pendingConfirmations.has(call.id)) return;
      pendingConfirmations.delete(call.id);
      resolve(false);
      renderConfirmations();
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.cleanup = () => signal?.removeEventListener("abort", abort);
  });
}

function handleConfirmationClick(event) {
  const button = event.target.closest("button[data-confirm-action]");
  if (!button) return;
  const request = pendingConfirmations.get(button.dataset.confirmId);
  if (!request) return;
  pendingConfirmations.delete(button.dataset.confirmId);
  request.cleanup?.();
  request.resolve(button.dataset.confirmAction === "allow");
  renderConfirmations();
}

function cancelPendingConfirmations() {
  for (const request of pendingConfirmations.values()) {
    request.cleanup?.();
    request.resolve(false);
  }
  pendingConfirmations.clear();
  renderConfirmations();
}

function renderConfirmations() {
  const requests = [...pendingConfirmations.values()];
  if (requests.length && elements.toolConfirmation.classList.contains("is-hidden")) {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  }
  elements.toolConfirmation.classList.toggle("is-hidden", requests.length === 0);
  elements.confirmationCount.textContent = `${requests.length} 項`;
  elements.confirmationItems.replaceChildren();
  for (const { call } of requests) {
    const item = document.createElement("article");
    item.className = "confirmation-item";
    const title = document.createElement("strong");
    title.textContent = confirmationTitle(call.name);
    const detail = document.createElement("p");
    detail.textContent = confirmationDetail(call);
    const actions = document.createElement("div");
    actions.className = "confirmation-actions";
    actions.append(
      confirmationButton("allow", "確認執行", call.id, "button button-primary button-small"),
      confirmationButton("deny", "取消", call.id, "button button-secondary button-small"),
    );
    item.append(title, detail, actions);
    elements.confirmationItems.appendChild(item);
  }
}

function confirmationButton(action, label, id, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.confirmAction = action;
  button.dataset.confirmId = id;
  button.textContent = label;
  return button;
}

function confirmationTitle(name) {
  return ({
    activate_tab: "切換瀏覽器分頁",
    add_bookmark: "新增書籤",
    add_to_reading_list: "加入 Reading List",
    download_file: "開始下載檔案",
    navigate_tab: "導覽分頁到新網址",
    close_tab: "關閉瀏覽器分頁",
  })[name] || "確認瀏覽器操作";
}

function confirmationDetail(call) {
  const args = call.args || {};
  const values = Object.entries(args)
    .filter(([key]) => ["url", "title", "filename", "tab_id", "parent_id"].includes(key))
    .map(([key, value]) => `${key}：${String(value)}`);
  return values.join("\n") || "PageAsk 想執行一項瀏覽器操作。";
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

async function openHistory() {
  state.history = await loadHistory();
  elements.historySearchInput.value = state.historyQuery;
  renderHistoryList();
  if (!elements.historyDialog.open) elements.historyDialog.showModal();
}

function closeHistory() {
  elements.historyDialog.close();
}

function renderHistoryList() {
  const entries = state.history
    .filter((entry) => matchesHistorySearch(entry, state.historyQuery))
    .sort((a, b) => b.endedAt - a.endedAt);

  elements.historyList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = state.history.length
      ? "沒有符合搜尋條件的歷史紀錄。"
      : "還沒有任何歷史紀錄。結束一場對談後會自動保存在這裡。";
    elements.historyList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    elements.historyList.appendChild(buildHistoryItem(entry));
  }
}

function buildHistoryItem(entry) {
  const item = document.createElement("article");
  item.className = "history-item";
  item.dataset.historyId = entry.id;

  const head = document.createElement("div");
  head.className = "history-item-head";
  const badge = document.createElement("span");
  badge.className = `history-badge ${entry.mode === "companion" ? "is-companion" : ""}`;
  badge.textContent = entry.mode === "companion" ? "陪伴" : "閱讀";
  const title = document.createElement("strong");
  title.className = "history-item-title";
  title.textContent = deriveHistoryTitle(entry);
  head.append(badge, title);

  const preview = document.createElement("p");
  preview.className = "history-item-preview";
  const firstLine = entry.transcript.find((line) => line.role === "user") || entry.transcript[0];
  preview.textContent = excerpt(firstLine?.text || "", 160);

  const details = document.createElement("details");
  details.className = "history-item-details";
  const summary = document.createElement("summary");
  summary.textContent = "展開完整逐字稿";
  const transcriptBox = document.createElement("div");
  transcriptBox.className = "history-transcript";
  for (const line of entry.transcript) {
    const row = document.createElement("div");
    row.className = `transcript-line ${line.role === "model" ? "is-model" : ""}`;
    const label = document.createElement("strong");
    label.textContent = line.role === "model" ? "小書僮" : "你";
    const text = document.createElement("p");
    text.textContent = line.text;
    row.append(label, text);
    transcriptBox.appendChild(row);
  }
  details.append(summary, transcriptBox);

  const meta = document.createElement("div");
  meta.className = "memory-meta";
  const pin = document.createElement("label");
  pin.className = "memory-lock-toggle";
  const pinCheckbox = document.createElement("input");
  pinCheckbox.type = "checkbox";
  pinCheckbox.checked = entry.pinned;
  pinCheckbox.dataset.historyPin = "true";
  pin.append(pinCheckbox, document.createTextNode(" 釘選"));

  const time = document.createElement("span");
  time.textContent = new Date(entry.endedAt).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });

  const actions = document.createElement("div");
  actions.className = "memory-item-actions";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.dataset.historyAction = "export";
  exportButton.textContent = "匯出";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.dataset.historyAction = "delete";
  deleteButton.textContent = "刪除";
  actions.append(exportButton, deleteButton);
  meta.append(pin, time, actions);

  item.append(head, preview, details, meta);
  return item;
}

async function handleHistoryListChange(event) {
  const checkbox = event.target.closest("input[data-history-pin]");
  if (!checkbox) return;
  const item = checkbox.closest("[data-history-id]");
  const id = item?.dataset.historyId;
  if (!id) return;
  state.history = await saveHistory(
    state.history.map((entry) => (entry.id === id ? { ...entry, pinned: checkbox.checked } : entry)),
  );
}

async function handleHistoryListClick(event) {
  const button = event.target.closest("button[data-history-action]");
  if (!button) return;
  const item = button.closest("[data-history-id]");
  const entry = state.history.find((candidate) => candidate.id === item?.dataset.historyId);
  if (!entry) return;

  if (button.dataset.historyAction === "export") {
    downloadMarkdown(historyFileName(entry), exportHistoryToMarkdown(entry));
    return;
  }

  if (button.dataset.historyAction === "delete") {
    if (!confirm("確定要刪除這筆歷史紀錄嗎？")) return;
    state.history = await saveHistory(state.history.filter((candidate) => candidate.id !== entry.id));
    renderHistoryList();
    toast("歷史紀錄已刪除。 ");
  }
}

function exportAllHistory() {
  if (!state.history.length) return toast("目前沒有歷史紀錄可以匯出。", true);
  downloadMarkdown("pageask-history.md", exportHistoryListToMarkdown([...state.history].sort((a, b) => b.endedAt - a.endedAt)));
}

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function historyFileName(entry) {
  const date = new Date(entry.startedAt).toISOString().slice(0, 10);
  return `pageask-${date}-${entry.id}.md`;
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
  renderSurface();
  renderConfirmations();
  renderStatus();
}

function renderSurface() {
  elements.enableBrowserToolsButton.textContent = state.browserToolsGranted ? "瀏覽器工具已啟用" : "啟用瀏覽器工具";
  elements.enableBrowserToolsButton.disabled = state.browserToolsGranted || state.started || state.memoryProcessing;
}

function renderSource() {
  const source = state.source;
  elements.sourceDetailsButton.disabled = !source;
  elements.sourceSummaryTitle.textContent = source ? source.title : "加入一份閱讀來源";
  elements.sourceDetailsButton.title = source ? `${source.title} — 查看來源` : "選取網頁區塊或上傳檔案";
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
  const retainedTokens = Number.isFinite(source.retainedTokens)
    ? source.retainedTokens
    : estimateSourceTokens(source.text);
  const originalTokens = Number.isFinite(source.originalTokens)
    ? source.originalTokens
    : estimateSourceTokens(source.text);
  const tokenWarning = source.tokenWarning || retainedTokens >= SOURCE_TOKEN_WARNING_TOKENS;
  elements.sourceState.textContent = `${source.retainedChars.toLocaleString()} 字 · 約 ${retainedTokens.toLocaleString()} tokens${source.truncated ? " · 已截斷" : ""}`;
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
  if (source.truncated || tokenWarning) {
    elements.sourceWarning.textContent = source.truncated
      ? `原始內容約 ${originalTokens.toLocaleString()} tokens，已保留前 ${retainedTokens.toLocaleString()} tokens（${source.retainedChars.toLocaleString()} 字）。`
      : `來源約 ${retainedTokens.toLocaleString()} tokens，已接近 Live 對談建議上限。`;
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
  const sharing = Boolean(state.screenShare);
  elements.screenShareButton.disabled = !sharing && (!state.started || state.ending || state.status === "connecting" || state.status === "permission");
  elements.screenShareButton.textContent = sharing ? "停止分享" : "分享畫面";
  elements.screenShareButton.classList.toggle("is-sharing", sharing);
  elements.screenShareButton.setAttribute("aria-pressed", String(sharing));
  const canType = state.started && state.status !== "connecting" && state.status !== "permission" && state.status !== "reconnecting";
  elements.textInput.disabled = !canType;
  elements.sendButton.disabled = !canType;
}

function renderStatus() {
  elements.connectionText.textContent = connectionLabel(state.status);
  elements.connectionPill.className = `connection-pill ${state.status === "listening" ? "is-live" : state.status === "speaking" ? "is-speaking" : state.status === "failed" ? "is-error" : ""}`;
  elements.voiceStage.className = `voice-stage ${state.status === "listening" ? "is-listening" : state.status === "speaking" ? "is-speaking" : ""}`;
}

function renderTranscript() {
  const lines = state.transcript.preview();
  const latest = lines.at(-1);
  const caption = latest?.text || "";
  if (elements.captionText.textContent !== caption) {
    elements.captionText.textContent = caption;
    elements.captionText.scrollTop = elements.captionText.scrollHeight;
  }
  if (!elements.transcriptDialog.open) return;
  if (!lines.length) {
    if (elements.transcriptEmpty.parentElement !== elements.transcript) {
      while (elements.transcript.firstChild) elements.transcript.firstChild.remove();
      elements.transcript.append(elements.transcriptEmpty);
    }
    const copy = elements.transcriptEmpty.querySelector("p");
    const companion = (state.activeMode || state.settings.conversationMode) === "companion";
    copy.textContent = companion && state.settings.companionMemoryEnabled
      ? "逐字稿會用於會後整理長期記憶，並保存一份到歷史紀錄；直接關閉面板則不會保存。"
      : "開始後，你和 小書僮 的即時字幕會留在這裡；按下「結束」後會保存到歷史紀錄，直接關閉面板則不會保存。";
    return;
  }

  elements.transcriptEmpty.remove();
  for (const [index, line] of lines.entries()) {
    const isModel = line.role === "model";
    let row = elements.transcript.children[index];
    if (!row) {
      row = document.createElement("div");
      row.append(document.createElement("strong"), document.createElement("p"));
      elements.transcript.append(row);
    }
    row.className = `transcript-line ${isModel ? "is-model" : ""}`;
    const [label, text] = row.children;
    const speaker = isModel ? "小書僮" : "你";
    if (label.textContent !== speaker) label.textContent = speaker;
    if (text.textContent !== line.text) text.textContent = line.text;
  }
  while (elements.transcript.children.length > lines.length) elements.transcript.lastElementChild.remove();
  if (followTranscript) elements.transcript.scrollTop = elements.transcript.scrollHeight;
  elements.latestTranscriptButton.classList.toggle("is-hidden", followTranscript);
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
  elements.transcriptButton.textContent = events.length ? `逐字稿 · ${events.length} 項工具結果 ↗` : "逐字稿 ↗";
  elements.toolFeed.classList.toggle("is-hidden", events.length === 0);
  const loading = events.some((event) => event.status === "loading");
  elements.toolFeedState.textContent = loading ? "查詢中…" : `${events.length} 項結果`;
  elements.toolItems.replaceChildren();
  for (const event of events) {
    const item = event.name === "analyze_youtube_video"
      ? renderYoutubeToolItem(event)
      : event.name === "ground_with_google_search"
        ? renderGroundingToolItem(event)
        : renderBrowserToolItem(event);
    elements.toolItems.appendChild(item);
  }
}

function renderBrowserToolItem(event) {
  const item = document.createElement("div");
  item.className = "tool-item";
  const title = document.createElement("strong");
  title.textContent = `${browserToolLabel(event.name)} · ${event.status === "loading" ? "執行中" : event.status === "complete" ? "完成" : "失敗"}`;
  const detail = document.createElement("span");
  detail.textContent = event.error || summarizeToolResult(event.result) || "等待工具結果";
  item.append(title, detail);
  return item;
}

function browserToolLabel(name) {
  return ({
    list_open_tabs: "分頁清單",
    activate_tab: "切換分頁",
    search_history: "搜尋歷史紀錄",
    search_bookmarks: "搜尋書籤",
    list_reading_list: "Reading List",
    add_bookmark: "新增書籤",
    add_to_reading_list: "加入 Reading List",
    list_downloads: "下載狀態",
    download_file: "下載檔案",
    navigate_tab: "導覽分頁",
    close_tab: "關閉分頁",
  })[name] || "瀏覽器工具";
}

function summarizeToolResult(result) {
  if (!result) return "";
  if (typeof result === "string") return excerpt(result, 180);
  if (typeof result !== "object") return String(result);
  if (result.result && typeof result.result === "string") return excerpt(result.result, 180);
  for (const key of ["items", "tabs"]) if (Array.isArray(result[key])) return `回傳 ${result[key].length} 項資料`;
  return Object.entries(result).slice(0, 3).map(([key, value]) => `${key}：${String(value)}`).join("；");
}

function renderGroundingToolItem(event) {
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
  return item;
}

function renderYoutubeToolItem(event) {
  const item = document.createElement("div");
  item.className = "tool-item";
  const title = document.createElement("strong");
  title.textContent = event.status === "loading" ? "正在分析 YouTube 影片…" : event.status === "complete" ? "影片分析完成" : "影片分析失敗";
  const detail = document.createElement("span");
  detail.textContent = event.error || event.question || "整體摘要";
  item.append(title, detail);
  if (event.url) {
    const links = document.createElement("div");
    links.className = "tool-sources";
    const anchor = document.createElement("a");
    anchor.href = event.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = excerpt(event.url, 28);
    links.appendChild(anchor);
    item.appendChild(links);
  }
  return item;
}

function setStatus(status) {
  state.status = status;
  const avatarState = status === "speaking"
    ? "speaking"
    : status === "listening"
      ? "listening"
      : status === "connecting" || status === "reconnecting" || status === "permission" || status === "thinking"
        ? "thinking"
        : status === "failed"
          ? "interrupted"
          : "idle";
  avatarStateMachine.set(avatarState);
  avatarController?.setState(avatarState);
  renderStatus();
  renderControls();
}

function connectionLabel(status) {
  return ({
    ready: "準備中", permission: "等待授權", connecting: "連線中", reconnecting: "重連中",
    listening: "已連線", thinking: "思考中", speaking: "回答中", "processing-memory": "整理中", failed: "錯誤", stopped: "已結束",
  })[status] || status;
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
