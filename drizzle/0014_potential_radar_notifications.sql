-- 潛力幣候選通知採耐久佇列；僅保存已格式化的公開行情訊息，無交易或個人憑證資料。
CREATE TABLE potential_radar_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
--> statement-breakpoint
CREATE INDEX potential_radar_notifications_pending_idx
  ON potential_radar_notifications(sent_at, created_at);
