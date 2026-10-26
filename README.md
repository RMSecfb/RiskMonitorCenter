# 風險管理中心 Risk Intelligence Center

> 日常維護、手動執行與異常處理請見 [MAINTENANCE.md](MAINTENANCE.md)。

內部風險管理入口網站。以 3D 監控室呈現：正面大螢幕顯示債市、股市、匯市指標與 L1／L2 燈號，四張辦公桌代表四大業務領域，點擊後開啟各項既有工具。

## 畫面組成

| 區域 | 內容 |
| --- | --- |
| 大螢幕 | 債市 6 項、股市 9 項、匯市 4 項指標；點任一區可看門檻定義、資料日期與來源 |
| 四張辦公桌 | 市場及信用風險、經紀業務、ESG 永續、作業風險；點桌子或名牌開啟工具面板 |
| 今日市場報告 | 進站時彈出：三區狀態、已達 L2／已達 L1／L1 達 80% 的指標、AI 整理的國際重要新聞 |
| 監控室人員 | 市場正常時慢走；任一指標達 L1 或 L2 時快步走 |
| 清單模式 | 不使用 3D 的檢視方式；手機與無法顯示 3D 的裝置自動使用 |

## 檔案結構

```
RiskMonitorCenter/
├─ index.html            # 頁面與樣式
├─ app.js                # 3D 場景、燈號計算、今日報告、工具面板
├─ config/
│  ├─ modules.json       # 業務領域與工具登錄表
│  └─ panels.json        # 大螢幕三區的指標與門檻對應
└─ snapshot/             # 備用資料：讀不到 MarketData 時使用
   ├─ latest.json
   ├─ config.json
   └─ news.json
```

純靜態網站，不需要建置步驟。3D 使用 Three.js（r128，由 CDN 載入）。

## 資料來源

所有資料都來自 `RMSecfb/MarketData`，入口網站只讀取、不寫入：

| 資料 | 位置 | 更新 |
| --- | --- | --- |
| 市場指標 | `data/latest.json`（主要指標與 `markets_ext` 延伸指標） | 台北時間週二至週六 06:07 |
| 門檻 | `config.json` 的 `thresholds`（原有指標）與 `panel_thresholds`（延伸指標） | 人工調整 |
| 國際新聞 | `news/latest.json` | 每天台北時間 07:17 |

讀取順序：先讀 GitHub 上的最新資料，失敗才改用 `snapshot/`。頁面頂部會標示目前是「即時」或「快照資料」，以及資料基準日。

燈號規則與 MarketData 儀表板一致：`warn` 為 L1、`danger` 為 L2；殖利率看當日上升 bp，費半與股市指數看當日跌幅，10Y−2Y 利差小於 0 為 L2。沒有設定門檻的指標顯示「未設門檻」，不影響該區燈號。

## 常見調整

**新增工具**：在 `config/modules.json` 的 `tools` 加一筆，`domains` 填所屬領域代號（`market`、`brokerage`、`esg`、`ops`，可填多個）。不需要改程式。

```json
{
  "id": "new-tool",
  "name": "工具名稱",
  "domains": ["market"],
  "market": "台灣",
  "type": "網頁",
  "open": "embed",
  "url": "https://example.pages.dev/",
  "desc": "一句話說明"
}
```

`open` 為 `embed` 時可在入口內預覽（需 `site.embedTools` 為 `true`）；Streamlit 等需要登入或喚醒的工具用 `tab`，在新分頁開啟。可加上 `login: true`、`coldStart: true`、`status`、`notice`、`updates` 等標示。

**新增第五個業務領域**：`app.js` 要加一張辦公桌的位置。

**調整門檻**：門檻存放在 MarketData 的 `config.json`，不在本 repo。原有指標改 `thresholds`，延伸指標改 `panel_thresholds`。延伸指標不要放進 `thresholds`，否則在 MarketData 儀表板設定頁儲存時會被清掉。

**新增大螢幕指標**：先在 MarketData 的 `fetch_market.py` 加入資料，再於本 repo 的 `config/panels.json` 加一筆，`path` 指向資料位置，`rule` 指向門檻。



## 部署（Cloudflare Pages）可再限制內部存取（Cloudflare Access）

1. Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Application domain 填入上一步的 `*.pages.dev` 網址。
3. 建立 Policy：Action 選 Allow，Include 選 Emails ending in，填入公司信箱網域。
4. 建議 MarketData 儀表板也加上同樣的 Access 設定，保護其人工維護與設定的寫入功能。

注意：工具若加上 Access，在入口內「預覽」時可能顯示登入頁或無法嵌入，此時用「開啟工具」在新分頁開啟即可。

## 準時排程（Cloudflare Worker）

GitHub Actions 的定時排程在清晨常延誤 2 小時以上（例如 06:07 的市場資料實際 08:35 才開始）。`scheduler/` 是一個 Cloudflare Worker，在指定時間準時對 GitHub 發出「手動執行」，通常 1 分鐘內就會開始。GitHub 原本的排程保留作備援，各工作會判斷今天是否已完成，已完成就略過。

| 台北時間 | 觸發的工作 |
| --- | --- |
| 週二至週六 06:07、06:37、07:07 | MarketData 市場資料（資料已齊全時自動略過） |
| 每天 07:17 | MarketData 國際新聞（今日已產生時略過） |
| 每天 08:22 | negative-news 負面新聞（以每日排程身分執行，晚到的 GitHub 排程會略過） |
| 週一至週五 10:02、10:32、11:02、11:32、12:17、13:32、14:02、14:32、15:02、15:32、16:02 | hk-cross-border-monitor 港股盤中監控 |
| 週一至週五 16:42 | hk-cross-border-monitor 港股盤後批次 |

### 設定步驟

**1. 建立 GitHub token（用 RMSecfb 帳號）**

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token：

- Resource owner：RMSecfb
- Repository access：Only select repositories → `MarketData`、`negative-news`、`hk-cross-border-monitor`
- Repository permissions → **Actions：Read and write**（其他維持 No access）
- Expiration：依公司規定設定，並記下到期日；到期後排程會改由 GitHub 原排程（較晚）執行

**2. 建立 Worker**

Cloudflare → Workers & Pages → Create → Create Worker，名稱填 `risk-scheduler` → Deploy → Edit code，把 `scheduler/worker.js` 的內容整份貼上 → Deploy。

**3. 存入 token**

Worker → Settings → Variables and Secrets → Add：Type 選 **Secret**，Name 填 `GITHUB_TOKEN`，Value 貼上第 1 步的 token。

**4. 新增四組定時觸發**

Worker → Settings → Trigger events → Add → Cron Triggers，逐一新增（時間為 UTC）：

```
7,37 22 * * MON-FRI
7,17 23 * * *
22 0 * * *
2,17,32,42 2-8 * * MON-FRI
```

最後一組只是涵蓋港股所有時間點的範圍，程式會依實際時間判斷是否觸發（見 `worker.js` 的 `jobsFor`），其餘時間點會略過。

星期請用英文縮寫。Cloudflare 的星期數字 1 代表週日，寫成 `1-5` 會變成週日到週四。

**5. 確認**

瀏覽器打開 `https://risk-scheduler.<你的子網域>.workers.dev/check`，各排程都顯示 `"ok": true` 即設定完成。這個網址只讀取排程狀態，不會觸發任何工作。之後可在 Worker 的 Logs 看到每次觸發結果，GitHub Actions 的執行紀錄中由 Cloudflare 觸發的會標示為 workflow_dispatch。

免費方案每個 Cloudflare 帳號最多 5 組定時觸發，本 Worker 使用 4 組。

## 快照更新

`snapshot/` 只是備用資料，平常不需要更新。若要更新，從 MarketData 複製 `data/latest.json`、`config.json`、`news/latest.json`（改名為 `news.json`）覆蓋即可。
