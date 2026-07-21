import { VOICES } from "./js/constants.js";
import { checkRequiredModels, friendlyApiError } from "./js/gemini.js";
import { loadSettings, saveSettings } from "./js/storage.js";

const form = document.getElementById("settingsForm");
const apiKeyInput = document.getElementById("apiKey");
const voiceSelect = document.getElementById("voiceName");
const toggleKeyButton = document.getElementById("toggleKeyButton");
const testButton = document.getElementById("testButton");
const testStatus = document.getElementById("testStatus");
const saveStatus = document.getElementById("saveStatus");

for (const voice of VOICES) {
  const option = document.createElement("option");
  option.value = voice;
  option.textContent = voice;
  voiceSelect.appendChild(option);
}

const settings = await loadSettings();
apiKeyInput.value = settings.apiKey;
voiceSelect.value = settings.voiceName;

toggleKeyButton.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  toggleKeyButton.textContent = showing ? "顯示" : "隱藏";
});

testButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return showTestStatus("請先輸入 API key。", true);
  setBusy(testButton, true, "測試中…");
  showTestStatus("正在確認兩個必要模型…");
  try {
    await checkRequiredModels(apiKey);
    showTestStatus("連線成功，兩個模型皆可存取。", false, true);
  } catch (error) {
    showTestStatus(friendlyApiError(error), true);
  } finally {
    setBusy(testButton, false);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return showSaveStatus("API key 不可空白。", true);
  await saveSettings({ ...settings, apiKey, voiceName: voiceSelect.value });
  showSaveStatus("設定已儲存。", false);
});

function showTestStatus(message, isError = false, isSuccess = false) {
  testStatus.textContent = message;
  testStatus.className = `test-status ${isError ? "is-error" : isSuccess ? "is-success" : ""}`;
}

function showSaveStatus(message, isError) {
  saveStatus.textContent = message;
  saveStatus.className = isError ? "is-error" : "is-success";
  clearTimeout(showSaveStatus.timer);
  showSaveStatus.timer = setTimeout(() => { saveStatus.textContent = ""; }, 3500);
}

function setBusy(button, busy, label = "處理中…") {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}
