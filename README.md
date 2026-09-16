# PageAsk

PageAsk 是一個 Chrome 116+ Manifest V3 擴充功能。它會把使用者選取的網頁文字區塊或本機檔案轉成單一參考來源，再透過 Gemini Live 進行可插話的即時語音／文字對談。

## 功能

- 閱讀／陪伴雙模式；陪伴模式不需選取網頁或上傳檔案
- 網頁區塊點選與反白文字右鍵選單
- PDF、TXT、Markdown、CSV、JSON 本機文字抽取
- Gemini Live 雙向語音、文字輸入、雙方字幕、VAD 與插話
- 可編輯陪伴人格，以及本機長期記憶的新增、編輯、刪除、鎖定與會後自動整理
- 可選純文字模式；不需麥克風權限也能使用 Live 文字輸入與字幕
- 麥克風權限狀態提示與 Chrome 權限設定入口
- 文字輸入支援 Enter 送出、Ctrl+Enter 換行，串流字幕片段會清除邊界空白
- Context window compression（25,000 tokens 觸發、保留最近 8,000 tokens）、Live API turn coverage、session resumption 與 GoAway 重連
- Gemini 3.8 Live 低延遲雙向語音，支援非同步工具呼叫與完整 session `clientContent` 文字更新
- Google Search grounding 使用 `gemini-2.5-flash`；YouTube 影片分析與記憶整理使用 Gemini 3.8 Flash
- 對談中提供公開 YouTube 影片網址即可請 Gemini 直接摘要或回答影片內容（不擷取字幕，由 Gemini 端直接讀取畫面與音訊），可選填時間片段
- 30 種 Gemini 原生聲線、Live 模型與本機 API key 設定
- Side panel 內設定對話框；模型測試會實際建立 Live session 並等待 `setupComplete`

## 安裝

1. 開啟 `chrome://extensions/`。
2. 啟用「開發人員模式」。
3. 點擊「載入未封裝項目」，選擇本 `PageAsk` 資料夾。
4. 在 PageAsk side panel 點擊右上角設定，輸入 Gemini API key、選擇聲線，再用「測試並儲存」實際建立 Live 工作階段。
5. 點擊工具列圖示開啟 side panel：閱讀模式先選取網頁區塊或上傳檔案；陪伴模式可直接開始對談。

反白文字也可直接使用右鍵選單「用 PageAsk 詢問」。Chrome 內建頁面（例如 `chrome://extensions`）不允許注入區塊選取器。

## 模型與免費層

- Live：`gemini-3.8-live`（低延遲、非同步工具呼叫）
- Google Search grounding：`gemini-2.5-flash`（目前 Search API 相容性需求）
- YouTube 影片分析與記憶整理：`gemini-3.8-flash`

PageAsk 會保存設定，並在下一場對談建立新 Live session 時套用；不會在通話中途或發生錯誤時自動改用另一個模型。3.8 的工具宣告使用 `behavior: "NON_BLOCKING"`，結果以 `WHEN_IDLE` 排程回報；文字輸入與自動續接則以明確 `role: "user"` 的 `clientContent` 傳送。

PageAsk 不會自動切換其他模型、Tavily、Google Maps 或付費 fallback。使用者仍須確保 API key 所屬專案為免費層；擴充功能無法替 Google 帳戶停用帳單。收到配額錯誤時，PageAsk 只會停止或顯示錯誤。

## 資料與隱私

- API key 未加密保存在 `chrome.storage.local`，只適合個人裝置。
- 網頁區塊選取權限只會在需要時要求，並與 Gemini API host permission 分開。
- 目前來源保存在 `chrome.storage.session`，Chrome 重啟後會清除。
- 陪伴模式的長期記憶未加密保存在 `chrome.storage.local`，可在側欄設定中管理或停用。
- 字幕、音訊、grounding 工作與 session handle 只存在記憶體；逐字稿只會在使用者按下「結束」後用於記憶整理，完成後即捨棄。
- 原始檔案不會上傳 Files API；瀏覽器本機抽取文字後，抽取結果才會送往 Gemini。
- 免費層提交的內容可能用於改善 Google 產品。

## 限制

- 單一檔案上限 10 MiB。
- 來源最多保留 60,000 個 Unicode 字元，超出部分會明確標示並截斷。
- 第一版不支援 Office、圖片／影音、OCR、多來源累加、完整對談歷史、多角色或記憶雲端同步。
- 只有按下「結束」會保證執行會後記憶整理；直接關閉側欄或瀏覽器不會建立待處理工作。

## 測試

需要 Node.js 18 或更新版本：

```powershell
cd PageAsk
npm test
```

測試涵蓋來源處理、檔案解析、PDF 頁序、3.8 Live setup、`setupComplete` 探測、模型 allowlist、設定遷移、純文字模式、快捷鍵、串流字幕合併、非同步 grounding 與 YouTube 影片分析、`WHEN_IDLE` 回應、權限錯誤分類與 PCM 音訊轉換。
