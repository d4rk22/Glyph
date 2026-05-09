INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
  ('update_last_checked_at', '', datetime('now')),
  ('update_latest_version', '', datetime('now')),
  ('update_latest_name', '', datetime('now')),
  ('update_release_url', '', datetime('now')),
  ('update_published_at', '', datetime('now')),
  ('update_available', 'false', datetime('now')),
  ('update_last_error', '', datetime('now'));
