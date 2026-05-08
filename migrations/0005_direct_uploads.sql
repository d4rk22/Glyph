ALTER TABLE uploads ADD COLUMN direct_upload_token_hash TEXT;
ALTER TABLE uploads ADD COLUMN direct_upload_token_expires_at TEXT;
ALTER TABLE uploads ADD COLUMN direct_upload_finalized_at TEXT;
ALTER TABLE uploads ADD COLUMN direct_upload_error TEXT;

CREATE INDEX idx_uploads_direct_upload_token_hash ON uploads(direct_upload_token_hash);
CREATE INDEX idx_uploads_direct_upload_token_expires_at ON uploads(direct_upload_token_expires_at);
