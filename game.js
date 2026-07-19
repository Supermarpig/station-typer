/* 鐵路打字 — 遊戲邏輯
   核心手法：視差圖層用 Web Animations API 無限循環位移，
   打字節奏換算成 playbackRate → 列車絲滑加減速（全程只動 transform/opacity）。
   電腦對戰：AI 對手以固定 KPM（含隨機起伏）推進，同場景賽跑。
   好友對戰：一房一車次（WebSocket），對手進度由網路回報，勝負由伺服器判定；
   呈現層完全沿用電腦對戰，只換對手進度的資料來源。 */

const $ = (id) => document.getElementById(id);

const els = {
  picker: $("picker"), game: $("game"), overlay: $("overlay"),
  pickerBg: $("pickerBg"), lineGrid: $("lineGrid"), lineChip: $("lineChip"),
  modeSolo: $("modeSolo"), modeBattle: $("modeBattle"), modePk: $("modePk"), rivalRow: $("rivalRow"),
  pkSetup: $("pkSetup"), pkNick: $("pkNick"), pkJoinToggle: $("pkJoinToggle"),
  pkCodeRow: $("pkCodeRow"), pkCodeInput: $("pkCodeInput"), pkCodeGo: $("pkCodeGo"),
  pkOverlay: $("pkOverlay"), pkCard: $("pkCard"), pkToast: $("pkToast"), rematchNote: $("rematchNote"),
  mapHead: $("mapHead"), mapRoundel: $("mapRoundel"), mapNow: $("mapNow"), mapDir: $("mapDir"),
  mapView: $("mapView"),
  scene: $("scene"), sceneShake: $("sceneShake"),
  train: $("train"), rivalTrain: $("rivalTrain"), speedlines: $("speedlines"), sweep: $("sweep"),
  layerFar: $("layerFar"), layerNear: $("layerNear"), layerRail: $("layerRail"),
  leadChip: $("leadChip"),
  word: $("word"), nextPrefix: $("nextPrefix"), nextZh: $("nextZh"), nextEn: $("nextEn"), fxLayer: $("fxLayer"),
  statKpm: $("statKpm"), statAcc: $("statAcc"), statCombo: $("statCombo"),
  kmh: $("kmh"), gaugeFill: $("gaugeFill"),
  ghost: $("ghostInput"), imeWarn: $("imeWarn"), typingPanel: $("typingPanel"), typeHint: $("typeHint"),
  langEn: $("langEn"), langZh: $("langZh"), footHint: $("footHint"),
  countdown: $("countdown"),
  backBtn: $("backBtn"), retryBtn: $("retryBtn"), pickBtn: $("pickBtn"),
  muteBtn: $("muteBtn"),
  uploadRow: $("uploadRow"), nickInput: $("nickInput"), uploadBtn: $("uploadBtn"), board: $("board"),
  hbTabs: $("hbTabs"), hbList: $("hbList"),
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* kpm = 英打速度；zhKpm = 中打速度（中文選字慢，等級對應調降） */
const RIVALS = [
  { id: "local", name: "區間車", desc: "慢速巡航", kpm: 140, zhKpm: 35, color: "#4aa3ff" },
  { id: "tze", name: "自強號", desc: "穩定快攻", kpm: 300, zhKpm: 80, color: "#ff9f43" },
  { id: "taroko", name: "太魯閣號", desc: "極速狂飆", kpm: 460, zhKpm: 140, color: "#ff475f" },
];

const MAX_SPEED = 3;
const GAUGE_LEN = 88;

/* ─── 場景圖層（SVG 條帶，寬 900，重複鋪滿 + 循環位移）── */
const STRIP_W = 900;

function seededRng(seed) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function farStripSVG() {
  const rnd = seededRng(7);
  let rects = "";
  let x = 0;
  while (x < STRIP_W - 60) {
    const w = 34 + Math.floor(rnd() * 56);
    const h = 50 + Math.floor(rnd() * 110);
    if (x < 480 || x > 660) rects += `<rect x="${x}" y="${230 - h}" width="${w}" height="${h}"/>`;
    x += w + 8 + Math.floor(rnd() * 26);
  }
  // 台北 101：基座 + 八節斗形 + 尖塔
  let tower = `<rect x="534" y="168" width="34" height="62"/>`;
  for (let s = 0; s < 8; s++) {
    const yb = 168 - s * 12, yt = yb - 12;
    tower += `<path d="M537 ${yb} L565 ${yb} L561 ${yt} L541 ${yt} Z"/>`;
  }
  tower += `<rect x="544" y="62" width="14" height="10"/><rect x="549" y="30" width="4" height="32"/>`;
  return `<svg width="${STRIP_W}" height="230" viewBox="0 0 ${STRIP_W} 230" xmlns="http://www.w3.org/2000/svg" fill="#18213a">${rects}${tower}</svg>`;
}

function nearStripSVG() {
  const rnd = seededRng(23);
  const neon = ["#ffd97a", "#ffd97a", "#ffd97a", "#7ae2ff", "#ff9ecb"];
  let out = "";
  let x = 10;
  while (x < STRIP_W - 90) {
    const w = 58 + Math.floor(rnd() * 62);
    const h = 62 + Math.floor(rnd() * 92);
    const top = 190 - h;
    out += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="#212b45"/>`;
    if (rnd() < 0.3) out += `<circle cx="${x + 6}" cy="${top - 4}" r="2" fill="#ff5d5d" opacity="0.85"/>`;
    for (let wy = top + 10; wy < 178; wy += 16) {
      for (let wx = x + 8; wx < x + w - 10; wx += 15) {
        if (rnd() < 0.42) {
          const c = neon[Math.floor(rnd() * neon.length)];
          out += `<rect x="${wx}" y="${wy}" width="6" height="8" fill="${c}" opacity="${0.35 + rnd() * 0.5}"/>`;
        }
      }
    }
    x += w + 14 + Math.floor(rnd() * 40);
  }
  return `<svg width="${STRIP_W}" height="190" viewBox="0 0 ${STRIP_W} 190" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

function railStripSVG() {
  let ticks = "";
  for (let x = 0; x < STRIP_W; x += 30) ticks += `<rect x="${x}" y="30" width="12" height="4" fill="#1c2438"/>`;
  let pillars = "";
  for (let x = 40; x < STRIP_W; x += 180) {
    pillars += `<rect x="${x - 7}" y="46" width="32" height="8" fill="#2a3552"/><rect x="${x}" y="52" width="18" height="78" fill="#222c48"/>`;
  }
  // 近側（對面）股道：對戰時對手列車行駛的軌道，色調略亮表現距離較近
  let nearTicks = "";
  for (let x = 0; x < STRIP_W; x += 30) nearTicks += `<rect x="${x}" y="120" width="14" height="5" fill="#202a44"/>`;
  let nearPillars = "";
  for (let x = 130; x < STRIP_W; x += 180) {
    nearPillars += `<rect x="${x - 8}" y="136" width="36" height="9" fill="#303c5c"/><rect x="${x}" y="143" width="20" height="57" fill="#283350"/>`;
  }
  return `<svg width="${STRIP_W}" height="200" viewBox="0 0 ${STRIP_W} 200" xmlns="http://www.w3.org/2000/svg">
    ${pillars}
    <rect x="0" y="20" width="${STRIP_W}" height="26" fill="#2e3a58"/>
    <rect x="0" y="20" width="${STRIP_W}" height="4" fill="#3d4a6e"/>
    <rect x="0" y="24" width="${STRIP_W}" height="2" fill="#55648c"/>
    ${ticks}
    ${nearPillars}
    <rect x="0" y="110" width="${STRIP_W}" height="26" fill="#364464"/>
    <rect x="0" y="110" width="${STRIP_W}" height="4" fill="#48587e"/>
    <rect x="0" y="114" width="${STRIP_W}" height="2" fill="#64749e"/>
    ${nearTicks}
  </svg>`;
}

function trainSVG(stripe = "var(--line)") {
  return `<svg viewBox="0 0 300 86" xmlns="http://www.w3.org/2000/svg">
    <rect x="20" y="66" width="52" height="12" rx="4" fill="#161b26"/>
    <rect x="196" y="66" width="52" height="12" rx="4" fill="#161b26"/>
    <path d="M8 74 L8 24 Q8 10 24 10 L252 10 Q282 10 294 40 L298 58 Q300 70 288 72 L8 74 Z" fill="#e8ecf2"/>
    <path d="M8 58 L292 58 L296 66 Q298 71 290 71 L8 71 Z" fill="${stripe}"/>
    <rect x="24" y="22" width="42" height="24" rx="5" fill="#1d2c45"/>
    <rect x="76" y="22" width="42" height="24" rx="5" fill="#1d2c45"/>
    <rect x="128" y="22" width="42" height="24" rx="5" fill="#1d2c45"/>
    <rect x="180" y="22" width="42" height="24" rx="5" fill="#1d2c45"/>
    <path d="M252 14 Q276 16 288 42 L290 50 L248 50 L248 14 Z" fill="#1d2c45"/>
    <circle cx="287" cy="62" r="4" fill="#ffe9a8"/>
    <rect x="70" y="12" width="3" height="60" fill="#c9d1dd"/>
    <rect x="122" y="12" width="3" height="60" fill="#c9d1dd"/>
    <rect x="174" y="12" width="3" height="60" fill="#c9d1dd"/>
  </svg><div class="headlight"></div>`;
}

/* 各圖層基準時長（playbackRate = 1 時跑完一段 900px 的秒數） */
const LAYERS = [
  { el: null, key: "layerFar", svg: farStripSVG, dur: 90000 },
  { el: null, key: "layerNear", svg: nearStripSVG, dur: 34000 },
  { el: null, key: "layerRail", svg: railStripSVG, dur: 7000 },
];
const SPEEDLINE_DUR = 2400;

let layerAnims = [];

function buildScene() {
  layerAnims.forEach((a) => a.cancel());
  layerAnims = [];
  const copies = Math.ceil(innerWidth / STRIP_W) + 1;
  LAYERS.forEach((l) => {
    const el = els[l.key];
    el.innerHTML = Array.from({ length: copies }, l.svg).join("");
    if (!reducedMotion) {
      const anim = el.animate(
        [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(-${STRIP_W}px,0,0)` }],
        { duration: l.dur, iterations: Infinity }
      );
      anim.playbackRate = 0;
      layerAnims.push(anim);
    }
  });
  if (!reducedMotion) {
    const anim = els.speedlines.animate(
      [{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(-300px,0,0)" }],
      { duration: SPEEDLINE_DUR, iterations: Infinity }
    );
    anim.playbackRate = 0;
    layerAnims.push(anim);
  }
}
els.train.innerHTML = trainSVG();

/* ─── 遊戲狀態 ──────────────────────────────────────── */
const state = {
  line: null,
  mode: "solo",
  lang: "en",      // en=英打（拼音逐鍵） zh=中打（IME 組字後逐字比對）
  pk: false,       // 好友對戰場（mode 仍為 battle，對手進度來自網路）
  rivalDef: RIVALS[1],
  idx: 0,          // 目前所在站
  pos: 0,          // 目前單字打到第幾個字元
  correct: 0,
  errors: 0,
  combo: 0,
  maxCombo: 0,
  startTime: 0,
  keyTimes: [],
  finished: false,
  playing: false,
  cum: [],          // 各單字前的累計字元數
  totalChars: 0,
  rival: { chars: 0, idx: 0 },
  countdownTimers: [],
};

let speed = 0;
let rivalX = 0;
let frame = 0;

/* 地理路線圖狀態 */
let mapMode = "svg";   // "leaflet"：真實地圖底圖；"svg"：離線備援（純形狀）
let mapPts = [];       // 各站的 SVG 座標（真實經緯度投影）
let mapCum = [];       // 沿路線的累計長度
let mapTotalLen = 0;
let mapU = 0, mapRivalU = 0;
let mapSparse = [];    // 擁擠時隱藏部分站名
const mSvg = { fill: null, train: null, rival: null, dots: [], names: [] };
let lMap = null, lLayer = null;
let camBusyUntil = 0; // 鏡頭飛行結束時刻：飛行中投影不穩，暫停向量更新
const lRefs = { done: null, dots: [], train: null, rival: null };

/* ─── 路線選擇畫面 ──────────────────────────────────── */
const LANG_KEY = "stationTyper.lang";
const pickerState = {
  mode: "solo",
  rivalId: "tze",
  lang: localStorage.getItem(LANG_KEY) === "zh" ? "zh" : "en", // en=英打 zh=中打
};

/* 英打沿用舊 key（保留既有紀錄），中打另存 */
function bestKey(lineId, lang) {
  return `stationTyper.best.${lineId}` + (lang === "zh" ? ".zh" : "");
}

function applyLangUI() {
  const zh = pickerState.lang === "zh";
  els.langEn.classList.toggle("active", !zh);
  els.langZh.classList.toggle("active", zh);
  els.footHint.textContent = zh
    ? "用中文輸入法輸入站名・注音、拼音都可以"
    : "用鍵盤輸入站名英文拼音・請切換成英文輸入法";
}

function setLang(lang) {
  if (pickerState.lang === lang) return;
  pickerState.lang = lang;
  localStorage.setItem(LANG_KEY, lang);
  applyLangUI();
  renderRivals();   // 對手 KPM 依語言不同
  renderPicker();   // 最佳成績分語言
  loadHomeBoard();  // 排行榜分語言
}

els.langEn.addEventListener("click", () => setLang("en"));
els.langZh.addEventListener("click", () => setLang("zh"));

function renderPickerBg() {
  const copies = Math.ceil(innerWidth / STRIP_W) + 1;
  els.pickerBg.innerHTML = Array.from({ length: copies }, farStripSVG).join("");
}

function renderRivals() {
  els.rivalRow.innerHTML = "";
  RIVALS.forEach((r) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "rival-chip" + (r.id === pickerState.rivalId ? " active" : "");
    chip.style.setProperty("--rc", r.color);
    chip.innerHTML = `${r.name}<small>${r.desc}・${pickerState.lang === "zh" ? r.zhKpm : r.kpm} KPM</small>`;
    chip.addEventListener("click", () => {
      pickerState.rivalId = r.id;
      renderRivals();
    });
    els.rivalRow.appendChild(chip);
  });
}

function setMode(mode) {
  pickerState.mode = mode;
  els.modeSolo.classList.toggle("active", mode === "solo");
  els.modeBattle.classList.toggle("active", mode === "battle");
  els.modePk.classList.toggle("active", mode === "pk");
  els.rivalRow.classList.toggle("hidden", mode !== "battle");
  els.pkSetup.classList.toggle("hidden", mode !== "pk");
  if (mode === "pk" && !els.pkNick.value) {
    els.pkNick.value = localStorage.getItem(NICK_KEY) || "";
  }
}

els.modeSolo.addEventListener("click", () => setMode("solo"));
els.modeBattle.addEventListener("click", () => setMode("battle"));
els.modePk.addEventListener("click", () => setMode("pk"));

function renderPicker() {
  els.lineGrid.innerHTML = "";
  LINES.forEach((line) => {
    const first = line.stations[0].zh;
    const last = line.stations[line.stations.length - 1].zh;
    const best = JSON.parse(localStorage.getItem(bestKey(line.id, pickerState.lang)) || "null");
    const card = document.createElement("button");
    card.className = "line-card";
    card.type = "button";
    card.style.setProperty("--lc", line.color);
    card.style.setProperty("--lc-ink", line.darkText ? "#20242c" : "#ffffff");
    card.innerHTML = `
      <span class="roundel ${line.operator === "tra" ? "tra" : ""}">${line.badge}</span>
      <span class="lc-body">
        <span class="lc-name">${line.zh}</span>
        <span class="lc-meta">${first} ⇄ ${last}・${line.stations.length} 站${line.note ? "・" + line.note : ""}</span>
      </span>
      <span class="lc-best">${best ? `最佳<b>${best.score}</b>` : ""}</span>`;
    card.addEventListener("click", () => {
      if (pickerState.mode === "pk") pkCreate(line); // 好友對戰：點路線卡＝開新車次
      else startGame(line);
    });
    els.lineGrid.appendChild(card);
  });
}

/* ─── 首頁排行榜（選線畫面下方，可切換路線）────────── */
const hbState = { line: "BL" };

function initHomeBoard() {
  els.hbTabs.innerHTML = "";
  LINES.forEach((line) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "hb-tab" + (line.id === hbState.line ? " active" : "");
    tab.style.setProperty("--lc", line.color);
    tab.textContent = line.zh;
    tab.addEventListener("click", () => {
      hbState.line = line.id;
      initHomeBoard();
    });
    els.hbTabs.appendChild(tab);
  });
  loadHomeBoard();
}

async function loadHomeBoard() {
  els.hbList.innerHTML = `<div class="board-hint">載入中…</div>`;
  try {
    const rows = await fetch(`/api/scores?line=${encodeURIComponent(hbState.line)}&lang=${pickerState.lang}`).then((r) => r.json());
    if (!Array.isArray(rows) || !rows.length) {
      els.hbList.innerHTML = `<div class="board-hint">這條線還沒有紀錄，搶頭香！</div>`;
      return;
    }
    els.hbList.innerHTML = rows.map((r, i) =>
      `<div class="board-row${i === 0 ? " top1" : ""}">
        <b>${i + 1}</b><span class="b-name">${esc(r.name)}</span>
        <span class="b-kpm">${r.kpm | 0} KPM</span><span class="b-score">${r.score | 0}</span>
      </div>`
    ).join("");
  } catch {
    els.hbList.innerHTML = `<div class="board-hint">排行榜載入失敗</div>`;
  }
}

/* ─── 遊戲畫面 ──────────────────────────────────────── */
function startGame(line, pkRace) {
  state.line = line;
  state.pk = !!pkRace; // 好友對戰：呈現層沿用 battle，對手進度來自網路
  state.mode = state.pk ? "battle" : pickerState.mode;
  state.lang = state.pk ? pk.lang : pickerState.lang; // 好友對戰跟隨車次設定
  state.rivalDef = state.pk
    ? { id: "pk", name: pk.oppName || "對手", kpm: 0, color: "#ff475f" }
    : RIVALS.find((r) => r.id === pickerState.rivalId) || RIVALS[1];
  state.idx = 0;
  state.pos = 0;
  state.correct = 0;
  state.errors = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.startTime = 0;
  state.keyTimes = [];
  state.finished = false;
  state.playing = false;
  state.rival = { chars: 0, idx: 0 };
  state.countdownTimers.forEach(clearTimeout);
  state.countdownTimers = [];
  speed = 0;
  rivalX = 0;

  // 累計字元數（用於賽況換算）— 起點站也要打（發車確認），所以包含全部站名
  const words = line.stations.map(stationWord);
  state.cum = [0];
  words.forEach((w, i) => state.cum.push(state.cum[i] + w.length));
  state.totalChars = state.cum[state.cum.length - 1];

  document.documentElement.style.setProperty("--line", line.color);
  document.documentElement.style.setProperty("--line-ink", line.darkText ? "#20242c" : "#ffffff");

  els.picker.classList.add("hidden");
  els.overlay.classList.add("hidden");
  els.game.classList.remove("hidden");

  els.lineChip.innerHTML = `
    <span class="roundel ${line.operator === "tra" ? "tra" : ""}"
          style="--lc:${line.color};--lc-ink:${line.darkText ? "#20242c" : "#fff"}">${line.badge}</span>
    <span>${line.zh}${state.lang === "zh" ? "・中打" : ""}</span>`;

  const zhMode = state.lang === "zh";
  els.word.classList.toggle("zh", zhMode);
  els.ghost.classList.toggle("zh", zhMode); // 中打：輸入框現形在面板內，組字選字看得見
  els.ghost.placeholder = zhMode ? "在這裡輸入站名" : "";
  els.typeHint.textContent = zhMode
    ? "用中文輸入法逐字或整串輸入・選錯的字會以紅字飄出"
    : "直接開始打字，空格可省略";

  const battle = state.mode === "battle";
  els.rivalTrain.classList.toggle("hidden", !battle);
  els.leadChip.classList.toggle("hidden", !battle);
  if (battle) {
    els.rivalTrain.innerHTML = trainSVG("#94a3b8") + `<div class="nametag">${state.rivalDef.name}</div>`;
    els.rivalTrain.style.transform = "translate3d(0,0,0)";
    els.leadChip.textContent = "並駕齊驅";
    els.leadChip.classList.remove("behind");
  }

  els.rematchNote.classList.add("hidden");
  els.retryBtn.disabled = false;

  buildScene();
  buildMap();
  updateMapHead(false);
  renderWord();
  updateStats();

  if (state.pk) {
    // 與對手對齊伺服器起跑時刻（倒數序列從 3 到起跑共 PK_COUNTDOWN_LEAD ms）
    const delay = Math.max(0, pk.playAt - Date.now() - PK_COUNTDOWN_LEAD);
    if (!reducedMotion) {
      state.countdownTimers.push(setTimeout(runCountdown, delay));
    } else {
      state.countdownTimers.push(setTimeout(() => {
        state.playing = true;
        state.startTime = performance.now();
        focusGhost();
      }, Math.max(0, pk.playAt - Date.now())));
    }
  } else if (!reducedMotion) {
    runCountdown(); // 單人與對戰都倒數 3-2-1-GO
  } else {
    state.playing = true;
    focusGhost();
  }
}

function runCountdown() {
  const seq = ["3", "2", "1", "GO"];
  els.countdown.classList.remove("hidden");
  seq.forEach((txt, i) => {
    state.countdownTimers.push(setTimeout(() => {
      els.countdown.textContent = txt;
      els.countdown.classList.remove("tick");
      void els.countdown.offsetWidth;
      els.countdown.classList.add("tick");
      SFX.count(txt === "GO");
      if (txt === "GO") {
        state.countdownTimers.push(setTimeout(() => {
          els.countdown.classList.add("hidden");
          state.playing = true;
          state.startTime = performance.now(); // 計時從 GO 開始
          focusGhost();
        }, 500));
      }
    }, i * 700));
  });
}

/* state.idx = 已完成的站名字數：打完第 k 個字 = 抵達第 k 站。
   第 0 個字是起點站名（發車確認，列車原地不動），之後每個字前進一站。 */
function station(i) { return state.line.stations[i]; }
function atStation() { return Math.min(Math.max(state.idx - 1, 0), state.line.stations.length - 1); }
function targetStation() { return station(Math.min(state.idx, state.line.stations.length - 1)); }
function stationWord(s) { return state.lang === "zh" ? s.zhTyping : s.typing; }
function targetWord() { return stationWord(targetStation()); }
function rivalKpmVal() { return state.lang === "zh" ? state.rivalDef.zhKpm : state.rivalDef.kpm; }
function playerChars() { return state.cum[state.idx] + state.pos; }

/* ─── 地理路線圖（真實經緯度）──────────────────────── */
function buildMap() {
  if (ensureLeaflet()) buildLeafletMap();
  else buildMapSVG();
}

function ensureLeaflet() {
  if (!window.L) return false;
  if (!lMap) {
    els.mapView.innerHTML = "";
    els.mapView.classList.add("leaflet-mode");
    lMap = L.map(els.mapView, {
      zoomControl: false,
      keyboard: false,
      zoomSnap: 0.25,
      zoomAnimation: !reducedMotion, // 抵站時鏡頭飛往下一段需要縮放動畫
      fadeAnimation: false,
      markerZoomAnimation: !reducedMotion,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(lMap);
    lMap.attributionControl.setPrefix(false);
  }
  return true;
}

function buildLeafletMap() {
  mapMode = "leaflet";
  mapPts = [];
  const sts = state.line.stations;
  const latlngs = sts.map((s) => s.pos);
  if (lLayer) lLayer.remove();
  lLayer = L.layerGroup().addTo(lMap);

  L.polyline(latlngs, { color: "#ffffff", opacity: 0.28, weight: 9 }).addTo(lLayer); // 白色襯底
  L.polyline(latlngs, { color: "#aebadd", opacity: 0.85, weight: 4.5 }).addTo(lLayer);
  lRefs.done = L.polyline([latlngs[0]], { color: state.line.color, weight: 6, opacity: 1 }).addTo(lLayer);

  lRefs.dots = latlngs.map((p) =>
    L.circleMarker(p, { radius: 5, weight: 2.5, color: "#dfe6f5", fillColor: "#0b0f1a", fillOpacity: 1 }).addTo(lLayer)
  );

  const trainIcon = L.divIcon({
    className: "m-train-icon",
    html: `<div class="chip" style="--c:${state.line.color}"></div>`,
    iconSize: [20, 14],
    iconAnchor: [10, 7],
  });
  lRefs.train = L.marker(latlngs[0], { icon: trainIcon, interactive: false, zIndexOffset: 1000 }).addTo(lLayer);

  if (state.mode === "battle") {
    const rivalIcon = L.divIcon({
      className: "m-train-icon rival",
      html: `<div class="chip" style="--c:var(--rival)"></div>`,
      iconSize: [16, 11],
      iconAnchor: [8, 5.5],
    });
    lRefs.rival = L.marker(latlngs[0], { icon: rivalIcon, interactive: false, zIndexOffset: 900 }).addTo(lLayer);
  } else {
    lRefs.rival = null;
  }

  // 畫面剛從 hidden 顯示，需重算尺寸再取景
  // （用 setTimeout 而非 rAF：背景分頁的 rAF 會被暫停）
  setTimeout(() => {
    lMap.invalidateSize({ animate: false });
    focusMapCam(false);
  }, 30);

  mapU = playerUnits();
  mapRivalU = 0;
  updateMapDots();
}

/* 跟車鏡頭：只框住當前站與下一站（終點時框最後一段），抵站時平滑飛往下一段 */
function focusMapCam(animate) {
  if (mapMode !== "leaflet" || !lMap || !state.line) return;
  const sts = state.line.stations;
  const i = Math.min(atStation(), sts.length - 2);
  const bounds = L.latLngBounds([sts[i].pos, sts[i + 1].pos]);
  const opts = { padding: [36, 36], maxZoom: 15.5 };
  if (animate && !reducedMotion) {
    camBusyUntil = performance.now() + 1250; // 飛行 1.1s + 緩衝
    lMap.flyToBounds(bounds, { ...opts, duration: 1.1 });
  } else {
    camBusyUntil = 0;
    lMap.fitBounds(bounds, { ...opts, animate: false });
  }
}

function latLngAt(u) {
  const sts = state.line.stations;
  const c = Math.max(0, Math.min(u, sts.length - 1));
  const i = Math.min(Math.floor(c), sts.length - 2);
  const t = c - i;
  const a = sts[i].pos, b = sts[i + 1].pos;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function buildMapSVG() {
  mapMode = "svg";
  const sts = state.line.stations;
  const n = sts.length;
  const W = Math.max(320, els.mapView.clientWidth || 960);

  // 經緯度 → 平面（經度乘上緯度餘弦修正比例）
  const raw = sts.map((s) => ({
    x: s.pos[1] * Math.cos((s.pos[0] * Math.PI) / 180),
    y: -s.pos[0],
  }));
  // 以起訖站連線為主軸旋轉（純旋轉、不鏡射 → 形狀保真，起點在左）
  const a = raw[0], b = raw[n - 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const rot = raw.map((p) => ({
    x: (p.x - a.x) * cos - (p.y - a.y) * sin,
    y: (p.x - a.x) * sin + (p.y - a.y) * cos,
  }));
  // 等比縮放置中
  const xs = rot.map((p) => p.x), ys = rot.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bw = Math.max(Math.max(...xs) - minX, 1e-9);
  const bh = Math.max(Math.max(...ys) - minY, 1e-9);
  const padX = 52, padTop = 26, padBot = 72;
  const maxContentH = Math.min(200, W * 0.4);
  const scale = Math.min((W - padX * 2) / bw, maxContentH / bh);
  const offX = (W - bw * scale) / 2;
  const viewH = bh * scale + padTop + padBot;
  mapPts = rot.map((p) => ({
    x: offX + (p.x - minX) * scale,
    y: padTop + (p.y - minY) * scale,
  }));

  // 沿線累計長度（列車位置與進度填色用）
  mapCum = [0];
  for (let i = 1; i < n; i++) {
    mapCum.push(mapCum[i - 1] + Math.hypot(mapPts[i].x - mapPts[i - 1].x, mapPts[i].y - mapPts[i - 1].y));
  }
  mapTotalLen = mapCum[n - 1];

  // 依實際間距決定站名顯示：離上一個顯示的站名太近就隱藏
  // （起訖站必顯示；當前站與下一站在 updateMapDots 裡永遠顯示）
  mapSparse = new Array(n).fill(false);
  let lastKept = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(mapPts[i].x - mapPts[lastKept].x, mapPts[i].y - mapPts[lastKept].y);
    if (d < 24 && i !== n - 1) mapSparse[i] = true;
    else lastKept = i;
  }

  const d = mapPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const dots = mapPts
    .map((p) => `<circle class="m-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5"/>`)
    .join("");
  const names = mapPts
    .map((p, i) => {
      const tx = (p.x + 5).toFixed(1), ty = (p.y + 14).toFixed(1);
      return `<text class="m-name" x="${tx}" y="${ty}" transform="rotate(42 ${tx} ${ty})">${sts[i].zh}</text>`;
    })
    .join("");

  els.mapView.innerHTML = `
    <svg viewBox="0 0 ${W} ${viewH.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">
      <path class="m-line" d="${d}"/>
      <path class="m-fill" id="mFill" d="${d}" stroke-dasharray="${mapTotalLen.toFixed(1)}" stroke-dashoffset="${mapTotalLen.toFixed(1)}"/>
      <g id="mDots">${dots}</g>
      <g id="mNames">${names}</g>
      <g id="mRival" class="m-train rival${state.mode === "battle" ? "" : " hidden"}">
        <rect x="-7" y="-5.5" width="14" height="11" rx="3.5" fill="var(--rival)" stroke="#fff" stroke-width="1.5"/>
        <rect x="-4" y="-2.5" width="8" height="4" rx="1.5" fill="#0b0f1a"/>
      </g>
      <g id="mTrain" class="m-train">
        <rect x="-9" y="-7" width="18" height="14" rx="4.5" fill="${state.line.color}" stroke="#fff" stroke-width="2"/>
        <rect x="-5" y="-3" width="10" height="4.5" rx="1.5" fill="#0b0f1a"/>
      </g>
    </svg>`;

  mSvg.fill = $("mFill");
  mSvg.train = $("mTrain");
  mSvg.rival = $("mRival");
  mSvg.dots = [...els.mapView.querySelectorAll(".m-dot")];
  mSvg.names = [...els.mapView.querySelectorAll(".m-name")];
  mapU = playerUnits();
  mapRivalU = 0;
  positionMapMarkers();
  updateMapDots();
}

function mapPointAt(u) {
  const n = mapPts.length;
  const c = Math.max(0, Math.min(u, n - 1));
  const i = Math.min(Math.floor(c), n - 2);
  const t = c - i;
  return {
    x: mapPts[i].x + (mapPts[i + 1].x - mapPts[i].x) * t,
    y: mapPts[i].y + (mapPts[i + 1].y - mapPts[i].y) * t,
    len: mapCum[i] + (mapCum[i + 1] - mapCum[i]) * t,
  };
}

function positionMapMarkers() {
  if (!mapPts.length) return;
  const p = mapPointAt(mapU);
  mSvg.train.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
  mSvg.fill.setAttribute("stroke-dashoffset", Math.max(0, mapTotalLen - p.len).toFixed(1));
  if (state.mode === "battle") {
    const r = mapPointAt(mapRivalU);
    mSvg.rival.setAttribute("transform", `translate(${r.x.toFixed(1)} ${r.y.toFixed(1)})`);
  }
}

function playerUnits() {
  const n = state.line.stations.length;
  if (state.idx === 0) return 0; // 還在打起點站：原地待發
  if (state.idx >= n) return n - 1;
  return state.idx - 1 + state.pos / targetWord().length;
}

function rivalUnits() {
  const n = state.line.stations.length;
  const i = state.rival.idx;
  if (i === 0) return 0;
  if (i >= n) return n - 1;
  const wLen = state.cum[i + 1] - state.cum[i] || 1;
  return Math.min(i - 1 + (state.rival.chars - state.cum[i]) / wLen, n - 1);
}

function updateMapHead(animate) {
  const line = state.line;
  const n = line.stations.length;
  const cur = station(atStation());
  els.mapRoundel.textContent = cur.code || line.badge;
  els.mapRoundel.classList.toggle("tra", line.operator === "tra");
  els.mapNow.textContent = cur.zh;
  els.mapDir.textContent =
    state.idx === 0 ? "準備發車 DEPART" :
    state.idx >= n ? "終點站 TERMINAL" :
    `往 ${station(state.idx).zh} ▶`;
  updateMapDots();
  focusMapCam(animate);
  if (animate && !reducedMotion) {
    els.mapHead.classList.remove("arrive");
    void els.mapHead.offsetWidth;
    els.mapHead.classList.add("arrive");
    els.sweep.classList.remove("go");
    void els.sweep.offsetWidth;
    els.sweep.classList.add("go");
  }
}

function updateMapDots() {
  const nAll = state.line.stations.length;
  const cur = atStation();                       // 列車目前所在站
  const nxt = Math.min(state.idx, nAll - 1);     // 正在打的目標站
  if (mapMode === "leaflet") {
    if (!lRefs.dots.length) return;
    const sts = state.line.stations;
    lRefs.dots.forEach((c, i) => {
      const done = i < cur, now = i === cur;
      c.setStyle({
        color: now ? "#ffffff" : done ? state.line.color : "#dfe6f5",
        fillColor: now ? "#ffffff" : done ? state.line.color : "#0b0f1a",
      });
      c.setRadius(now ? 7 : 5);
      const perm = i === 0 || i === nAll - 1 || i === cur || i === nxt;
      c.unbindTooltip();
      c.bindTooltip(sts[i].zh, {
        permanent: perm,
        direction: "top",
        offset: [0, -6],
        className: "m-tip" + (i === cur ? " now" : i === nxt ? " next" : ""),
      });
    });
    return;
  }
  mSvg.dots.forEach((d, i) => {
    d.setAttribute("class", "m-dot" + (i < cur ? " done" : i === cur ? " now" : ""));
  });
  mSvg.names.forEach((nm, i) => {
    const stateCls = i < cur ? " done" : i === cur ? " now" : i === nxt ? " next" : "";
    const hide = mapSparse[i] && i !== cur && i !== nxt ? " off" : "";
    nm.setAttribute("class", "m-name" + stateCls + hide);
  });
}

function updateLeadChip() {
  const diff = state.idx - state.rival.idx;
  els.leadChip.classList.toggle("behind", diff < 0);
  els.leadChip.textContent =
    diff > 0 ? `領先 ${diff} 站` : diff < 0 ? `落後 ${-diff} 站` : "並駕齊驅";
}

function renderWord() {
  if (state.finished) return;
  const next = targetStation();
  els.nextPrefix.textContent = state.idx === 0 ? "起點站" : "下一站";
  els.nextZh.textContent = next.zh;
  els.nextEn.textContent = next.en;
  const w = targetWord();
  els.word.innerHTML = [...w]
    .map((ch, i) => {
      const cls = ["ch"];
      if (ch === " ") cls.push("sp");
      if (i < state.pos) cls.push("done");
      else if (i === state.pos) cls.push("cur");
      return `<span class="${cls.join(" ")}">${ch === " " ? "&nbsp;" : ch}</span>`;
    })
    .join("");
}

function updateStats() {
  const mins = state.startTime ? (performance.now() - state.startTime) / 60000 : 0;
  const kpm = mins > 0.005 ? Math.round(state.correct / mins) : 0;
  const total = state.correct + state.errors;
  const acc = total ? Math.round((state.correct / total) * 100) : 100;
  els.statKpm.textContent = kpm;
  els.statAcc.textContent = acc + "%";
  els.statCombo.textContent = state.combo;
}

/* ─── 特效 ──────────────────────────────────────────── */
function spawnSpark(x, y, dx, dy) {
  if (reducedMotion || els.fxLayer.childElementCount > 16) return;
  const s = document.createElement("span");
  s.className = "spark";
  s.style.left = x + "px";
  s.style.top = y + "px";
  s.style.setProperty("--dx", dx + "px");
  s.style.setProperty("--dy", dy + "px");
  s.addEventListener("animationend", () => s.remove());
  els.fxLayer.appendChild(s);
}

function caretSpark() {
  const chEls = els.word.querySelectorAll(".ch");
  const el = chEls[Math.max(0, state.pos - 1)];
  if (!el) return;
  const fx = els.fxLayer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  spawnSpark(r.left + r.width / 2 - fx.left, r.top - fx.top, (Math.random() - 0.5) * 22, -20 - Math.random() * 16);
}

function wordBurst() {
  const fx = els.fxLayer.getBoundingClientRect();
  const r = els.word.getBoundingClientRect();
  const cx = r.left + r.width / 2 - fx.left;
  const cy = r.top + r.height / 2 - fx.top;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    spawnSpark(cx, cy, Math.cos(a) * 44, Math.sin(a) * 34 - 10);
  }
}

function comboFloat(text) {
  if (reducedMotion) return;
  const f = document.createElement("span");
  f.className = "combo-float";
  f.textContent = text;
  f.style.left = "50%";
  f.style.top = "18px";
  f.addEventListener("animationend", () => f.remove());
  els.fxLayer.appendChild(f);
}

/* 中打選錯字：把送出的錯字紅字飄出（例如目標「坪」卻送出「平」） */
function wrongFloat(ch) {
  if (reducedMotion) return;
  const f = document.createElement("span");
  f.className = "combo-float err";
  f.textContent = ch;
  f.style.left = "50%";
  f.style.top = "34px";
  f.addEventListener("animationend", () => f.remove());
  els.fxLayer.appendChild(f);
}

/* ─── 打字處理 ──────────────────────────────────────── */
let imeWarnTimer = 0;
function showImeWarn(text) {
  els.imeWarn.textContent = text;
  els.imeWarn.classList.remove("hidden");
  clearTimeout(imeWarnTimer);
  imeWarnTimer = setTimeout(() => els.imeWarn.classList.add("hidden"), 2200);
}

let zhHintAt = 0;
function zhImeHint() {
  if (performance.now() - zhHintAt < 3000) return;
  zhHintAt = performance.now();
  showImeWarn("中打模式 — 請切換成中文輸入法");
}

function handleChar(ch) {
  if (!state.playing || state.finished || ch.length !== 1) return;
  const zh = state.lang === "zh";
  if (zh) {
    if (/\s/.test(ch)) return;
    if (/[０-９]/.test(ch)) ch = String.fromCharCode(ch.charCodeAt(0) - 0xfee0); // 全形數字→半形（台北101）
    if (/[a-z]/i.test(ch)) { zhImeHint(); return; } // 字母出現 = 沒開中文輸入法：提示但不計誤擊
  } else {
    ch = ch.toLowerCase();
    if (!/[a-z0-9 ]/.test(ch)) return;
  }

  if (!state.startTime) state.startTime = performance.now();
  const w = targetWord();
  const expected = w[state.pos];

  let ok = false;
  if (ch === expected) {
    state.pos += 1;
    ok = true;
  } else if (!zh && expected === " " && ch === w[state.pos + 1]) {
    state.pos += 2; // 漏打空格但字母正確 → 寬容處理
    ok = true;
  }

  if (ok) {
    state.correct += 1;
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.keyTimes.push(performance.now());
    pkSendProgress(false); // 好友對戰：節流回報進度
    SFX.tick(state.combo);
    if (state.combo > 0 && state.combo % 25 === 0) {
      popStat(els.statCombo);
      comboFloat(`×${state.combo} COMBO`);
      SFX.comboUp();
    }
    if (state.pos >= w.length) {
      wordBurst();
      arrive();
    } else {
      renderWord();
      caretSpark();
    }
  } else {
    state.errors += 1;
    state.combo = 0;
    if (zh) wrongFloat(ch); // 玩家看不到 IME 送出的字，飄出來才知道錯在哪
    flashError();
    SFX.error();
  }
  updateStats();
}

/* 中打進字：IME 常一次送出整串；整詞重打時，已完成的前段不重複計誤 */
function feedZh(text) {
  if (!text || !state.playing || state.finished) return;
  const done = targetWord().slice(0, state.pos);
  if (state.pos > 0 && text.length > 1) {
    if (done.startsWith(text)) return; // 只重打了已完成的部分：不計誤也不前進
    if (text.startsWith(done)) text = text.slice(done.length);
  }
  [...text].forEach(handleChar);
}

function popStat(el) {
  const stat = el.closest(".stat");
  stat.classList.remove("pop");
  void stat.offsetWidth;
  stat.classList.add("pop");
}

function flashError() {
  els.typingPanel.classList.remove("shake");
  els.word.classList.remove("err-flash");
  void els.typingPanel.offsetWidth;
  els.typingPanel.classList.add("shake");
  els.word.classList.add("err-flash");
  setTimeout(() => els.word.classList.remove("err-flash"), 240);
}

function arrive() {
  state.idx += 1;
  state.pos = 0;
  pkSendProgress(true); // 抵站即回報（含衝線的最終進度）
  updateMapHead(true);
  if (state.mode === "battle") updateLeadChip();
  if (state.idx >= state.line.stations.length) {
    if (state.pk) {
      state.playing = false; // 衝線：鎖輸入，等伺服器 end 訊息判定勝負
    } else {
      finish(true);
    }
  } else {
    SFX.chime();
    renderWord();
  }
}

/* ─── 成績上傳與排行榜 ──────────────────────────────── */
const NICK_KEY = "stationTyper.nick";
let lastRun = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadBoard(lineId, lang) {
  els.board.innerHTML = `<div class="board-hint">排行榜載入中…</div>`;
  try {
    const rows = await fetch(`/api/scores?line=${encodeURIComponent(lineId)}&lang=${lang}`).then((r) => r.json());
    if (!Array.isArray(rows) || !rows.length) {
      els.board.innerHTML = `<div class="board-hint">這條線還沒有紀錄，搶頭香！</div>`;
      return;
    }
    els.board.innerHTML =
      `<div class="board-title">路線排行榜 TOP ${rows.length}・${lang === "zh" ? "中打" : "英打"}</div>` +
      rows.map((r, i) =>
        `<div class="board-row${i === 0 ? " top1" : ""}">
          <b>${i + 1}</b><span class="b-name">${esc(r.name)}</span>
          <span class="b-kpm">${r.kpm | 0} KPM</span><span class="b-score">${r.score | 0}</span>
        </div>`
      ).join("");
  } catch {
    els.board.innerHTML = `<div class="board-hint">排行榜載入失敗</div>`;
  }
}

async function uploadScore() {
  const name = els.nickInput.value.trim();
  if (!name) { els.nickInput.focus(); return; }
  if (!lastRun) return;
  localStorage.setItem(NICK_KEY, name);
  els.uploadBtn.disabled = true;
  els.uploadBtn.textContent = "上傳中…";
  try {
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ...lastRun }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "upload failed");
    els.uploadBtn.textContent = `已上傳 ✓ 第 ${data.rank} 名`;
    loadBoard(lastRun.lineId, lastRun.lang);
  } catch {
    els.uploadBtn.disabled = false;
    els.uploadBtn.textContent = "失敗，再試一次";
  }
}

/* ─── 好友對戰（車次房間）───────────────────────────── */
/* 詞彙：房間=車次、開房者=列車長、加入=上車、開始=發車。
   流程：列車長點路線卡開車次 → 分享 ?room=1234 連結 → 隊友上車 → 發車 →
   伺服器廣播 startAt，雙方對齊倒數 → 進度互報 → 伺服器判定勝負 → 可再戰。 */
const PK_COUNTDOWN_LEAD = 2600; // runCountdown 從「3」到起跑的總時長（4 拍 × 700ms − 700 + 500）
const PK_SEND_MS = 150;         // 進度回報節流間隔

const pk = {
  ws: null, role: null, code: null, hostKey: null,
  line: null, lang: "en", myName: "", oppName: "",
  state: "idle",      // idle | waiting | racing | done
  oppChars: 0,        // 對手最後回報的累計字元數
  playAt: 0,          // 本地時鐘的起跑時刻（由伺服器 startAt 校正時差而來）
  lastSend: 0, sendTimer: 0,
  closing: false,     // 自己主動離開，close 事件不當斷線處理
  oppWants: false,    // 對手已按再戰
  oppGone: false,     // 對手已離開，再戰無望
  rematchSent: false,
};

function cleanNick(v) { return String(v ?? "").trim().replace(/[<>]/g, "").slice(0, 12); }

function showPkToast(text, info) {
  els.pkToast.textContent = text;
  els.pkToast.classList.toggle("info", !!info);
  els.pkToast.classList.remove("hidden");
  clearTimeout(showPkToast.timer);
  showPkToast.timer = setTimeout(() => els.pkToast.classList.add("hidden"), 2800);
}

function setLineTheme(line) {
  document.documentElement.style.setProperty("--line", line.color);
  document.documentElement.style.setProperty("--line-ink", line.darkText ? "#20242c" : "#ffffff");
}

/* 列車長：點路線卡 → 開新車次（打字語言跟隨選單設定，全車一致） */
async function pkCreate(line) {
  const name = cleanNick(els.pkNick.value);
  if (!name) { els.pkNick.focus(); return; }
  localStorage.setItem(NICK_KEY, name);
  const lang = pickerState.lang;
  const totalChars = line.stations.reduce((n, s) => n + (lang === "zh" ? s.zhTyping : s.typing).length, 0);
  try {
    const res = await fetch("/api/room", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineId: line.id, name, totalChars, lang }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    pk.role = "host";
    pk.code = data.code;
    pk.hostKey = data.hostKey;
    pk.myName = name;
    pk.line = line;
    pk.lang = lang;
    setLineTheme(line);
    pkConnect();
  } catch {
    showPkToast("開車次失敗，請稍後再試");
  }
}

/* 隊友：開邀請連結（或輸入車次號）→ 乘車邀請卡 */
async function pkShowJoin(code) {
  els.pkOverlay.classList.remove("hidden");
  els.pkCard.classList.remove("expired");
  els.pkCard.innerHTML = `<p class="result-eyebrow">乘車邀請 INVITE</p><p class="guest-wait">查詢車次中…</p>`;
  try {
    const res = await fetch(`/api/room/${code}`);
    if (!res.ok) throw 0;
    const info = await res.json();
    const line = LINES.find((l) => l.id === info.lineId);
    if (!line || info.state !== "waiting") throw 0;
    if (info.full) {
      renderPkExpired("這班車已滿員。<br />向隊友要一班新的車次吧。");
      return;
    }
    renderPkJoin(code, info, line);
  } catch {
    renderPkExpired();
  }
}

function lineRoundel(line) {
  return `<span class="roundel ${line.operator === "tra" ? "tra" : ""}"
    style="--lc:${line.color};--lc-ink:${line.darkText ? "#20242c" : "#fff"}">${line.badge}</span>`;
}

function renderPkJoin(code, info, line) {
  setLineTheme(line);
  const nick = localStorage.getItem(NICK_KEY) || "";
  const zh = info.lang === "zh"; // 打字語言由列車長開車次時決定
  els.pkCard.innerHTML = `
    <p class="result-eyebrow">乘車邀請 INVITE</p>
    <div class="train-no"><small>車次 TRAIN</small>${code}</div>
    <div class="card-lineinfo">${lineRoundel(line)}<span>${line.zh}・${line.stations.length} 站・${zh ? "中打" : "英打"}</span></div>
    <p class="pk-invite-line"><b>${esc(info.hostName)}</b> 邀請你來一場站名${zh ? "中打" : "英打"}對決</p>
    <input class="ti wide" id="pkJoinNick" type="text" maxlength="12" placeholder="輸入暱稱"
           autocomplete="off" value="${esc(nick)}" />
    <button class="primary-btn" id="pkJoinGo" type="button">上車</button>
    <p class="card-foot">${zh ? "需要中文輸入法" : "需要英文鍵盤"}・約 3–5 分鐘一局</p>`;
  const board = () => {
    const nickV = cleanNick($("pkJoinNick").value);
    if (!nickV) { $("pkJoinNick").focus(); return; }
    localStorage.setItem(NICK_KEY, nickV);
    pk.role = "guest";
    pk.code = code;
    pk.hostKey = null;
    pk.myName = nickV;
    pk.line = line;
    pk.lang = zh ? "zh" : "en";
    pkConnect();
  };
  $("pkJoinGo").addEventListener("click", board);
  $("pkJoinNick").addEventListener("keydown", (e) => { if (e.key === "Enter") board(); });
}

function renderPkExpired(html) {
  els.pkOverlay.classList.remove("hidden");
  els.pkCard.classList.add("expired");
  els.pkCard.innerHTML = `
    <p class="result-eyebrow">乘車邀請 INVITE</p>
    <div class="train-no"><small>車次 TRAIN</small>－－－－</div>
    <p class="pk-invite-line">${html || "查無此車次，可能已發車。<br />向隊友要一條新的邀請連結吧。"}</p>
    <button class="primary-btn" id="pkErrHome" type="button">回首頁自己開一班</button>`;
  $("pkErrHome").addEventListener("click", () => {
    pkLeave();
    setMode("pk");
  });
}

function pkConnect() {
  pk.closing = false;
  pk.oppWants = pk.oppGone = false;
  pk.rematchSent = false;
  pk.oppChars = 0;
  pk.state = "waiting";
  els.pkOverlay.classList.remove("hidden");
  els.pkCard.classList.remove("expired");
  els.pkCard.innerHTML = `<p class="result-eyebrow">月台 PLATFORM</p><p class="guest-wait">連線中…</p>`;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ name: pk.myName });
  if (pk.hostKey) q.set("key", pk.hostKey);
  const ws = new WebSocket(`${proto}://${location.host}/api/room/${pk.code}/ws?${q}`);
  pk.ws = ws;
  ws.addEventListener("message", (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    pkHandle(msg);
  });
  ws.addEventListener("close", () => { if (pk.ws === ws) pkClosed(); });
  history.replaceState(null, "", location.pathname); // 清掉 ?room=，避免重整重複入房
}

function pkHandle(msg) {
  if (msg.t === "room") {
    pk.oppName = pk.role === "host" ? (msg.guest ? msg.guest.name : "") : msg.host.name;
    if (pk.state === "waiting") renderPkRoom(msg);
    return;
  }
  if (msg.t === "start") { // 發車（首戰或再戰都走這裡）
    pk.playAt = msg.startAt - (msg.now - Date.now()); // 用伺服器時間差校正本地起跑時刻
    pk.state = "racing";
    pk.oppChars = 0;
    pk.oppWants = false;
    pk.rematchSent = false;
    els.pkOverlay.classList.add("hidden");
    els.overlay.classList.add("hidden");
    startGame(pk.line, true);
    return;
  }
  if (msg.t === "p") { pk.oppChars = msg.c; return; }
  if (msg.t === "end") {
    if (pk.state !== "racing") return;
    pk.state = "done";
    const won = msg.winner === pk.role;
    if (msg.reason === "forfeit") {
      pk.oppGone = true;
      showPkToast("對手已下車 — 你獲勝！");
    } else if (!won) {
      pk.oppChars = state.totalChars; // 對手衝線，畫面同步到終點
    }
    if (!state.finished) finish(won);
    return;
  }
  if (msg.t === "rematch") {
    pk.oppWants = true;
    els.rematchNote.classList.remove("hidden");
    return;
  }
  if (msg.t === "gone") { // 結算後對手離開：再戰無望
    pk.oppGone = true;
    els.rematchNote.classList.add("hidden");
    els.retryBtn.textContent = "對手已離開";
    els.retryBtn.disabled = true;
    return;
  }
  if (msg.t === "expired") {
    pk.closing = true; // 伺服器隨後會關閉連線，不當斷線處理
    if (pk.state === "waiting") {
      renderPkExpired(pk.role === "guest"
        ? "列車長已離開，車次取消。"
        : "車次逾時未發車，已自動取消。");
    }
    pk.state = "idle";
  }
}

function renderPkRoom(msg) {
  const line = pk.line;
  const isHost = pk.role === "host";
  const guest = msg.guest;
  const link = `${location.origin}/?room=${pk.code}`;
  const first = line.stations[0].zh;
  const last = line.stations[line.stations.length - 1].zh;

  els.pkCard.innerHTML = `
    <p class="result-eyebrow">月台 PLATFORM</p>
    <div class="train-no"><small>車次 TRAIN</small>${pk.code}</div>
    <div class="card-lineinfo">${lineRoundel(line)}<span>${line.zh}・${first} ⇄ ${last}・${line.stations.length} 站・${pk.lang === "zh" ? "中打" : "英打"}</span></div>
    <div class="platform">
      <div class="track">
        <span class="train-chip"></span>
        <span class="track-body">
          <span class="track-name">${esc(msg.host.name)}${isHost ? "（你）" : ""} <span class="role">列車長</span></span>
          <span class="track-status aboard">已上車</span>
        </span>
      </div>
      <div class="track rival ${guest ? "arrive" : "empty"}">
        <span class="train-chip"></span>
        <span class="track-body">
          <span class="track-name">${guest ? esc(guest.name) + (isHost ? "" : "（你）") : "虛位以待"}</span>
          <span class="track-status ${guest ? "aboard" : ""}">${guest ? "已上車" : "等待上車…"}</span>
        </span>
      </div>
    </div>
    ${isHost ? `
      <div class="invite-row">
        <input class="ti" id="pkLink" type="text" readonly value="${esc(link)}" aria-label="邀請連結" />
        <button class="ghost-btn" id="pkCopy" type="button">複製邀請連結</button>
      </div>
      <button class="primary-btn" id="pkDepart" type="button" ${guest ? "" : "disabled"}>
        ${guest ? "發車" : "等待隊友上車…"}
      </button>`
    : `<p class="guest-wait">等待列車長發車…</p>`}
    <button class="ghost-btn wide" id="pkLeaveBtn" type="button">${isHost ? "取消車次" : "下車離開"}</button>
    <p class="card-foot">車次開出前 10 分鐘內有效，逾時自動取消</p>`;

  const copyBtn = $("pkCopy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        $("pkLink").select();
        document.execCommand("copy");
      }
      copyBtn.textContent = "已複製！";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "複製邀請連結";
        copyBtn.classList.remove("copied");
      }, 1500);
    });
  }
  const departBtn = $("pkDepart");
  if (departBtn) {
    departBtn.addEventListener("click", () => {
      if (pk.ws && pk.ws.readyState === 1) pk.ws.send(JSON.stringify({ t: "depart" }));
    });
  }
  $("pkLeaveBtn").addEventListener("click", pkLeave);
}

/* 進度回報：累計值制（掉包不歪），節流 + 抵站強制送出 */
function pkSendProgress(flush) {
  if (!state.pk || pk.state !== "racing" || !pk.ws || pk.ws.readyState !== 1) return;
  const send = () => {
    pk.lastSend = performance.now();
    pk.sendTimer = 0;
    if (pk.ws && pk.ws.readyState === 1) {
      pk.ws.send(JSON.stringify({ t: "p", c: playerChars() }));
    }
  };
  const since = performance.now() - pk.lastSend;
  if (flush || since >= PK_SEND_MS) {
    clearTimeout(pk.sendTimer);
    send();
  } else if (!pk.sendTimer) {
    pk.sendTimer = setTimeout(send, PK_SEND_MS - since);
  }
}

function pkRematch() {
  if (pk.oppGone || pk.rematchSent || !pk.ws || pk.ws.readyState !== 1) return;
  pk.rematchSent = true;
  pk.ws.send(JSON.stringify({ t: "rematch" }));
  els.retryBtn.disabled = true;
  els.retryBtn.textContent = "等待對手…";
}

function pkLeave() {
  clearTimeout(pk.sendTimer);
  pk.sendTimer = 0;
  if (pk.ws) {
    pk.closing = true;
    try { pk.ws.close(1000); } catch {}
  }
  pk.ws = null;
  pk.state = "idle";
  pk.oppChars = 0;
  els.pkOverlay.classList.add("hidden");
}

function pkClosed() {
  const was = pk.state;
  pk.ws = null;
  if (pk.closing) return; // 自己離開或伺服器已宣告 expired
  if (was === "racing" && !state.finished) {
    pk.state = "idle";
    showPkToast("連線中斷，對戰中止");
    backToPicker();
    return;
  }
  if (was === "waiting") {
    pk.state = "idle";
    renderPkExpired("連線中斷。<br />請回首頁重新開一班。");
    return;
  }
  if (was === "done" && !pk.oppGone) { // 結算畫面掛著時斷線：鎖住再戰
    pk.oppGone = true;
    els.rematchNote.classList.add("hidden");
    els.retryBtn.textContent = "連線已中斷";
    els.retryBtn.disabled = true;
  }
}

/* ─── 結算 ──────────────────────────────────────────── */
function finish(playerWon) {
  state.finished = true;
  state.playing = false;
  const elapsed = state.startTime ? (performance.now() - state.startTime) / 1000 : 0;
  const mins = elapsed / 60;
  const kpm = mins > 0 ? Math.round(state.correct / mins) : 0;
  const total = state.correct + state.errors;
  const acc = total ? Math.round((state.correct / total) * 100) : 100;
  const score = Math.max(0, state.correct * 10 + state.maxCombo * 5 - state.errors * 3);

  // 本場原始數據（上傳用；分數由伺服器重算）。對戰落敗未完賽，不開放上傳
  lastRun = {
    lineId: state.line.id,
    mode: state.mode,
    lang: state.lang,
    correct: state.correct,
    errors: state.errors,
    maxCombo: state.maxCombo,
    timeMs: Math.round(elapsed * 1000),
  };
  // 未達伺服器門檻（correct < 10）的場次不開放上傳（例如對手秒退的棄賽勝）
  const canUpload = !!state.startTime && state.correct >= 10 && (state.mode === "solo" || playerWon);
  els.uploadRow.classList.toggle("hidden", !canUpload);
  els.uploadBtn.disabled = false;
  els.uploadBtn.textContent = "上傳成績";
  els.nickInput.value = localStorage.getItem(NICK_KEY) || "";
  loadBoard(state.line.id, state.lang);

  if (state.mode === "battle") playerWon ? SFX.win() : SFX.lose();
  else SFX.terminal();

  const h2 = $("resultStation");
  h2.classList.remove("lose");

  if (state.mode === "battle") {
    $("resultEyebrow").textContent = "對戰結果 RESULT";
    h2.textContent = playerWon ? "勝利！" : "敗北⋯";
    h2.classList.toggle("lose", !playerWon);
    const kpmTag = state.pk ? "" : `（${rivalKpmVal()} KPM）`; // 真人對手不標 KPM
    $("resultLine").textContent = playerWon
      ? `你在${state.line.zh}甩開了 ${state.rivalDef.name}${kpmTag}`
      : `被 ${state.rivalDef.name} 搶先抵達${station(state.line.stations.length - 1).zh}`;
  } else {
    $("resultEyebrow").textContent = "終點站 TERMINAL";
    h2.textContent = station(atStation()).zh;
    $("resultLine").textContent = `${state.line.zh}全線 ${state.line.stations.length} 站完乘`;
  }

  $("rTime").textContent = !state.startTime ? "—"
    : elapsed >= 60
      ? `${Math.floor(elapsed / 60)}:${String(Math.round(elapsed % 60)).padStart(2, "0")}`
      : `${elapsed.toFixed(1)}s`;
  $("rKpm").textContent = kpm;
  $("rAcc").textContent = acc + "%";
  $("rCombo").textContent = state.maxCombo;
  $("rScore").textContent = score;

  let isBest = false;
  if (state.mode === "solo") {
    const prevBest = JSON.parse(localStorage.getItem(bestKey(state.line.id, state.lang)) || "null");
    isBest = !prevBest || score > prevBest.score;
    if (isBest) localStorage.setItem(bestKey(state.line.id, state.lang), JSON.stringify({ score, kpm, acc }));
  }
  $("rBest").classList.toggle("hidden", !isBest);

  // 好友對戰：再跑一次 → 再戰一場（雙方都按才重新發車）
  els.retryBtn.disabled = state.pk && pk.oppGone;
  els.retryBtn.textContent = state.pk ? (pk.oppGone ? "對手已離開" : "再戰一場") : "再跑一次";
  els.rematchNote.classList.toggle("hidden", !(state.pk && pk.oppWants));

  setTimeout(() => els.overlay.classList.remove("hidden"), 650);
}

/* ─── 主迴圈：速度引擎 + 對手 + 儀表 + 鏡頭 ─────────── */
let lastT = performance.now();

function tick(now) {
  const dt = Math.min(now - lastT, 100);
  lastT = now;
  frame++;

  // 玩家速度：近兩秒擊鍵頻率 → playbackRate
  if (state.playing || state.finished) {
    state.keyTimes = state.keyTimes.filter((t) => now - t < 2000);
    const cps = state.keyTimes.length / 2;
    const fullCps = state.lang === "zh" ? 2.2 : 6; // 滿速門檻：中文選字節奏比英打慢
    const target = state.playing && state.startTime ? 0.18 + Math.min(cps / fullCps, 1) * (MAX_SPEED - 0.2) : 0;
    speed += (target - speed) * 0.06;
  } else {
    speed += (0 - speed) * 0.05;
  }
  layerAnims.forEach((a) => (a.playbackRate = speed));
  els.speedlines.style.opacity = Math.max(0, ((speed - 1.7) / 1.3) * 0.6).toFixed(3);

  // 對手推進
  if (state.mode === "battle" && state.playing && !state.finished) {
    if (state.pk) {
      // 真人對手：朝最後收到的累計進度平滑逼近；勝負由伺服器 end 訊息判定
      state.rival.chars += (pk.oppChars - state.rival.chars) * Math.min(1, dt / 160);
    } else {
      const jitter = 0.82 + 0.36 * (0.5 + 0.5 * Math.sin(now / 2300 + 1.3));
      state.rival.chars += (rivalKpmVal() / 60) * (dt / 1000) * jitter;
    }
    while (state.rival.idx < state.cum.length - 1 && state.rival.chars >= state.cum[state.rival.idx + 1]) {
      state.rival.idx += 1;
    }
    if (!state.pk && state.rival.chars >= state.totalChars) {
      state.rival.chars = state.totalChars;
      updateLeadChip();
      finish(false);
    }
    // 對手列車相對位置（領先在前、落後在後）
    // 差距超過 30 字（約三站）就加速駛出畫面外，直到再次接近才會回來
    const delta = state.rival.chars - playerChars();
    let targetX;
    if (delta > 30) targetX = innerWidth * 1.2;
    else if (delta < -30) targetX = -innerWidth * 0.9;
    else targetX = delta * 9;
    rivalX += (targetX - rivalX) * 0.04;
    els.rivalTrain.style.transform = `translate3d(${rivalX.toFixed(1)}px,0,0)`;
    if (frame % 10 === 0) updateLeadChip();
  }

  // 地理路線圖：列車沿真實路徑滑動
  if (state.line) {
    mapU += (playerUnits() - mapU) * 0.12;
    if (state.mode === "battle") mapRivalU += (rivalUnits() - mapRivalU) * 0.12;
    if (mapMode === "leaflet" && lRefs.train) {
      // 鏡頭飛行中不動向量：飛行時中途 setLatLng 會投影到過渡座標系，線與列車看起來亂跑
      if (performance.now() >= camBusyUntil) {
        const p = latLngAt(mapU);
        lRefs.train.setLatLng(p);
        if (frame % 3 === 0) {
          const done = state.line.stations.slice(0, Math.floor(mapU) + 1).map((s) => s.pos);
          done.push(p);
          lRefs.done.setLatLngs(done);
        }
        if (lRefs.rival) lRefs.rival.setLatLng(latLngAt(mapRivalU));
      }
    } else if (mapMode === "svg" && mapPts.length) {
      positionMapMarkers();
    }
  }

  // 儀表板 + 引擎聲
  if (frame % 4 === 0) {
    els.gaugeFill.style.strokeDashoffset = (GAUGE_LEN * (1 - Math.min(speed / MAX_SPEED, 1))).toFixed(1);
    els.kmh.textContent = Math.round((speed / MAX_SPEED) * 130);
    SFX.setSpeed(speed);
  }

  // 高速時：鏡頭微震 + 車身前傾
  if (!reducedMotion) {
    if (speed > 2.2) {
      const amp = (speed - 2.2) * 2.4;
      const t = now / 60;
      els.sceneShake.style.transform = `translate3d(${(Math.sin(t * 1.7) * amp * 0.5).toFixed(2)}px, ${(Math.cos(t * 2.3) * amp).toFixed(2)}px, 0)`;
    } else if (els.sceneShake.style.transform) {
      els.sceneShake.style.transform = "";
    }
    if (frame % 6 === 0) {
      els.train.style.setProperty("--lean", `${(-speed * 1.1).toFixed(2)}deg`);
    }
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ─── 輸入接線（桌機鍵盤 + 行動裝置隱形輸入框 + IME 提醒）─ */
function focusGhost() {
  els.ghost.value = "";
  els.ghost.focus({ preventScroll: true });
}

let composeEndAt = 0;

els.ghost.addEventListener("input", (e) => {
  if (e.isComposing) return;
  // 中打：選字結果已在 compositionend 處理；有些瀏覽器（Firefox）事件順序相反，
  // compositionend 後緊接的 input 帶同一段字串，不能重複計
  if (state.lang === "zh" && performance.now() - composeEndAt < 80) {
    els.ghost.value = "";
    return;
  }
  const data = e.data || els.ghost.value;
  els.ghost.value = "";
  if (!data) return;
  if (state.lang === "zh") feedZh(data);
  else [...data].forEach(handleChar);
});

els.ghost.addEventListener("compositionstart", () => {
  if (state.lang === "zh") return; // 中打模式：IME 組字是正常流程
  showImeWarn("偵測到中文輸入法 — 請切換成英數模式");
  els.ghost.blur();
  setTimeout(focusGhost, 2200);
});

els.ghost.addEventListener("compositionend", (e) => {
  if (state.lang !== "zh") return;
  composeEndAt = performance.now();
  els.ghost.value = "";
  feedZh(e.data || "");
});

document.addEventListener("keydown", (e) => {
  if (els.game.classList.contains("hidden")) return;
  if (!els.overlay.classList.contains("hidden")) return; // 結算畫面輸入暱稱時不搶焦點
  SFX.unlock(); // 瀏覽器需在使用者手勢後才允許發聲
  if (e.isComposing || e.keyCode === 229) return; // IME 組字中：空白鍵選字等按鍵全交給輸入法
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === " ") e.preventDefault(); // 避免頁面捲動
  if (document.activeElement !== els.ghost) {
    focusGhost();
    handleChar(e.key);
  }
});

document.addEventListener("click", () => {
  SFX.unlock();
  // 已聚焦就不重聚焦：focusGhost 會清空輸入框，組字中誤點頁面不能把組字打斷
  if (!els.game.classList.contains("hidden") && state.playing && document.activeElement !== els.ghost) {
    focusGhost();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) state.keyTimes = [];
});

let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!els.game.classList.contains("hidden")) {
      buildScene();
      if (mapMode === "leaflet" && lMap) {
        lMap.invalidateSize();
        focusMapCam(false);
      } else buildMap();
    } else {
      renderPickerBg();
    }
  }, 250);
});

/* ─── 導覽按鈕 ──────────────────────────────────────── */
function backToPicker() {
  pkLeave(); // 好友對戰中離場＝下車（對戰中會被判棄賽）
  state.playing = false;
  state.finished = true;
  state.countdownTimers.forEach(clearTimeout);
  els.countdown.classList.add("hidden");
  els.game.classList.add("hidden");
  els.overlay.classList.add("hidden");
  els.picker.classList.remove("hidden");
  renderPicker(); // 更新最佳成績
  loadHomeBoard(); // 排行榜可能有新成績
}

els.backBtn.addEventListener("click", backToPicker);
els.pickBtn.addEventListener("click", backToPicker);
els.retryBtn.addEventListener("click", () => {
  if (state.pk) pkRematch();
  else startGame(state.line);
});
els.uploadBtn.addEventListener("click", uploadScore);
els.nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") uploadScore();
});

els.muteBtn.classList.toggle("muted", SFX.muted);
els.muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.muteBtn.classList.toggle("muted", SFX.toggle());
});

/* 好友對戰：輸入車次號加入 */
els.pkJoinToggle.addEventListener("click", () => {
  els.pkCodeRow.classList.toggle("hidden");
  if (!els.pkCodeRow.classList.contains("hidden")) els.pkCodeInput.focus();
});
function pkGoByCode() {
  const code = els.pkCodeInput.value.trim();
  if (!/^\d{4}$/.test(code)) { els.pkCodeInput.focus(); return; }
  pkShowJoin(code);
}
els.pkCodeGo.addEventListener("click", pkGoByCode);
els.pkCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") pkGoByCode(); });

applyLangUI(); // 語言偏好記在 localStorage，先套用再渲染
renderPicker();
renderRivals();
renderPickerBg();
initHomeBoard();
setMode("solo");

/* 邀請連結入口：?room=1234 直接開乘車邀請卡 */
{
  const roomCode = new URLSearchParams(location.search).get("room");
  if (roomCode && /^\d{4}$/.test(roomCode)) {
    setMode("pk");
    pkShowJoin(roomCode);
  }
}
