# 鐵路打字 station-typer

打站名英文拼音（英打）或中文站名（中打），列車隨你的手速加速前進。
收錄台北捷運六線與台鐵東西幹線，可單人挑戰、與 AI 對手對戰，或開車次邀請好友 PK。

- 前端：靜態頁（Workers Assets）
- 後端：Cloudflare Worker（成績 API + D1 排行榜）＋ Durable Object（好友對戰車次）
- 資料庫遷移：`schema.sql`（全新）、`migrate-lang.sql`（既有 DB 加中打欄位）
