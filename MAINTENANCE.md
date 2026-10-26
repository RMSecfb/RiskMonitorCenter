# 維護手冊

風險管理中心（https://riskmonitorcenter.pages.dev/）的日常維護與異常處理。系統架構與部署步驟見 [README.md](README.md)。

所有操作都可以在 GitHub 與 Cloudflare 網頁上完成，手機瀏覽器也可以。請用 **RMSecfb** 帳號操作。

## 一、系統一覽

| 元件 | 位置 | 用途 |
| --- | --- | --- |
| 入口網站 | `RMSecfb/RiskMonitorCenter` → Cloudflare Pages | 3D 監控室、大螢幕燈號、今日市場報告、工具入口 |
| 市場指標 | `RMSecfb/MarketData` 的 `fetch_market.py` | 每日抓取債市、股市、匯市指標，寫入 `data/latest.json` |
| 國際新聞 | `RMSecfb/MarketData` 的 `fetch_news.py` | 每日 AI 整理國際重要新聞，寫入 `news/latest.json` |
| 負面新聞 | `RMSecfb/negative-news` | S&P 500 負面新聞擷取與 AI 判讀 |
| 準時排程 | Cloudflare Worker `risk-scheduler` | 準時觸發上述三個工作 |

## 二、每日排程

| 台北時間 | 工作 | 由誰觸發 |
| --- | --- | --- |
| 週二至週六 06:07、06:37、07:07 | 市場指標 | Cloudflare（準時）；GitHub 排程備援 |
| 每天 07:17 | 國際新聞 | Cloudflare（準時）；GitHub 排程備援 |
| 每天 08:22 | 負面新聞 | Cloudflare（準時）；GitHub 08:20 排程備援 |

- 週日、週一沒有新的美股收盤，所以不抓市場指標。
- GitHub 自己的排程在清晨常延誤 2 小時以上，只作備援。各工作都會判斷當天是否已完成，已完成就跳過，不會重複產生資料或多用 AI 額度。
- 資料更新後，GitHub 的資料檔有快取，網站可能要幾分鐘後才看到新資料。

## 三、每天怎麼確認正常

1. **入口網站頂部**：應顯示「即時・基準日 前一個美股交易日」。顯示「快照資料」代表讀不到 MarketData。
2. **今日市場報告**：國際新聞應是今天的日期。若顯示「這是 ○○ 的摘要，今日尚未更新」或「今日摘要未產生」，見第五節。
3. **GitHub Actions**：各 repo 的 Actions 頁面，當天的執行應是綠色勾勾。由 Cloudflare 觸發的會標示為 `workflow_dispatch`。
4. **國際新聞的執行紀錄**：點進 World News Summary Daily 的執行紀錄，頁面上的「新聞來源」與「今日摘要」通知會列出當天抓到的新聞數與選出的摘要。

## 四、手動執行

**位置**：打開 repo → 上方 **Actions** → 左側點選工作名稱 → 右邊 **Run workflow** → 依下表填選項 → 按綠色的 **Run workflow**。通常 1 分鐘內開始。

| 要重跑的 | repo | Actions 左側名稱 |
| --- | --- | --- |
| 市場指標 | MarketData | Fetch Market Data Daily |
| 國際新聞 | MarketData | World News Summary Daily |
| 負面新聞 | negative-news | Unified Risk News · FinBERT + LLM |

### 市場指標

| 選項 | 怎麼填 |
| --- | --- |
| `target_date` | **留空**：自動抓最近一個美股交易日。補抓特定日期才填，格式 `2026-10-27` |
| `respect_complete` | **不要勾**：一定重新抓。勾選時資料已齊全就跳過（Cloudflare 使用） |

- 人工維護的 CDS 會保留，不會被覆蓋。
- 補抓較早的日期不會把 `latest.json` 倒回舊資料。

### 國際新聞

| 選項 | 怎麼填 |
| --- | --- |
| `dry_run` | **不要勾**。勾選只列出抓到的標題，不產生摘要、不寫檔，可用來檢查新聞來源 |
| `skip_if_done` | **不要勾**：重新產生今天的摘要，**取代**原本的摘要。勾選時今天已成功就跳過（Cloudflare 使用） |

### 負面新聞

| 情況 | 怎麼填 |
| --- | --- |
| 當天排程沒跑或失敗 | 勾選 **`as_schedule`**：記錄成當天的每日排程，之後晚到的 GitHub 排程會跳過 |
| 當天已成功，想再抓一次 | 不要勾 `as_schedule`，會另外執行一次 |
| 只補 AI 判讀，不重新抓新聞 | 勾選 `resume` |

- 每日排程（含勾選 `as_schedule`）固定判讀 100 則（`DAILY_MAX_LLM`）；手動執行用 `max_llm`，預設 35。
- AI 判讀每天總上限 120 則（`LLM_DAILY_MAX`），每日排程用掉 100 則後，當天手動執行最多只剩 20 則。這個上限接近 Groq 免費方案 `gpt-oss-20b` 每日約 20 萬 token 的額度（每次約 1,600 token），不建議再調高。
- 判讀順序：標題含嚴重或重大事件字詞者優先；同分時 FinBERT 越負面越先判讀。
- 負面新聞的 Streamlit 網站也有「人工執行」功能，效果相同。

## 五、常見異常

| 狀況 | 可能原因 | 處理方式 |
| --- | --- | --- |
| 網站頂部顯示「快照資料」 | 讀不到 MarketData 的資料檔 | 確認 MarketData 的 Actions 是否失敗；若正常，等幾分鐘快取更新 |
| 網站基準日沒更新 | 當天市場指標沒跑或失敗 | 確認第六節 Cloudflare 狀態，再手動執行市場指標 |
| 某個指標旁標示「＊」 | 非同日資料：該市場假日、Yahoo 資料延遲；高收益債利差本來就晚一個交易日 | 偶爾發生不用處理；同一指標連續多日都是，再檢查資料來源 |
| 新指標顯示「待串接」 | `latest.json` 沒有 `markets_ext` | 手動執行一次市場指標 |
| 國際新聞「今日摘要未產生」 | Groq 模型呼叫失敗（已自動重試 3 次）、金鑰失效 | 看 `news/latest.json` 的 `status` 與 `error` 欄位；暫時性錯誤手動重跑即可；`no_key` 代表 MarketData 的 Secret `GROQ_API_KEY` 不見了 |
| 國際新聞內容不理想 | 當天新聞來源標題品質 | 手動重跑一次；長期問題調整 `fetch_news.py` 的提示詞或來源 |
| 負面新聞大量「待補分析」 | AI 判讀額度用完（每天 120 則） | 屬正常限制；待補分析不代表沒有風險，可隔天以 `resume` 補分析 |
| 網站顯示「設定檔讀取失敗」 | `config/*.json` 格式錯誤 | 到 RiskMonitorCenter 的提交紀錄，還原最近一次修改 |
| 某天整個沒排程 | Cloudflare Worker 權杖過期 | 見第六節 |

## 六、Cloudflare 準時排程

**檢查狀態**：打開 https://risk-scheduler.risk-sec.workers.dev/check ，三個工作都顯示 `"ok": true` 代表權杖有效。這個網址只讀取狀態，不會觸發任何工作。

**看觸發紀錄**：Cloudflare → Workers & Pages → `risk-scheduler` → **Logs**，會顯示每次觸發是否成功。

**定時觸發設定**（Settings → Trigger events → Cron Triggers，時間為 UTC）：

```
7,37 22 * * MON-FRI
7,17 23 * * *
22 0 * * *
```

星期請用英文縮寫。Cloudflare 的星期數字 1 代表週日，寫成 `1-5` 會變成週日到週四。

### 更換 GitHub 權杖（到期或失效時）

1. GitHub（RMSecfb）→ Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
2. Repository access 選 Only select repositories：`MarketData`、`negative-news`
3. Repository permissions → **Actions：Read and write**，其他維持 No access
4. 複製產生的 `github_pat_...`（只會顯示一次）
5. Cloudflare → `risk-scheduler` → Settings → Variables and Secrets → 編輯 `GITHUB_TOKEN`，貼上新權杖 → Deploy
6. 打開 `/check` 確認三個都是 `"ok": true`

權杖到期日：＿＿＿＿＿＿（建立時填寫，並記在行事曆上）

權杖過期時排程不會完全停擺：GitHub 原本的排程仍會執行，只是會延誤 2 小時以上。

## 七、修改設定

### 新增或修改工具

編輯 RiskMonitorCenter 的 `config/modules.json`，在 `tools` 裡加一筆。存檔後 Cloudflare 約 1 分鐘自動重新部署。

```json
{
  "id": "credit-watch",
  "name": "信用風險觀察名單",
  "domains": ["market"],
  "market": "台灣",
  "type": "網頁",
  "open": "embed",
  "url": "https://credit-watch.pages.dev/",
  "desc": "一句話說明這個工具做什麼",
  "updates": "每日 08:00 更新"
}
```

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 英文代號，不可重複 |
| `name` | 是 | 顯示名稱 |
| `domains` | 是 | `market` 市場及信用風險、`brokerage` 經紀業務、`esg` ESG 永續、`ops` 作業風險；可填多個 |
| `url` | 是 | 工具網址 |
| `desc` | 是 | 一句話說明 |
| `market`、`type` | 否 | 標籤文字 |
| `open` | 否 | `embed` 可在入口內預覽；Streamlit 或需要登入的工具用 `tab` |
| `login` | 否 | `true` 顯示「需要登入」 |
| `coldStart` | 否 | `true` 顯示「閒置後需喚醒」，Streamlit 建議加上 |
| `status`、`notice`、`updates` | 否 | 狀態標籤、橘色提醒、更新頻率 |

**JSON 格式很嚴格**，少一個逗號整個網站會顯示「設定檔讀取失敗」。常見錯誤：兩筆之間漏逗號、最後一筆後面多逗號、用了全形引號或逗號。提交前可貼到 https://jsonlint.com 檢查。

### 調整門檻

門檻在 **MarketData 的 `config.json`**，不在本 repo：

| 指標 | 放在哪裡 |
| --- | --- |
| VIX、MOVE、美債殖利率、費半（原有指標） | `thresholds`（`warn` 為 L1、`danger` 為 L2），也可在 MarketData 儀表板的設定頁修改 |
| 台幣、高收益債利差、七大股市指數（新增指標） | `panel_thresholds`（`l1`、`l2`、`type`） |

**新增指標的門檻不要放進 `thresholds`**，否則在 MarketData 儀表板設定頁按儲存時會被清掉。

`panel_thresholds` 的 `type`：`above` 高於門檻、`below` 低於門檻、`pct_drop` 當日跌幅（門檻寫負數，例如 `-3`）。

目前設定：美元兌台幣低於 30／29、高收益債利差高於 500／700bp、七大股市指數單日跌 3%／6%；港幣、日圓、澳幣不設門檻。

### 需要改程式的項目

| 項目 | 需要修改 |
| --- | --- |
| 新增大螢幕指標 | MarketData 的 `fetch_market.py`（`EXT_SYMBOLS`）加資料來源，再於本 repo `config/panels.json` 加一筆 |
| 新增第五個業務領域 | `app.js` 要加一張辦公桌的位置 |
| 調整國際新聞挑選方式 | MarketData 的 `fetch_news.py`（`FEEDS`、`NOISE`、`SYSTEM_PROMPT`） |
| 調整排程時間 | Cloudflare 定時觸發，以及 `scheduler/worker.js` 的 `jobsFor()` 要一起改 |

新增的延伸指標不要加進 `fetch_market.py` 的資料完整性檢查（`checks_for`），否則該市場放假或抓不到時，會讓整天的主要資料寫不進去。

## 八、提交身份

所有 repo 的提交一律以公司帳號 **RMSecfb** 署名，不使用個人帳號。
