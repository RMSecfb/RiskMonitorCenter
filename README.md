# 風險管理中心 Risk Intelligence Center

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

**調整門檻**：門檻存放在 MarketData 的 `config.json`，不在本 repo。原有指標改 `thresholds`，延伸指標改 `panel_thresholds`。延伸指標不要放進 `thresholds`，否則在 MarketData 儀表板設定頁儲存時會被清掉。

**新增大螢幕指標**：先在 MarketData 的 `fetch_market.py` 加入資料，再於本 repo 的 `config/panels.json` 加一筆，`path` 指向資料位置，`rule` 指向門檻。

## 部署（Cloudflare Pages）

1. Cloudflare 後台 → Workers & Pages → Create → Pages → Connect to Git，選擇本 repo。
2. Build settings：Framework preset 選 None，Build command 留空，Build output directory 填 `/`。
3. 部署完成後取得 `*.pages.dev` 網址。

## 限制內部存取（Cloudflare Access）

1. Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Application domain 填入上一步的 `*.pages.dev` 網址。
3. 建立 Policy：Action 選 Allow，Include 選 Emails ending in，填入公司信箱網域。
4. 建議 MarketData 儀表板也加上同樣的 Access 設定，保護其人工維護與設定的寫入功能。

注意：工具若加上 Access，在入口內「預覽」時可能顯示登入頁或無法嵌入，此時用「開啟工具」在新分頁開啟即可。

## 快照更新

`snapshot/` 只是備用資料，平常不需要更新。若要更新，從 MarketData 複製 `data/latest.json`、`config.json`、`news/latest.json`（改名為 `news.json`）覆蓋即可。
