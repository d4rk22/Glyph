ALTER TABLE uploads ADD COLUMN r2_delete_requested_at TEXT;
ALTER TABLE uploads ADD COLUMN r2_delete_completed_at TEXT;
ALTER TABLE uploads ADD COLUMN r2_delete_failed_at TEXT;
ALTER TABLE uploads ADD COLUMN r2_delete_error TEXT;

CREATE INDEX idx_uploads_r2_delete_completed_at ON uploads(r2_delete_completed_at);
CREATE INDEX idx_uploads_r2_delete_failed_at ON uploads(r2_delete_failed_at);
