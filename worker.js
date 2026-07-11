/* 成績上傳 API — 靜態檔案由 Workers Assets 處理，只有對不到資產的路徑（/api/*）才會進到這裡。
   防護原則：前端只傳原始數據，分數一律由伺服器重算；外加合理性檢查與同 IP 限流。 */

const LINE_IDS = new Set(["BL", "R", "G", "O", "BR", "Y", "TRA-W", "TRA-E"]);
const TOP_N = 10;
const RATE_LIMIT = 5; // 同 IP 每分鐘最多上傳次數

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/scores") {
      if (req.method === "GET") return getScores(url, env);
      if (req.method === "POST") return postScore(req, env);
      return json({ error: "method not allowed" }, 405);
    }
    if (url.pathname === "/api/champions" && req.method === "GET") {
      // 每條路線的榜首（SQLite：GROUP BY + MAX 時裸欄位取自最大值那一列）
      const { results } = await env.DB.prepare(
        "SELECT line_id, name, MAX(score) AS score FROM scores GROUP BY line_id"
      ).all();
      return json(results);
    }
    return json({ error: "not found" }, 404);
  },
};

async function getScores(url, env) {
  const line = url.searchParams.get("line");
  if (!LINE_IDS.has(line)) return json({ error: "bad line" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT name, score, kpm, acc, mode FROM scores WHERE line_id = ?1 ORDER BY score DESC, id ASC LIMIT ?2"
  ).bind(line, TOP_N).all();
  return json(results);
}

async function postScore(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad json" }, 400);

  const name = String(b.name ?? "").trim().replace(/[<>]/g, "").slice(0, 12);
  const correct = b.correct | 0, errors = b.errors | 0;
  const maxCombo = b.maxCombo | 0, timeMs = b.timeMs | 0;

  if (!name) return json({ error: "bad name" }, 400);
  if (!LINE_IDS.has(b.lineId)) return json({ error: "bad line" }, 400);
  if (b.mode !== "solo" && b.mode !== "battle") return json({ error: "bad mode" }, 400);
  if (correct < 10 || correct > 3000 || errors < 0 || errors > 3000) return json({ error: "bad stats" }, 400);
  if (maxCombo < 0 || maxCombo > correct) return json({ error: "bad stats" }, 400);
  if (timeMs < 5000 || timeMs > 7_200_000) return json({ error: "bad stats" }, 400);

  const mins = timeMs / 60000;
  const kpm = Math.round(correct / mins);
  if (kpm > 1400) return json({ error: "bad stats" }, 400); // 超出人類極限

  const acc = Math.round((correct / (correct + errors)) * 100);
  const score = Math.max(0, correct * 10 + maxCombo * 5 - errors * 3); // 與遊戲端同一公式

  const ip = req.headers.get("CF-Connecting-IP") || "";
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scores WHERE ip = ?1 AND created_at > datetime('now', '-60 seconds')"
  ).bind(ip).first();
  if (recent.n >= RATE_LIMIT) return json({ error: "too many uploads" }, 429);

  await env.DB.prepare(
    "INSERT INTO scores (name, line_id, mode, score, kpm, acc, max_combo, time_ms, ip) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
  ).bind(name, b.lineId, b.mode, score, kpm, acc, maxCombo, timeMs, ip).run();

  const above = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scores WHERE line_id = ?1 AND score > ?2"
  ).bind(b.lineId, score).first();

  return json({ ok: true, score, rank: above.n + 1 });
}
