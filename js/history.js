import { MAX_HISTORY_ENTRIES, MAX_HISTORY_TOTAL_BYTES } from "./constants.js";
import { cleanHistoryEntry, estimateStorageBytes, makeId } from "./storage.js";

export function createHistoryEntry({ mode, personaId = null, personaName = "", sources = [], transcript, startedAt, endedAt }) {
  const now = Date.now();
  return cleanHistoryEntry({
    id: makeId(),
    mode,
    personaId,
    personaName,
    sourceTitles: (sources || []).map((source) => source?.title).filter(Boolean),
    transcript,
    startedAt: startedAt || now,
    endedAt: endedAt || now,
    createdAt: now,
    updatedAt: now,
  });
}

export function addHistoryEntry(history, entry, { maxEntries = MAX_HISTORY_ENTRIES, maxTotalBytes = MAX_HISTORY_TOTAL_BYTES } = {}) {
  const current = Array.isArray(history) ? history : [];
  if (!entry) return { history: current, evictedCount: 0, warning: "" };

  let next = [...current, entry];
  let evictedCount = 0;
  while (next.length > maxEntries || estimateStorageBytes(next) > maxTotalBytes) {
    const oldestUnpinnedIndex = findOldestUnpinnedIndex(next);
    if (oldestUnpinnedIndex === -1) {
      return {
        history: next,
        evictedCount,
        warning: "已釘選的歷史紀錄超過儲存上限；小書僮不會自動刪除它們。",
      };
    }
    next.splice(oldestUnpinnedIndex, 1);
    evictedCount += 1;
  }
  return { history: next, evictedCount, warning: "" };
}

function findOldestUnpinnedIndex(history) {
  let index = -1;
  let oldest = Infinity;
  history.forEach((entry, i) => {
    if (entry.pinned) return;
    if (entry.endedAt < oldest) {
      oldest = entry.endedAt;
      index = i;
    }
  });
  return index;
}

export function deriveHistoryTitle(entry) {
  if (entry.sourceTitles?.length) return entry.sourceTitles.join("、");
  const firstUserLine = entry.transcript.find((line) => line.role === "user");
  if (firstUserLine) return excerpt(firstUserLine.text, 40);
  return entry.mode === "companion" ? "陪伴對談" : "閱讀對談";
}

export function matchesHistorySearch(entry, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("zh-TW");
  if (!needle) return true;
  const haystack = [
    entry.personaName,
    ...(entry.sourceTitles || []),
    ...(entry.transcript || []).map((line) => line.text),
  ].join("\n").toLocaleLowerCase("zh-TW");
  return haystack.includes(needle);
}

export function exportHistoryToMarkdown(entry) {
  const lines = [`# ${deriveHistoryTitle(entry)}`, ""];
  lines.push(`- 模式：${entry.mode === "companion" ? "陪伴" : "閱讀"}`);
  if (entry.personaName) lines.push(`- 人格：${entry.personaName}`);
  if (entry.sourceTitles?.length) lines.push(`- 來源：${entry.sourceTitles.join("、")}`);
  lines.push(`- 時間：${new Date(entry.startedAt).toLocaleString("zh-TW")} - ${new Date(entry.endedAt).toLocaleString("zh-TW")}`);
  lines.push("");
  for (const line of entry.transcript) {
    lines.push(`**${line.role === "model" ? (entry.personaName || "小書僮") : "你"}**：${line.text}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function exportHistoryListToMarkdown(entries) {
  return entries.map(exportHistoryToMarkdown).join("\n---\n\n");
}

function excerpt(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
