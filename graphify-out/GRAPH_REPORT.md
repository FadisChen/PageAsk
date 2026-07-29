# Graph Report - .  (2026-07-29)

## Corpus Check
- 36 files · ~94,891 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 112 nodes · 43 edges · 82 communities (6 shown, 76 thin omitted)
- Extraction: 51% EXTRACTED · 49% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.92)
- Token cost: 100,739 input · 0 output

## Community Hubs (Navigation)
- 陪伴模式與資料隱私
- Gemini Live 設定
- OpenCC-JS 授權資訊
- 工具呼叫與測試
- 純文字與麥克風模式
- 本機檔案來源
- PageAsk Extension Icon
- BrowserAudioEngine
- floatToPcm16
- resample
- describeLiveThinking
- getLiveModelOption
- getLiveThinkingOption
- formatPdfPages
- parseSourceFile
- appearsIncomplete
- buildCompanionSystemInstruction
- buildSystemInstruction
- checkRequiredModels
- cleanGeneratedMemories
- consolidateMemories
- createGroundingFunctionResponse
- createYoutubeAnalysisFunctionResponse
- extractMemories
- friendlyApiError
- LiveSession
- parseGroundingResponse
- probeLiveModel
- runGrounding
- runYoutubeVideoAnalysis
- addHistoryEntry
- createHistoryEntry
- deriveHistoryTitle
- exportHistoryListToMarkdown
- exportHistoryToMarkdown
- matchesHistorySearch
- memoryTokens
- processCompanionMemory
- createActiveSource
- normalizeSourceText
- safePageUrl
- cleanHistory
- cleanHistoryEntry
- cleanMemories
- cleanMemory
- cleanSettings
- cleanString
- clearSource
- createMemory
- estimateStorageBytes
- estimateTokens
- loadHistory
- loadMemories
- loadSettings
- loadSource
- makeId
- numberInRange
- saveHistory
- saveMemories
- saveSettings
- saveSource
- updateMemory
- toTraditionalChinese
- mergePartial
- options.html API key 輸入欄位
- options.html Live 模型下拉選單
- options.html 測試模型存取按鈕
- options.html 思考強度滑桿
- options.html 聲線下拉選單
- Context Window Compression
- GoAway 重連機制
- Session Resumption
- 來源限制
- VAD 與插話
- sidepanel.html 通話控制按鈕
- sidepanel.html 文字輸入表單
- sidepanel.html 即時對談區塊
- sidepanel.html 歷史紀錄對話框
- sidepanel.html 選取網頁區塊按鈕
- sidepanel.html 逐字稿區域
- TranscriptCollector
- sidepanel.html 語音狀態舞台

## God Nodes (most connected - your core abstractions)
1. `Gemini Live (real-time voice/text conversation)` - 7 edges
2. `思考強度 (Thinking Level: 自動/Minimal/Low/Medium/High)` - 5 edges
3. `測試套件 (npm test, Node.js 18+)` - 5 edges
4. `options.html 設定表單 (settingsForm)` - 5 edges
5. `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)` - 5 edges
6. `陪伴人格與長期記憶 (Companion Persona & Long-term Memory)` - 4 edges
7. `gemini-2.5-flash-native-audio-preview-12-2025 (NON_BLOCKING async tools)` - 4 edges
8. `opencc-js (Traditional/Simplified Chinese conversion library)` - 4 edges
9. `gemini-3.1-flash-live-preview (low-latency sync tools, default)` - 3 edges
10. `Google Search Grounding (non-blocking, WHEN_IDLE scheduling)` - 3 edges

## Surprising Connections (you probably didn't know these)
- `options.html 設定表單 (settingsForm)` --semantically_similar_to--> `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)`  [INFERRED] [semantically similar]
  options.html → sidepanel.html
- `options.html 設定表單 (settingsForm)` --conceptually_related_to--> `30 種 Gemini 原生聲線選擇`  [INFERRED]
  options.html → README.md
- `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)` --conceptually_related_to--> `30 種 Gemini 原生聲線選擇`  [INFERRED]
  sidepanel.html → README.md
- `opencc-js (Traditional/Simplified Chinese conversion library)` --conceptually_related_to--> `PageAsk (Chrome MV3 extension)`  [INFERRED]
  vendor/opencc-js-LICENSE.txt → README.md
- `sidepanel.html 對談模式切換 (readingModeButton/companionModeButton)` --conceptually_related_to--> `閱讀模式 (Reading Mode)`  [INFERRED]
  sidepanel.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **options.html 與 sidepanel.html 皆實作相同的 Live 模型/聲線/思考強度設定與測試流程** — options_settings_form, sidepanel_settings_dialog, readme_settings_test_setupcomplete [INFERRED 0.85]
- **陪伴模式人格與長期記憶功能群組** — readme_companion_mode, readme_companion_persona_memory, sidepanel_companion_settings, sidepanel_memory_manager [INFERRED 0.85]
- **Live 模型與工具呼叫行為（2.5 非同步／3.1 同步、思考強度、grounding）** — readme_gemini_25_model, readme_gemini_31_model, readme_google_search_grounding, readme_thinking_level [INFERRED 0.85]

## Communities (82 total, 76 thin omitted)

### Community 0 - "陪伴模式與資料隱私"
Cohesion: 0.18
Nodes (11): options.html 資料與免費層提醒 (privacy-note), chrome.storage.local (API key、長期記憶保存位置), chrome.storage.session (目前來源保存位置，重啟清除), 陪伴模式 (Companion Mode), 陪伴人格與長期記憶 (Companion Persona & Long-term Memory), 資料與隱私設計 (Data & Privacy), 不自動切換模型／付費 fallback 的政策, 閱讀模式 (Reading Mode) (+3 more)

### Community 1 - "Gemini Live 設定"
Cohesion: 0.57
Nodes (7): options.html 設定表單 (settingsForm), gemini-3.1-flash-live-preview (low-latency sync tools, default), Gemini Live (real-time voice/text conversation), 側欄設定測試（實際建立 Live session 並等待 setupComplete）, 思考強度 (Thinking Level: 自動/Minimal/Low/Medium/High), 30 種 Gemini 原生聲線選擇, sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)

### Community 2 - "OpenCC-JS 授權資訊"
Cohesion: 0.33
Nodes (6): PageAsk (Chrome MV3 extension), MIT License (opencc-js), The nk2028 Project (copyright holder), opencc-js (Traditional/Simplified Chinese conversion library), Apache License, Version 2.0, opencc-data package (dictionary data source)

### Community 3 - "工具呼叫與測試"
Cohesion: 0.50
Nodes (5): gemini-2.5-flash-native-audio-preview-12-2025 (NON_BLOCKING async tools), Google Search Grounding (non-blocking, WHEN_IDLE scheduling), 測試套件 (npm test, Node.js 18+), YouTube 影片分析 (Gemini 直接讀取畫面與音訊), sidepanel.html Grounding 結果面板 (toolFeed/toolItems)

### Community 4 - "純文字與麥克風模式"
Cohesion: 0.50
Nodes (4): 麥克風權限提示與設定入口, 純文字模式 (Text-only Mode), sidepanel.html 麥克風權限提示 (microphoneNotice), sidepanel.html 只使用文字切換 (textOnlyMode)

### Community 5 - "本機檔案來源"
Cohesion: 0.67
Nodes (3): 本機檔案文字抽取 (PDF/TXT/Markdown/CSV/JSON extraction), sidepanel.html 目前來源區塊 (sourceSection), sidepanel.html 上傳檔案按鈕與 fileInput

## Knowledge Gaps
- **89 isolated node(s):** `BrowserAudioEngine`, `resample`, `floatToPcm16`, `getLiveModelOption`, `getLiveThinkingOption` (+84 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **76 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Gemini Live (real-time voice/text conversation)` connect `Gemini Live 設定` to `陪伴模式與資料隱私`, `工具呼叫與測試`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `不自動切換模型／付費 fallback 的政策` connect `陪伴模式與資料隱私` to `Gemini Live 設定`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Gemini Live (real-time voice/text conversation)` (e.g. with `options.html 設定表單 (settingsForm)` and `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)`) actually correct?**
  _`Gemini Live (real-time voice/text conversation)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `思考強度 (Thinking Level: 自動/Minimal/Low/Medium/High)` (e.g. with `options.html 設定表單 (settingsForm)` and `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)`) actually correct?**
  _`思考強度 (Thinking Level: 自動/Minimal/Low/Medium/High)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `options.html 設定表單 (settingsForm)` (e.g. with `Gemini Live (real-time voice/text conversation)` and `側欄設定測試（實際建立 Live session 並等待 setupComplete）`) actually correct?**
  _`options.html 設定表單 (settingsForm)` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)` (e.g. with `options.html 設定表單 (settingsForm)` and `Gemini Live (real-time voice/text conversation)`) actually correct?**
  _`sidepanel.html 設定對話框 (settingsDialog/panelSettingsForm)` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `BrowserAudioEngine`, `resample`, `floatToPcm16` to the rest of the system?**
  _89 weakly-connected nodes found - possible documentation gaps or missing edges._