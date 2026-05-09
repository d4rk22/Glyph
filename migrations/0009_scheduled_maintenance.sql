INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
  ('scheduled_maintenance_enabled', 'false', datetime('now')),
  ('maintenance_last_run_at', '', datetime('now')),
  ('maintenance_last_expired_count', '0', datetime('now')),
  ('maintenance_last_cleanup_attempted_count', '0', datetime('now')),
  ('maintenance_last_cleanup_completed_count', '0', datetime('now')),
  ('maintenance_last_cleanup_failed_count', '0', datetime('now')),
  ('maintenance_last_error', '', datetime('now'));
