/**
 * 風險管理排程觸發器（Cloudflare Worker）
 *
 * GitHub Actions 的 schedule 在清晨常延誤 2 小時以上；「手動執行」（workflow_dispatch）
 * 則通常 1 分鐘內開始。本 Worker 用 Cloudflare 的定時觸發，準時幫 GitHub 按下手動執行。
 * GitHub 原本的 schedule 保留作為備援：各工作已有「今日已完成就略過」的判斷，不會重做。
 *
 * Cron Triggers（UTC；星期用英文縮寫，Cloudflare 的數字 1 代表週日）：
 *   7,37 22 * * MON-FRI   台北週二至週六 06:07、06:37 → 市場資料
 *   7,17 23 * * *         台北每天 07:07（週二至週六）→ 市場資料；07:17 → 國際新聞
 *   22 0 * * *            台北每天 08:22 → 負面新聞
 *   2,17,32,42 2-8 * * MON-FRI
 *                         台北週一至週五 → 港股跨境交易監控。此組合涵蓋較多時間點，
 *                         實際只在下列時間觸發，其餘由 jobsFor() 略過：
 *                         盤中 10:02 10:32 11:02 11:32 12:17 13:32 14:02 14:32 15:02 15:32 16:02
 *                         盤後 16:42
 *
 * 需要的機密設定：GITHUB_TOKEN
 *   RMSecfb 帳號的 fine-grained token，授權 MarketData、negative-news、hk-cross-border-monitor，
 *   權限 Repository permissions → Actions: Read and write。
 *
 * 網址 /check：用唯讀方式確認 token 讀得到各排程，不會觸發任何工作。
 */

const MD = "RMSecfb/MarketData";
const NN = "RMSecfb/negative-news";
const HK = "RMSecfb/hk-cross-border-monitor";

const WORKFLOWS = {
  market: { name: "市場資料", repo: MD, file: "fetch_market.yml", inputs: { respect_complete: "true" } },
  news: { name: "國際新聞", repo: MD, file: "world_news.yml", inputs: { skip_if_done: "true" } },
  negative: { name: "負面新聞", repo: NN, file: "negative-news-ai.yml", inputs: { as_schedule: "true" } },
  hkIntraday: { name: "港股盤中監控", repo: HK, file: "intraday.yml", inputs: {} },
  hkEod: { name: "港股盤後批次", repo: HK, file: "eod.yml", inputs: {} },
};

// 港股盤中時間（UTC，分鐘數）：台北／香港 10:02 10:32 11:02 11:32 12:17 13:32 14:02 14:32 15:02 15:32 16:02
const HK_INTRADAY_UTC = [
  [2, 2], [2, 32], [3, 2], [3, 32], [4, 17], [5, 32], [6, 2], [6, 32], [7, 2], [7, 32], [8, 2],
];
const HK_EOD_UTC = [8, 42]; // 台北／香港 16:42

/** 依觸發的 UTC 時間決定要跑哪些工作；星期在程式內再確認一次。 */
export function jobsFor(when) {
  const h = when.getUTCHours();
  const m = when.getUTCMinutes();
  const day = when.getUTCDay(); // 0 = 週日（UTC）
  const usWeekday = day >= 1 && day <= 5; // UTC 週一至週五 = 台北週二至週六清晨
  const jobs = [];
  if (usWeekday && ((h === 22 && (m === 7 || m === 37)) || (h === 23 && m === 7))) jobs.push(WORKFLOWS.market);
  if (h === 23 && m === 17) jobs.push(WORKFLOWS.news);
  if (h === 0 && m === 22) jobs.push(WORKFLOWS.negative);
  // 港股：UTC 週一至週五 = 香港週一至週五（盤中時段都在同一個 UTC 日）
  if (usWeekday) {
    if (HK_INTRADAY_UTC.some(([hh, mm]) => hh === h && mm === m)) jobs.push(WORKFLOWS.hkIntraday);
    if (h === HK_EOD_UTC[0] && m === HK_EOD_UTC[1]) jobs.push(WORKFLOWS.hkEod);
  }
  return jobs;
}

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "risk-scheduler",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function dispatch(env, job) {
  const path = `/repos/${job.repo}/actions/workflows/${job.file}/dispatches`;
  const body = JSON.stringify({ ref: "main", inputs: job.inputs || {} });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await gh(env, path, { method: "POST", body });
    if (res.status === 204) {
      console.log(`✅ 已觸發 ${job.name}（${job.repo} ${job.file}）`);
      return true;
    }
    console.log(`⚠ ${job.name} 第 ${attempt} 次觸發失敗：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return false;
}

export default {
  async scheduled(controller, env, ctx) {
    const when = new Date(controller.scheduledTime);
    const jobs = jobsFor(when);
    if (!jobs.length) {
      console.log(`ℹ️ ${when.toISOString()} 沒有要觸發的工作`);
      return;
    }
    if (!env.GITHUB_TOKEN) {
      console.log("❌ 尚未設定 GITHUB_TOKEN");
      return;
    }
    ctx.waitUntil(Promise.all(jobs.map((job) => dispatch(env, job))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
    if (url.pathname !== "/check") {
      return json({ service: "風險管理排程觸發器", check: "/check 可確認 token 是否讀得到各排程（不會觸發工作）" });
    }
    if (!env.GITHUB_TOKEN) return json({ ok: false, error: "尚未設定 GITHUB_TOKEN" }, 500);
    const results = await Promise.all(
      Object.values(WORKFLOWS).map(async (w) => {
        const res = await gh(env, `/repos/${w.repo}/actions/workflows/${w.file}`);
        let state = null;
        try { state = (await res.json()).state; } catch (e) { /* 非 JSON 回應 */ }
        return { name: w.name, workflow: `${w.repo}/${w.file}`, ok: res.status === 200 && state === "active", http: res.status, state };
      })
    );
    return json({ ok: results.every((r) => r.ok), results });
  },
};
