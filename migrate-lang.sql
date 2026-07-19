-- 既有資料庫加中打欄位（一次性）：
--   wrangler d1 execute station-typer --local  --file=migrate-lang.sql
--   wrangler d1 execute station-typer --remote --file=migrate-lang.sql
ALTER TABLE scores ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
CREATE INDEX IF NOT EXISTS idx_scores_line_lang ON scores(line_id, lang, score DESC);
