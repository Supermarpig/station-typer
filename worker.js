/* 成績上傳 API + 好友對戰房間 — 靜態檔案由 Workers Assets 處理，
   只有對不到資產的路徑（/api/*）才會進到這裡。
   防護原則：前端只傳原始數據，分數一律由伺服器重算；外加合理性檢查與同 IP 限流。
   房間（車次）：一房一 Durable Object，WebSocket Hibernation，勝負由伺服器判定。 */

import { DurableObject } from "cloudflare:workers";

const LINE_IDS = new Set(["BL", "R", "G", "O", "BR", "Y", "TRA-W", "TRA-WC", "TRA-WL", "TRA-E"]);
const TOP_N = 10;
const RATE_LIMIT = 5; // 同 IP 每分鐘最多上傳次數

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const cleanName = (v) => String(v ?? "").trim().replace(/[<>]/g, "").slice(0, 12);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/scores") {
      if (req.method === "GET") return getScores(url, env);
      if (req.method === "POST") return postScore(req, env);
      return json({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/api/room") {
      if (req.method === "POST") return createRoom(req, env);
      return json({ error: "method not allowed" }, 405);
    }
    const m = url.pathname.match(/^\/api\/room\/(\d{4})(\/ws)?$/);
    if (m) {
      const stub = env.ROOM.getByName(`room:${m[1]}`);
      if (m[2]) return stub.fetch(req); // WebSocket 升級交給 DO 處理
      if (req.method === "GET") {
        const info = await stub.info();
        return info ? json(info) : json({ error: "no such room" }, 404);
      }
      return json({ error: "method not allowed" }, 405);
    }

    return json({ error: "not found" }, 404);
  },
};

/* ─── 好友對戰：開新車次 ────────────────────────────── */
async function createRoom(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad json" }, 400);

  const name = cleanName(b.name);
  if (!name) return json({ error: "bad name" }, 400);
  if (!LINE_IDS.has(b.lineId)) return json({ error: "bad line" }, 400);
  const lang = b.lang === "zh" ? "zh" : "en"; // 打字語言由列車長決定，全車一致
  const totalChars = b.totalChars | 0; // 由靜態站名資料算出，雙端一致；僅作合理性界定
  if (totalChars < 20 || totalChars > 3000) return json({ error: "bad stats" }, 400);

  const hostKey = crypto.randomUUID(); // 列車長憑證：連線時識別身分
  for (let i = 0; i < 8; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const stub = env.ROOM.getByName(`room:${code}`);
    const ok = await stub.create({ code, lineId: b.lineId, lang, totalChars, hostName: name, hostKey });
    if (ok) return json({ ok: true, code, hostKey });
  }
  return json({ error: "busy" }, 503); // 連撞 8 次車次號：活躍房間已近上限
}

/* ─── Room DO：一個車次一個實例 ─────────────────────── */
const WAIT_TTL = 10 * 60_000;    // 未發車的車次壽命
const RACE_TTL = 40 * 60_000;    // 單場對戰時間上限
const REMATCH_TTL = 15 * 60_000; // 結算後等待再戰的窗口
const FINISH_WAIT_TTL = 5 * 60_000; // 先完賽者最多等對手這麼久，逾時直接結算
const COUNTDOWN_MS = 3500;       // 發車廣播 → 正式起跑（前端倒數序列需 2600ms）
const MAX_CPS = 25;              // 進度合理上限（1500 KPM，超出人類極限）
const EMOJI_SET = new Set(["😏", "🐢", "💨", "🍿", "💪", "🔥"]); // 等待期間可丟的表情
const EMOJI_COOLDOWN = 800;      // 表情冷卻（毫秒），防洗版

const other = (role) => (role === "host" ? "guest" : "host");

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 進度只放記憶體 + 連線附件：休眠甦醒時由附件還原，不寫 storage
    this.progress = { host: 0, guest: 0 };
    this.lastEmoji = { host: 0, guest: 0 }; // 表情冷卻計時（重啟歸零無妨）
    for (const ws of ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att) this.progress[att.role] = att.chars || 0;
    }
  }

  /* 車次號被 worker 隨機挑中時建房；已有活躍房間則回 false 讓 worker 換號重試 */
  async create(init) {
    if (await this.ctx.storage.get("meta")) return false;
    await this.ctx.storage.put("meta", {
      ...init,
      state: "waiting", // waiting → racing → done（可再戰回 racing）
      guestName: null,
      startAt: 0,
      firstFinish: null, // 先衝線的角色：勝負已定，但等雙方都完賽才結算
      rematch: { host: false, guest: false },
      createdAt: Date.now(),
    });
    await this.ctx.storage.setAlarm(Date.now() + WAIT_TTL);
    return true;
  }

  /* 乘車邀請卡用：隊友開連結時先看房間資訊 */
  async info() {
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return null;
    return {
      code: meta.code,
      lineId: meta.lineId,
      lang: meta.lang || "en",
      hostName: meta.hostName,
      state: meta.state,
      full: this.ctx.getWebSockets("guest").length > 0,
    };
  }

  /* WebSocket 升級：?key= 對得上是列車長，否則當隊友上車 */
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return new Response("no such room", { status: 404 });

    const url = new URL(req.url);
    const name = cleanName(url.searchParams.get("name"));
    const key = url.searchParams.get("key") || "";

    let role;
    if (key && key === meta.hostKey) {
      role = "host";
    } else {
      if (meta.state !== "waiting") return new Response("departed", { status: 409 });
      if (this.ctx.getWebSockets("guest").length) return new Response("full", { status: 409 });
      if (!name) return new Response("bad name", { status: 400 });
      role = "guest";
    }

    // 同角色重連（例如列車長重整頁面）：舊連線先請下車，不觸發離場邏輯
    for (const old of this.ctx.getWebSockets(role)) old.close(4000, "replaced");

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment({
      role,
      name: role === "host" ? meta.hostName : name,
      chars: this.progress[role],
    });

    if (role === "guest" && meta.guestName !== name) {
      meta.guestName = name;
      await this.ctx.storage.put("meta", meta);
    }
    this.broadcast(this.roomMsg(meta));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    if (!att) return;
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;

    // 進度回報：{t:"p", c:累計正確字元數}。累計值制，掉包不歪；成長速度由伺服器封頂
    if (msg.t === "p" && meta.state === "racing") {
      const elapsed = (Date.now() - meta.startAt) / 1000;
      if (elapsed < 0) return;
      const cap = Math.min(meta.totalChars, Math.ceil(elapsed * MAX_CPS));
      const chars = Math.max(this.progress[att.role], Math.min(msg.c | 0, cap));
      this.progress[att.role] = chars;
      ws.serializeAttachment({ ...att, chars });
      this.sendTo(other(att.role), { t: "p", c: chars });

      // 先到終點者勝（以伺服器收到的順序為準），但先不結算：
      // 廣播 fin 讓先完賽者進入觀戰等待，等另一人也完賽（或逾時/離場）才一起結算
      if (chars >= meta.totalChars && att.role !== meta.firstFinish) {
        if (!meta.firstFinish) {
          meta.firstFinish = att.role;
          await this.ctx.storage.put("meta", meta);
          await this.ctx.storage.setAlarm(Date.now() + FINISH_WAIT_TTL);
          this.broadcast({ t: "fin", role: att.role });
        } else {
          await this.settle(meta, meta.firstFinish, "finished");
        }
      }
      return;
    }

    // 先完賽者不想等了：提前結算（勝負早已定，對手的賽程就此打住）
    if (msg.t === "settle" && meta.state === "racing" && meta.firstFinish === att.role) {
      await this.settle(meta, meta.firstFinish, "called");
      return;
    }

    // 等待期間丟表情（嘲諷/加油）：只有已完賽者能丟，白名單 + 冷卻防洗版
    if (msg.t === "e" && meta.state === "racing" && EMOJI_SET.has(msg.e)) {
      if (meta.firstFinish !== att.role) return;
      const now = Date.now();
      if (now - this.lastEmoji[att.role] < EMOJI_COOLDOWN) return;
      this.lastEmoji[att.role] = now;
      this.sendTo(other(att.role), { t: "e", e: msg.e });
      return;
    }

    if (msg.t === "depart" && att.role === "host" && meta.state === "waiting") {
      if (!this.ctx.getWebSockets("guest").length) return; // 隊友還沒上車
      await this.startRace(meta);
      return;
    }

    if (msg.t === "rematch" && meta.state === "done") {
      meta.rematch[att.role] = true;
      const bothOn =
        this.ctx.getWebSockets("host").length && this.ctx.getWebSockets("guest").length;
      if (meta.rematch.host && meta.rematch.guest && bothOn) {
        await this.startRace(meta);
      } else {
        await this.ctx.storage.put("meta", meta);
        this.sendTo(other(att.role), { t: "rematch" });
      }
    }
  }

  async webSocketClose(ws, code) {
    if (code === 4000) return; // 被同角色的新連線取代，不是真的離開
    const att = ws.deserializeAttachment();
    if (!att) return;
    const meta = await this.ctx.storage.get("meta");
    if (!meta) return;

    if (meta.state === "racing") {
      // 對戰中斷線：未完賽者離開 = 棄賽；已完賽者（等待中）離開 = 直接結算，勝負不變
      const winner = meta.firstFinish || other(att.role);
      const reason = att.role === meta.firstFinish ? "finished" : "forfeit";
      await this.settle(meta, winner, reason);
      this.sendTo(other(att.role), { t: "gone" }); // 離開者不會回來，再戰無望
    } else if (meta.state === "waiting") {
      if (att.role === "guest") {
        meta.guestName = null;
        await this.ctx.storage.put("meta", meta);
        this.broadcast(this.roomMsg(meta));
      } else {
        // 列車長離開 → 車次取消
        this.broadcast({ t: "expired" });
        await this.cleanup();
      }
    } else if (meta.state === "done") {
      this.sendTo(other(att.role), { t: "gone" }); // 再戰無望，前端鎖住再戰鈕
    }
  }

  webSocketError() { /* 錯誤後 runtime 會再觸發 webSocketClose，離場邏輯統一在那裡 */ }

  /* 結算：勝負早在先衝線時就定了，這裡才廣播 end 讓雙方一起看結果 */
  async settle(meta, winner, reason) {
    meta.state = "done";
    meta.firstFinish = null;
    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.setAlarm(Date.now() + REMATCH_TTL);
    this.broadcast({ t: "end", winner, reason });
  }

  async startRace(meta) {
    meta.state = "racing";
    meta.startAt = Date.now() + COUNTDOWN_MS;
    meta.firstFinish = null;
    meta.rematch = { host: false, guest: false };
    this.progress = { host: 0, guest: 0 };
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att) ws.serializeAttachment({ ...att, chars: 0 });
    }
    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.setAlarm(meta.startAt + RACE_TTL);
    // 兩端用 (startAt - now) 對齊本地倒數，時鐘偏移互相抵銷
    this.broadcast({ t: "start", startAt: meta.startAt, now: Date.now() });
  }

  async alarm() {
    // 先完賽者等待逾時：對手拖太久，直接結算（勝負不變）；其餘情況照舊過期清房
    const meta = await this.ctx.storage.get("meta");
    if (meta && meta.state === "racing" && meta.firstFinish) {
      await this.settle(meta, meta.firstFinish, "timeout");
      return;
    }
    this.broadcast({ t: "expired" });
    await this.cleanup();
  }

  async cleanup() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, "room closed"); } catch {}
    }
    await this.ctx.storage.deleteAll(); // 清空後車次號即可重複使用
    await this.ctx.storage.deleteAlarm();
  }

  roomMsg(meta) {
    return {
      t: "room",
      state: meta.state,
      lineId: meta.lineId,
      code: meta.code,
      host: { name: meta.hostName, on: this.ctx.getWebSockets("host").length > 0 },
      guest: this.ctx.getWebSockets("guest").length ? { name: meta.guestName } : null,
    };
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch {}
    }
  }

  sendTo(role, msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(role)) {
      try { ws.send(s); } catch {}
    }
  }
}

async function getScores(url, env) {
  const line = url.searchParams.get("line");
  if (!LINE_IDS.has(line)) return json({ error: "bad line" }, 400);
  const lang = url.searchParams.get("lang") === "zh" ? "zh" : "en";
  const { results } = await env.DB.prepare(
    "SELECT name, score, kpm, acc, mode FROM scores WHERE line_id = ?1 AND lang = ?2 ORDER BY score DESC, id ASC LIMIT ?3"
  ).bind(line, lang, TOP_N).all();
  return json(results);
}

async function postScore(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad json" }, 400);

  const name = cleanName(b.name);
  const correct = b.correct | 0, errors = b.errors | 0;
  const maxCombo = b.maxCombo | 0, timeMs = b.timeMs | 0;
  const lang = b.lang === "zh" ? "zh" : "en"; // en=英打 zh=中打，排行榜分開計

  if (!name) return json({ error: "bad name" }, 400);
  if (!LINE_IDS.has(b.lineId)) return json({ error: "bad line" }, 400);
  if (b.mode !== "solo" && b.mode !== "battle") return json({ error: "bad mode" }, 400);
  if (correct < 10 || correct > 3000 || errors < 0 || errors > 3000) return json({ error: "bad stats" }, 400);
  if (maxCombo < 0 || maxCombo > correct) return json({ error: "bad stats" }, 400);
  if (timeMs < 5000 || timeMs > 7_200_000) return json({ error: "bad stats" }, 400);

  const mins = timeMs / 60000;
  const kpm = Math.round(correct / mins);
  if (kpm > (lang === "zh" ? 400 : 1400)) return json({ error: "bad stats" }, 400); // 超出人類極限

  const acc = Math.round((correct / (correct + errors)) * 100);
  const score = Math.max(0, correct * 10 + maxCombo * 5 - errors * 3); // 與遊戲端同一公式

  const ip = req.headers.get("CF-Connecting-IP") || "";
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scores WHERE ip = ?1 AND created_at > datetime('now', '-60 seconds')"
  ).bind(ip).first();
  if (recent.n >= RATE_LIMIT) return json({ error: "too many uploads" }, 429);

  await env.DB.prepare(
    "INSERT INTO scores (name, line_id, mode, lang, score, kpm, acc, max_combo, time_ms, ip) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"
  ).bind(name, b.lineId, b.mode, lang, score, kpm, acc, maxCombo, timeMs, ip).run();

  const above = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scores WHERE line_id = ?1 AND lang = ?2 AND score > ?3"
  ).bind(b.lineId, lang, score).first();

  return json({ ok: true, score, rank: above.n + 1 });
}
