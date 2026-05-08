ALTER TABLE uploads ADD COLUMN expires_at TEXT;
ALTER TABLE uploads ADD COLUMN expired_at TEXT;
ALTER TABLE uploads ADD COLUMN upload_mode TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE uploads ADD COLUMN storage_state TEXT NOT NULL DEFAULT 'stored';

CREATE INDEX idx_uploads_expires_at ON uploads(expires_at);
CREATE INDEX idx_uploads_expired_at ON uploads(expired_at);
CREATE INDEX idx_uploads_storage_state ON uploads(storage_state);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
