ALTER TABLE uploads ADD COLUMN multipart_upload_id TEXT;
ALTER TABLE uploads ADD COLUMN multipart_part_size INTEGER;
ALTER TABLE uploads ADD COLUMN multipart_part_count INTEGER;
ALTER TABLE uploads ADD COLUMN multipart_completed_parts TEXT;
ALTER TABLE uploads ADD COLUMN multipart_aborted_at TEXT;

CREATE INDEX idx_uploads_multipart_upload_id ON uploads(multipart_upload_id);
CREATE INDEX idx_uploads_multipart_aborted_at ON uploads(multipart_aborted_at);
