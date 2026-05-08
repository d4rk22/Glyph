INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
  ('update_source_url', '', datetime('now')),
  ('update_channel', 'stable', datetime('now')),
  ('auto_update_enabled', 'false', datetime('now'));
