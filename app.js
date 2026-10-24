/* 風險管理中心：讀設定與市場資料 → 計算燈號 → 建監控室場景與介面 */
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RANK = { na: 0, nt: 0, ok: 1, l1: 2, l2: 3 };
  const LEVEL_TEXT = { ok: "正常", l1: "L1", l2: "L2", na: "待串接", nt: "未設門檻" };
  const LEVEL_HEX = { ok: 0x3fbf80, l1: 0xe9a23b, l2: 0xe5544c, na: 0x5b6679, nt: 0x5b6679 };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 讀資料 ---------- */
  async function loadJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }
  async function firstOk(list) {
    for (let i = 0; i < list.length; i++) {
      try { return { data: await loadJSON(list[i]), url: list[i], idx: i }; } catch (e) { /* 換下一個來源 */ }
    }
    return null;
  }

  let modules, panelsCfg;
  try {
    [modules, panelsCfg] = await Promise.all([loadJSON("config/modules.json"), loadJSON("config/panels.json")]);
  } catch (e) {
    $("#dataText").textContent = "設定檔讀取失敗，請確認 config 資料夾已部署";
    return;
  }
  const site = modules.site || {};
  const [latestR, mdCfgR, newsR] = await Promise.all([
    firstOk(site.marketSources.latest), firstOk(site.marketSources.config), firstOk(site.newsSources || []),
  ]);
  const news = newsR ? newsR.data : null;
  const latest = latestR ? latestR.data : null;
  const mdCfg = mdCfgR ? mdCfgR.data : { thresholds: {} };

  /* ---------- 燈號計算（規則與 MarketData 儀表板一致） ---------- */
  const getPath = (o, p) => (p || "").split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

  function thresholdsOf(rule) {
    if (!rule) return null;
    if (rule.thresholdKey) {
      const t = (mdCfg.thresholds || {})[rule.thresholdKey];
      return t ? { l1: t.warn, l2: t.danger, type: rule.type } : null;
    }
    if (rule.panelKey) {
      const t = (mdCfg.panel_thresholds || {})[rule.panelKey];
      return t ? { l1: t.l1, l2: t.l2, type: rule.type || t.type } : null;
    }
    return { l1: rule.l1, l2: rule.l2, type: rule.type };
  }

  function evaluate(ind) {
    const entry = latest && ind.path ? getPath(latest, ind.path) : undefined;
    if (entry == null) return { level: "na", pending: true };
    const isNum = typeof entry === "number";
    const value = isNum ? entry : entry.value;
    if (value == null) return { level: "na", pending: true };
    const thr = thresholdsOf(ind.rule);
    const rule = { type: thr && thr.type };
    let m = value, level = thr ? "ok" : "nt", prox = null;
    if (thr) {
      const { l1, l2 } = thr;
      if (rule.type === "above") {
        if (l2 != null && m >= l2) level = "l2"; else if (l1 != null && m >= l1) level = "l1";
        if (l1) prox = m / l1;
      } else if (rule.type === "below") {
        if (l2 != null && m < l2) level = "l2"; else if (l1 != null && m < l1) level = "l1";
      } else if (rule.type === "bp_rise") {
        m = entry.chg_abs != null ? entry.chg_abs * 100 : null;
        if (m != null && m > 0) {
          if (m >= l2) level = "l2"; else if (m >= l1) level = "l1";
        }
        if (m != null && l1) prox = Math.max(m, 0) / l1;
      } else if (rule.type === "pct_drop") {
        m = entry.chg_pct;
        if (m != null) { if (m <= l2) level = "l2"; else if (m <= l1) level = "l1"; }
        if (m != null && l1) prox = m < 0 ? m / l1 : 0;
      }
    }
    return {
      level, value, metric: m, prox, thr, entry,
      date: isNum ? latest.target_date : entry.date,
      stale: !isNum && entry.is_stale === true,
    };
  }

  function thrText(ind, thr) {
    const r = thr ? { type: thr.type } : null;
    if (!r || !thr) return "未設門檻";
    const a = (x) => Math.abs(x);
    const parts = [];
    if (r.type === "above") { if (thr.l1 != null) parts.push(`L1 ≥ ${thr.l1}`); if (thr.l2 != null) parts.push(`L2 ≥ ${thr.l2}`); }
    if (r.type === "below") { if (thr.l1 != null) parts.push(`L1 < ${thr.l1}`); if (thr.l2 != null) parts.push(`L2 < ${thr.l2}`); }
    if (r.type === "bp_rise") parts.push(`L1 當日升 ${thr.l1}bp`, `L2 升 ${thr.l2}bp`);
    if (r.type === "pct_drop") parts.push(`L1 當日跌 ${a(thr.l1)}%`, `L2 跌 ${a(thr.l2)}%`);
    return parts.join("・");
  }

  function fmtValue(ind, v) {
    if (v == null) return "—";
    switch (ind.format) {
      case "yield": return v.toFixed(3) + "%";
      case "bps": return v.toFixed(1) + " bp";
      case "fx": return v.toFixed(3);
      case "fx4": return v.toFixed(4);
      default: return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  function fmtChange(ind, ev) {
    if (ev.pending) return { text: "待串接", cls: "" };
    const e = ev.entry;
    if (ind.change === "bp" && e && e.chg_abs != null) {
      const bp = e.chg_abs * 100;
      return { text: (bp > 0 ? "+" : "") + bp.toFixed(1) + "bp", cls: bp > 0 ? "up" : bp < 0 ? "down" : "" };
    }
    if (ind.change === "abs_bp" && e && e.chg_abs != null) {
      const bp = e.chg_abs;
      return { text: (bp > 0 ? "+" : "") + bp.toFixed(1) + "bp", cls: bp > 0 ? "up" : bp < 0 ? "down" : "" };
    }
    if (ind.change === "pct" && e && e.chg_pct != null) {
      const p = e.chg_pct;
      return { text: (p > 0 ? "+" : "") + p.toFixed(2) + "%", cls: p > 0 ? "up" : p < 0 ? "down" : "" };
    }
    return { text: "—", cls: "" };
  }

  const panels = panelsCfg.panels.map((p) => {
    const items = p.indicators.map((ind) => ({ ind, ev: evaluate(ind) }));
    const live = items.filter((x) => !x.ev.pending);
    const judged = live.filter((x) => x.ev.level !== "nt");
    const level = judged.length ? judged.reduce((acc, x) => (RANK[x.ev.level] > RANK[acc] ? x.ev.level : acc), "ok") : live.length ? "nt" : "na";
    return { ...p, items, live: live.length, judged: judged.length, total: items.length, level, hits: live.filter((x) => x.ev.level === "l1" || x.ev.level === "l2") };
  });
  const marketLevel = panels.reduce((acc, p) => (RANK[p.level] > RANK[acc] ? p.level : acc), "na");

  /* ---------- 資料狀態 ---------- */
  const fmtTaipei = (iso) => {
    try { return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return iso; }
  };
  const chip = $("#dataChip");
  if (!latest) {
    chip.className = "chip";
    $("#dataText").textContent = "市場資料讀取失敗，燈號暫停顯示";
  } else {
    const liveSrc = latestR.idx === 0;
    chip.className = "chip " + (liveSrc ? "live" : "snap");
    const dq = latest.data_quality || {};
    $("#dataText").textContent = `${liveSrc ? "即時" : "快照資料"}・基準日 ${latest.target_date}・更新 ${fmtTaipei(latest.generated_at)}${dq.has_stale ? "・含延遲資料" : ""}`;
    chip.title = liveSrc ? "直接讀取 MarketData 最新資料" : "無法連線 MarketData，改用部署時附帶的資料快照";
  }

  /* ---------- 共用 HTML ---------- */
  function rowHTML({ ind, ev }) {
    const ch = fmtChange(ind, ev);
    const dot = ev.pending ? "" : ev.level;
    const title = `${ind.name}｜${thrText(ind, ev.thr || thresholdsOf(ind.rule))}｜${ind.source}${ev.stale ? "｜資料日期 " + ev.date + "（延遲）" : ""}`;
    return `<div class="srow ${ev.pending ? "pending" : ""}" title="${esc(title)}">
      <i class="dot ${dot}"></i><span>${esc(ind.name)}${ev.stale ? " *" : ""}</span>
      <span class="v">${esc(ev.pending ? "—" : fmtValue(ind, ev.value))}</span><span class="c ${ch.cls}">${esc(ch.text)}</span></div>`;
  }
  function panelHTML(p, cls) {
    return `<div class="${cls}" data-panel="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}指標明細">
      <div class="scol-head"><h3>${esc(p.name)}</h3><span class="lab">${esc(p.en)}</span>
        <span class="pill ${p.level}">${LEVEL_TEXT[p.level]}</span></div>
      ${p.items.map(rowHTML).join("")}</div>`;
  }
  const toolsOf = (domainId) => modules.tools.filter((t) => t.domains.includes(domainId));

  function toolHTML(t) {
    const tags = [t.market, t.type];
    if (t.status) tags.push(t.status);
    const warn = [];
    if (t.login) warn.push("需要登入");
    if (t.coldStart) warn.push("閒置後需喚醒約 30 秒");
    return `<article class="tool">
      <h3>${esc(t.name)}</h3>
      <p>${esc(t.desc)}</p>
      <div class="tags">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}${warn.map((x) => `<span class="tag warn">${esc(x)}</span>`).join("")}</div>
      ${t.updates ? `<small style="color:var(--muted)">更新：${esc(t.updates)}</small>` : ""}
      ${t.notice ? `<div class="notice">${esc(t.notice)}</div>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="open" href="${esc(t.url)}" target="_blank" rel="noopener">開啟工具 ↗</a>
        ${t.open === "embed" && site.embedTools ? `<button class="btn" data-embed="${esc(t.id)}">在此預覽</button>` : ""}
      </div></article>`;
  }

  /* ---------- 側邊面板 ---------- */
  const drawer = $("#drawer");
  let lastFocus = null;
  function openDrawer(html) {
    lastFocus = document.activeElement;
    drawer.innerHTML = html;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.focus();
    drawer.querySelector(".x").addEventListener("click", closeDrawer);
    drawer.querySelectorAll("[data-embed]").forEach((b) => b.addEventListener("click", () => embedTool(b.dataset.embed)));
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function embedTool(id) {
    const t = modules.tools.find((x) => x.id === id);
    openDrawer(`<header><div><span class="lab">預覽</span><h2>${esc(t.name)}</h2></div><button class="btn x">關閉</button></header>
      <a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">在新分頁開啟 ↗</a>
      <iframe src="${esc(t.url)}" title="${esc(t.name)}" style="width:100%;height:calc(100% - 110px);border:1px solid var(--line);border-radius:8px;margin-top:12px;background:#fff"></iframe>`);
  }
  function openDomain(id) {
    const d = modules.domains.find((x) => x.id === id);
    const tools = toolsOf(id);
    const marketLine = id === "market"
      ? `<p class="desc">大螢幕燈號：${panels.map((p) => `${esc(p.name)} <b style="color:var(--text)">${LEVEL_TEXT[p.level]}</b>`).join("・")}</p>` : "";
    openDrawer(`<header><div><span class="lab">${esc(d.en)}</span><h2>${esc(d.name)}</h2></div><button class="btn x">關閉</button></header>
      <p class="desc">${esc(d.desc)}</p>${marketLine}
      <div class="tools">${tools.length ? tools.map(toolHTML).join("") : `<div class="empty">此領域目前沒有工具。新增工具時，在 config/modules.json 加一筆即可。</div>`}</div>`);
  }
  function openPanel(pid) {
    const p = panels.find((x) => x.id === pid);
    const rows = p.items.map(({ ind, ev }) => {
      const thr = ev.thr || thresholdsOf(ind.rule);
      const val = ev.pending ? "待串接" : fmtValue(ind, ev.value);
      const when = ev.pending ? "" : `${ev.date}${ev.stale ? "（延遲）" : ""}`;
      return `<tr><td class="n"><i class="dot ${ev.pending ? "" : ev.level}"></i> ${esc(ind.name)}</td>
        <td class="num">${esc(val)}</td><td>${esc(thrText(ind, thr))}</td>
        <td>${esc(when)}${when ? "<br>" : ""}<span style="color:var(--muted)">${esc(ind.source)}</span>${ind.note ? `<br><span style="color:var(--muted)">${esc(ind.note)}</span>` : ""}</td></tr>`;
    }).join("");
    openDrawer(`<header><div><span class="lab">${esc(p.en)}</span><h2>${esc(p.name)}指標</h2></div><button class="btn x">關閉</button></header>
      <p class="desc">狀態 <b style="color:var(--text)">${LEVEL_TEXT[p.level]}</b>，${p.live}／${p.total} 項已有資料。L1 對應 MarketData 的第一警示點，L2 對應第二警示點。</p>
      <div style="overflow-x:auto"><table class="rules"><thead><tr><th>指標</th><th>最新值</th><th>門檻</th><th>資料日期／來源</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#modal").hidden) closeReport(); else if (drawer.classList.contains("open")) closeDrawer(); }
  });
  function bindPanelClicks(root) {
    root.querySelectorAll("[data-panel]").forEach((el) => {
      el.addEventListener("click", () => openPanel(el.dataset.panel));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(el.dataset.panel); } });
    });
  }

  /* ---------- 清單模式 ---------- */
  $("#lvMarkets").innerHTML = panels.map((p) => panelHTML(p, "mcol")).join("");
  bindPanelClicks($("#lvMarkets"));
  $("#lvDomains").innerHTML = modules.domains.map((d) => `<section class="dom"><span class="lab">${esc(d.en)}</span><h3>${esc(d.name)}</h3>
    <div class="tools">${toolsOf(d.id).map(toolHTML).join("") || `<div class="empty">目前沒有工具</div>`}</div></section>`).join("");
  $("#lvDomains").querySelectorAll("[data-embed]").forEach((b) => b.addEventListener("click", () => embedTool(b.dataset.embed)));

  /* ---------- 今日報告 ---------- */
  const modal = $("#modal");
  function buildReport() {
    const all = panels.flatMap((p) => p.items).filter((x) => !x.ev.pending);
    const md = (d) => { const p = String(d || "").split("-"); return p.length === 3 ? `${+p[1]}/${+p[2]}` : ""; };
    const actual = (ind, ev) => {
      const t = ev.thr && ev.thr.type;
      if (t === "bp_rise" && ev.metric != null) return (ev.metric > 0 ? "+" : "") + ev.metric.toFixed(1) + "bp";
      if (t === "pct_drop" && ev.metric != null) return (ev.metric > 0 ? "+" : "") + ev.metric.toFixed(2) + "%";
      return fmtValue(ind, ev.value);
    };
    const thrPart = (ind, ev, lv) => thrText(ind, ev.thr).split("・").find((s) => s.startsWith(lv)) || "";
    const groups = [
      { title: "已達 L2", items: all.filter((x) => x.ev.level === "l2"), lv: "L2", cls: "l2" },
      { title: "已達 L1", items: all.filter((x) => x.ev.level === "l1"), lv: "L1", cls: "l1" },
      { title: "L1 達 80%", items: all.filter((x) => x.ev.level === "ok" && x.ev.prox != null && x.ev.prox >= 0.8).sort((a, b) => b.ev.prox - a.ev.prox), lv: "L1", cls: "near80" },
    ];
    const lineHTML = (g) => ({ ind, ev }) => {
      const pct = g.cls === "near80" ? Math.max(0, Math.min(100, ev.prox * 100)) : 100;
      return `<li><span style="min-width:7.5em">${esc(ind.name)}</span><span class="bar ${g.cls}"><i style="width:${pct.toFixed(0)}%"></i></span>
        <span class="num" style="color:var(--muted)">${esc(thrPart(ind, ev, g.lv))}，<b style="color:var(--text);font-weight:500">${esc(md(ev.date))} ${esc(actual(ind, ev))}</b></span></li>`;
    };
    const shown = groups.filter((g) => g.items.length);
    const nearHTML = shown.length
      ? shown.map((g) => `<h3>${g.title}</h3><ul class="near">${g.items.map(lineHTML(g)).join("")}</ul>`).join("")
      : `<h3>L1 達 80%</h3><div class="empty">目前沒有指標達到 L1 門檻的 80%。</div>`;
    const cards = panels.map((p) => `<div class="rcard"><div class="t">${esc(p.name)}<span class="pill ${p.level}">${LEVEL_TEXT[p.level]}</span></div>
      <small>${p.live}／${p.total} 項已有資料，${p.judged} 項已設門檻</small>
      <small>${p.hits.length ? "觸發：" + p.hits.map((h) => esc(h.ind.name) + " " + LEVEL_TEXT[h.ev.level]).join("、") : p.live ? "沒有指標觸發門檻" : "尚未串接資料"}</small></div>`).join("");
    $("#report").innerHTML = `<span class="lab">DAILY MARKET REPORT</span>
      <h2 id="reportTitle">今日市場報告${latest ? `<span class="sub num">基準日 ${esc(latest.target_date)}</span>` : ""}</h2>
      ${latest ? "" : `<div class="empty">市場資料讀取失敗，以下燈號暫停顯示。</div>`}
      <div class="rcards">${cards}</div>
      ${nearHTML}
      <h3>國際重要新聞</h3>${newsHTML()}
      <footer><button class="btn" id="rpList">看工具清單</button><button class="btn gold" id="rpRoom">${sceneReady ? "進入監控室" : "關閉"}</button></footer>`;
    $("#rpList").addEventListener("click", () => { closeReport(); setView("list"); });
    $("#rpRoom").addEventListener("click", () => { closeReport(); if (sceneReady) setView("room"); });
  }
  function newsHTML() {
    if (!news) return `<div class="empty">目前無法讀取今日新聞摘要。新聞每天台北時間 07:17 產生，請稍後再看。</div>`;
    const todayTpe = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
    const old = news.date !== todayTpe ? `<div class="notice">這是 ${esc(news.date)} 的摘要，今日尚未更新。</div>` : "";
    if (news.status !== "ok" || !(news.items || []).length) {
      const why = news.status === "no_key" ? "尚未設定 Groq 金鑰，今日摘要未產生。" : (news.note || "今日摘要未產生。");
      return `${old}<div class="empty">${esc(why)}</div>`;
    }
    const meta = `AI 摘要・${esc(news.date)} ${esc(fmtTaipei(news.generated_at).split(" ").pop())} 產生・依 ${news.headline_count} 則國際新聞標題整理・內容請以原文為準`;
    return `${old}<p class="news-meta">${meta}</p><ol class="news">${news.items.map((it) => `<li>
      <div class="nh"><span class="tag">${esc(it.market_name)}</span><b>${esc(it.title)}</b></div>
      <p>${esc(it.summary)}</p>
      <div class="ns">${it.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)} ↗</a>`).join("")}</div>
    </li>`).join("")}</ol>`;
  }
  function openReport() { buildReport(); modal.hidden = false; $("#report").scrollTop = 0; $("#rpRoom").focus({ preventScroll: true }); }
  function closeReport() { modal.hidden = true; }
  modal.addEventListener("click", (e) => { if (e.target === modal) closeReport(); });
  $("#btnReport").addEventListener("click", openReport);

  /* ---------- 檢視切換 ---------- */
  const hasWebGL = (() => { try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); } catch (e) { return false; } })();
  const libsOK = !!(window.THREE && THREE.OrbitControls && THREE.CSS3DRenderer && THREE.CSS2DRenderer);
  let sceneReady = false;
  let view = "room";
  let room = null;
  function setView(v) {
    view = v;
    $("#listview").hidden = v !== "list";
    $("#btnRoom").setAttribute("aria-pressed", String(v === "room"));
    $("#btnList").setAttribute("aria-pressed", String(v === "list"));
    $("#btnReset").hidden = v !== "room";
    document.querySelector(".hint").hidden = v !== "room";
    if (v === "room" && room) room.resize();
  }
  $("#btnRoom").addEventListener("click", () => setView("room"));
  $("#btnList").addEventListener("click", () => setView("list"));

  if (hasWebGL && libsOK) {
    try { room = buildRoom(); sceneReady = true; } catch (e) { console.error(e); }
  }
  if (!sceneReady) {
    $("#btnRoom").disabled = true;
    $("#btnRoom").title = "此裝置無法顯示 3D 場景";
    setView("list");
  } else {
    setView(matchMedia("(max-width:820px)").matches ? "list" : "room");
    $("#btnReset").addEventListener("click", () => room.resetView());
  }
  openReport();

  /* ---------- 監控室場景 ---------- */
  function buildRoom() {
    const stage = $("#stage");
    const W = () => stage.clientWidth || innerWidth, H = () => stage.clientHeight || innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    stage.appendChild(renderer.domElement);

    const cssR = new THREE.CSS3DRenderer();
    cssR.setSize(W(), H());
    cssR.domElement.className = "layer";
    stage.appendChild(cssR.domElement);
    const labelR = new THREE.CSS2DRenderer();
    labelR.setSize(W(), H());
    labelR.domElement.className = "layer";
    stage.appendChild(labelR.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b12);
    scene.fog = new THREE.Fog(0x070b12, 24, 48);
    const cssScene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 200);
    const HOME = { pos: new THREE.Vector3(0, 6.3, 14.2), target: new THREE.Vector3(0, 3.0, -3.2) };
    camera.position.copy(HOME.pos);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(HOME.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 24;
    controls.minPolarAngle = 0.6;
    controls.maxPolarAngle = 1.28;
    controls.minAzimuthAngle = -0.7;
    controls.maxAzimuthAngle = 0.7;
    controls.update();

    const std = (color, rough = 0.6, metal = 0.4) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const basic = (color) => new THREE.MeshBasicMaterial({ color });
    const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

    /* 燈光：冷色環境、暖色天花燈條、螢幕藍光 */
    scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x05070a, 0.38));
    [[-6, 6.6, -3], [6, 6.6, -3], [-6, 6.6, 4], [6, 6.6, 4]].forEach(([x, y, z]) => {
      const l = new THREE.PointLight(0xffd8a8, 0.55, 18, 2); l.position.set(x, y, z); scene.add(l);
    });
    const screenGlow = new THREE.PointLight(0x5fc6dd, 1.1, 16, 2);
    screenGlow.position.set(0, 4.6, -7);
    scene.add(screenGlow);

    /* 房間 */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 34), std(0x0a0f17, 0.36, 0.6));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(40, 20, 0x1d2c44, 0x131d2c);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
    const wallMat = std(0x0b111b, 0.9, 0.2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), wallMat);
    back.position.set(0, 5, -9.2);
    scene.add(back);
    [-1, 1].forEach((s) => {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(34, 10), wallMat);
      side.position.set(13 * s, 5, 0);
      side.rotation.y = -s * Math.PI / 2;
      scene.add(side);
      scene.add(box(0.7, 10, 0.7, std(0x111a28, 0.7, 0.4), 10.4 * s, 5, -8.9));
      scene.add(box(0.05, 8.6, 0.05, basic(0x9c8460), 9.95 * s, 4.6, -8.6));
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40, 34), basic(0x05080d));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 8.2;
    scene.add(ceil);
    [-7.5, -2.6, 2.6, 7.5].forEach((x) => scene.add(box(0.12, 0.04, 13, basic(0xd8b98a), x, 8.12, -2.5)));

    /* 牆面裝飾螢幕（抽象圖形，不含數字） */
    function decoTexture(seed, kind) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 300;
      const g = c.getContext("2d");
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.fillStyle = "#06121c"; g.fillRect(0, 0, 512, 300);
      g.strokeStyle = "rgba(95,198,221,.12)"; g.lineWidth = 1;
      for (let x = 0; x < 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 300); g.stroke(); }
      for (let y = 0; y < 300; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
      if (kind === 0) {
        let y = 160; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= 512; x += 8) { y = Math.max(40, Math.min(260, y + (rnd() - 0.5) * 26)); g.lineTo(x, y); }
        g.strokeStyle = "rgba(95,198,221,.8)"; g.lineWidth = 3; g.stroke();
        g.lineTo(512, 300); g.lineTo(0, 300); g.closePath(); g.fillStyle = "rgba(95,198,221,.1)"; g.fill();
      } else if (kind === 1) {
        for (let x = 20; x < 500; x += 26) { const h = 40 + rnd() * 200; g.fillStyle = "rgba(95,198,221,.55)"; g.fillRect(x, 280 - h, 14, h); }
      } else {
        g.strokeStyle = "rgba(201,164,76,.6)"; g.lineWidth = 2;
        for (let r = 30; r <= 130; r += 25) { g.beginPath(); g.arc(256, 150, r, 0, Math.PI * 2); g.stroke(); }
        g.beginPath(); g.moveTo(256, 150); g.arc(256, 150, 130, -0.4, 0.5); g.closePath(); g.fillStyle = "rgba(201,164,76,.25)"; g.fill();
      }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    }
    [-1, 1].forEach((s) => {
      [-5, -0.6, 3.8].forEach((z, i) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.3), new THREE.MeshBasicMaterial({ map: decoTexture(7 + i * 31 + (s > 0 ? 5 : 0), (i + (s > 0 ? 1 : 0)) % 3) }));
        m.position.set(12.92 * s, 4.3, z);
        m.rotation.y = -s * Math.PI / 2;
        scene.add(m);
        const fr = box(0.08, 2.5, 4.2, std(0x182335, 0.5, 0.6), 12.97 * s, 4.3, z);
        scene.add(fr);
      });
    });

    /* 正面大螢幕：WebGL 外框＋CSS3D 真實資料面板 */
    scene.add(box(17.3, 6.7, 0.3, std(0x121b2a, 0.45, 0.7), 0, 4.9, -9.0));
    const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(16.6, 6.1), basic(0x0a1a28));
    glowPlane.position.set(0, 4.9, -8.84);
    scene.add(glowPlane);
    const screenEl = document.createElement("div");
    screenEl.className = "screen";
    screenEl.innerHTML = `<div class="screen-head"><span class="lab">Global Markets</span>
      <span class="meta">基準日 <b class="num">${latest ? esc(latest.target_date) : "—"}</b>・資料來源 MarketData・點各區看門檻定義</span></div>
      <div class="screen-cols">${panels.map((p) => panelHTML(p, "scol")).join("")}</div>`;
    bindPanelClicks(screenEl);
    const screenObj = new THREE.CSS3DObject(screenEl);
    screenObj.scale.setScalar(0.01);
    screenObj.position.set(0, 4.9, -8.82);
    cssScene.add(screenObj);

    /* 中央控制台 */
    const con = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.1), new THREE.MeshBasicMaterial({ map: decoTexture(99, 1), transparent: true, opacity: 0.85 }));
    con.rotation.x = -Math.PI / 2;
    con.position.set(0, 0.92, -5.4);
    scene.add(box(6, 0.9, 1.3, std(0x0f1724, 0.5, 0.6), 0, 0.45, -5.4));
    scene.add(con);

    /* 四張辦公桌 */
    const deskPos = {
      market: { x: -4.7, z: -2.3, r: -0.26 },
      esg: { x: 4.7, z: -2.3, r: 0.26 },
      brokerage: { x: -4.7, z: 2.8, r: -0.26 },
      ops: { x: 4.7, z: 2.8, r: 0.26 },
    };
    const deskMeshes = [];
    const desks = {};
    function makeDesk(id) {
      const lv = id === "market" ? marketLevel : null;
      const accent = lv ? LEVEL_HEX[lv] : 0xc9a44c;
      const g = new THREE.Group();
      const dark = std(0x141c29, 0.35, 0.6), chairMat = std(0x0c121c, 0.7, 0.3);
      g.add(box(3.4, 0.08, 1.5, dark, 0, 1.0, 0));
      const strip = box(3.42, 0.035, 0.035, new THREE.MeshBasicMaterial({ color: accent }), 0, 0.985, 0.76);
      strip.material.transparent = true; strip.material.opacity = lv ? 1 : 0.55;
      g.add(strip);
      [-1.65, 1.65].forEach((x) => g.add(box(0.08, 1.0, 1.4, dark, x, 0.5, 0)));
      g.add(box(3.3, 0.6, 0.05, dark, 0, 0.66, -0.7));
      const scrColor = lv && lv !== "na" ? new THREE.Color(accent).multiplyScalar(0.35) : new THREE.Color(0x123c4a);
      [-0.62, 0.62].forEach((x) => {
        g.add(box(1.15, 0.68, 0.06, std(0x0b0f16, 0.4, 0.5), x, 1.55, -0.45));
        const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.07, 0.6), new THREE.MeshBasicMaterial({ color: scrColor }));
        sc.position.set(x, 1.55, -0.415);
        g.add(sc);
        g.add(box(0.06, 0.24, 0.06, dark, x, 1.13, -0.45));
      });
      g.add(box(0.9, 0.03, 0.3, std(0x1b2534, 0.6, 0.3), 0, 1.06, 0.22));
      const chair = new THREE.Group();
      chair.add(box(0.72, 0.1, 0.66, chairMat, 0, 0.62, 0));
      chair.add(box(0.72, 0.85, 0.08, chairMat, 0, 1.1, 0.34));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 10), chairMat); pole.position.y = 0.32; chair.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 20), chairMat); base.position.y = 0.04; chair.add(base);
      chair.position.set(0.15, 0, 1.35);
      chair.rotation.y = 0.18;
      g.add(chair);
      const p = deskPos[id];
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.r;
      g.traverse((o) => { if (o.isMesh) { o.userData.domain = id; deskMeshes.push(o); } });
      scene.add(g);

      const d = modules.domains.find((x) => x.id === id);
      const n = toolsOf(id).length;
      const el = document.createElement("button");
      el.className = "desk-label";
      el.type = "button";
      el.innerHTML = `<span class="lab">${esc(d.en)}</span><b>${esc(d.name)}</b>
        <span class="meta">${lv ? `<i class="dot ${lv === "na" ? "" : lv}"></i>市場燈號 ${LEVEL_TEXT[lv]}・` : ""}${n} 項工具</span>`;
      el.addEventListener("click", () => openDomain(id));
      el.addEventListener("pointerenter", () => setHot(id, true));
      el.addEventListener("pointerleave", () => setHot(id, false));
      const lbl = new THREE.CSS2DObject(el);
      lbl.position.set(0, 2.75, 0);
      g.add(lbl);
      desks[id] = { group: g, strip, label: el, level: lv };
    }
    ["market", "esg", "brokerage", "ops"].forEach(makeDesk);

    /* 監控室人員：市場正常時慢慢走，任一指標達 L1／L2 時快步走 */
    const alert = marketLevel === "l1" || marketLevel === "l2";
    const PACE = alert ? { speed: 2.3, swing: 0.75, freq: 3.3 } : { speed: 0.85, swing: 0.4, freq: 2.6 };
    function makePerson(suit, skin) {
      const p = new THREE.Group();
      const suitM = std(suit, 0.75, 0.15), skinM = std(skin, 0.8, 0.0), shoeM = std(0x0a0c10, 0.6, 0.2);
      const limb = (w, h, d, m, x, y) => { const piv = new THREE.Group(); piv.position.set(x, y, 0); const mesh = box(w, h, d, m, 0, -h / 2, 0); piv.add(mesh); p.add(piv); return piv; };
      const legL = limb(0.15, 0.78, 0.17, suitM, -0.11, 0.8), legR = limb(0.15, 0.78, 0.17, suitM, 0.11, 0.8);
      legL.add(box(0.16, 0.06, 0.26, shoeM, 0, -0.79, 0.05)); legR.add(box(0.16, 0.06, 0.26, shoeM, 0, -0.79, 0.05));
      p.add(box(0.44, 0.62, 0.26, suitM, 0, 1.12, 0));
      p.add(box(0.12, 0.3, 0.02, std(0xd8dde6, 0.7, 0), 0, 1.26, 0.135));
      const armL = limb(0.11, 0.62, 0.13, suitM, -0.28, 1.4), armR = limb(0.11, 0.62, 0.13, suitM, 0.28, 1.4);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), skinM);
      head.position.y = 1.62; p.add(head);
      p.userData = { legL, legR, armL, armR };
      scene.add(p);
      return p;
    }
    const suits = [0x1b2638, 0x23262d, 0x1d2a3f, 0x2a2420, 0x182230, 0x262b35];
    const skins = [0xd8b39a, 0xc99a7c, 0xe2c2a8, 0xb98a6c, 0xd5ab8e, 0xe0bea0];
    const loopA = [[-1.6, 5.6], [-1.6, -3.9], [1.6, -3.9], [1.6, 5.6]];
    const loopB = [[-8.6, 6.6], [-8.6, -6.9], [8.6, -6.9], [8.6, 6.6]];
    const lineC = [[-7.8, 0.8], [7.8, 0.8], [-7.8, 0.8]];
    function pathLen(pts, closed) { let L = 0; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
    function pointAt(pts, closed, s) {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (s <= L) { const k = s / L; return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, dir: Math.atan2(b[0] - a[0], b[1] - a[1]) }; }
        s -= L;
      }
      return { x: pts[0][0], z: pts[0][1], dir: 0 };
    }
    const walkers = [
      { pts: loopB, closed: true, s0: 0.0 }, { pts: loopB, closed: true, s0: 0.5 },
      { pts: loopA, closed: true, s0: 0.2 }, { pts: lineC, closed: false, s0: 0.35 },
    ].map((w, i) => {
      const len = pathLen(w.pts, w.closed);
      return { ...w, len, s: w.s0 * len, body: makePerson(suits[i], skins[i]), yaw: null, phase: i * 1.7 };
    });
    const standers = [
      { x: 0.9, z: -4.5, yaw: Math.PI }, { x: -6.2, z: -7.9, yaw: Math.PI * 0.9 },
    ].map((s, i) => { const b = makePerson(suits[4 + i], skins[4 + i]); b.position.set(s.x, 0, s.z); b.rotation.y = s.yaw; return b; });
    walkers.forEach((w) => { const q = pointAt(w.pts, w.closed, w.s); w.body.position.set(q.x, 0, q.z); w.body.rotation.y = w.yaw = q.dir; });

    function updatePeople(dt, t) {
      if (reduceMotion) return;
      walkers.forEach((w) => {
        w.s = (w.s + PACE.speed * dt) % w.len;
        const q = pointAt(w.pts, w.closed, w.s);
        w.body.position.set(q.x, 0, q.z);
        let d = q.dir - w.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        w.yaw += d * Math.min(1, dt * 8);
        w.body.rotation.y = w.yaw;
        const ph = t * PACE.freq * Math.PI + w.phase, sw = Math.sin(ph) * PACE.swing, u = w.body.userData;
        u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8;
        w.body.position.y = Math.abs(Math.cos(ph)) * (alert ? 0.05 : 0.025);
      });
      standers.forEach((b, i) => { b.userData.armR.rotation.x = -0.9 + Math.sin(t * 0.8 + i) * 0.05; b.position.y = 0; });
    }

    let hotId = null;
    function setHot(id, on) {
      Object.entries(desks).forEach(([k, d]) => {
        const active = on && k === id;
        d.label.classList.toggle("hot", active);
        d.strip.scale.y = active ? 2.4 : 1;
        if (!d.level) d.strip.material.opacity = active ? 1 : 0.55;
      });
      hotId = on ? id : null;
      renderer.domElement.style.cursor = on ? "pointer" : "";
    }

    /* 點擊與滑過辦公桌 */
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let down = null;
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(deskMeshes, false)[0];
      return hit ? hit.object.userData.domain : null;
    };
    renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { const id = pick(e); if (id) openDomain(id); }
      down = null;
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      const id = pick(e);
      if (id !== hotId) setHot(id, !!id);
    });

    /* 視角重置 */
    let tween = null;
    function resetView() {
      if (reduceMotion) { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update(); return; }
      tween = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone() };
    }

    function resize() {
      const w = W(), h = H();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h); cssR.setSize(w, h); labelR.setSize(w, h);
    }
    addEventListener("resize", resize);

    const clock = new THREE.Clock();
    let lastNow = performance.now();
    (function loop() {
      requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      if (view !== "room") return;
      const t = clock.getElapsedTime();
      updatePeople(dt, t);
      if (tween) {
        const k = Math.min(1, (performance.now() - tween.t0) / 700), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(tween.p0, HOME.pos, e);
        controls.target.lerpVectors(tween.q0, HOME.target, e);
        if (k === 1) tween = null;
      }
      const md = desks.market;
      if (!reduceMotion && md && (md.level === "l1" || md.level === "l2")) md.strip.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2));
      controls.update();
      renderer.render(scene, camera);
      cssR.render(cssScene, camera);
      labelR.render(scene, camera);
    })();

    return { resize, resetView };
  }
})();
