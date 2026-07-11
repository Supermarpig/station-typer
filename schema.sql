-- 成績紀錄表：分數由伺服器重算，ip 僅用於限流
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  line_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL,
  kpm INTEGER NOT NULL,
  acc INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  time_ms INTEGER NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_line ON scores(line_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_ip_time ON scores(ip, created_at);
