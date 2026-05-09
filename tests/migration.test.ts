import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const v2Migration = readFileSync(new URL("../migrations/0003_v2_foundation.sql", import.meta.url), "utf8");
const r2CleanupMigration = readFileSync(new URL("../migrations/0004_r2_deletion_cleanup.sql", import.meta.url), "utf8");
const directUploadMigration = readFileSync(new URL("../migrations/0005_direct_uploads.sql", import.meta.url), "utf8");
const multipartUploadMigration = readFileSync(new URL("../migrations/0006_multipart_uploads.sql", import.meta.url), "utf8");
const updateSettingsMigration = readFileSync(new URL("../migrations/0007_update_settings.sql", import.meta.url), "utf8");
const updateCheckResultsMigration = readFileSync(new URL("../migrations/0008_update_check_results.sql", import.meta.url), "utf8");

test("migrations include the core metadata and auth tables", () => {
  const allMigrations = [
    migration,
    readFileSync(new URL("../migrations/0002_webauthn_challenges.sql", import.meta.url), "utf8"),
    v2Migration,
    r2CleanupMigration,
    directUploadMigration,
    multipartUploadMigration,
    updateSettingsMigration,
    updateCheckResultsMigration
  ].join("\n");

  for (const table of ["uploads", "admin_users", "webauthn_credentials", "admin_sessions", "webauthn_challenges", "app_settings"]) {
    assert.match(allMigrations, new RegExp(`CREATE TABLE ${table} \\(`));
  }
});

test("direct upload migration tracks pending upload finalization state", () => {
  for (const column of [
    "direct_upload_token_hash",
    "direct_upload_token_expires_at",
    "direct_upload_finalized_at",
    "direct_upload_error"
  ]) {
    assert.match(directUploadMigration, new RegExp(`ADD COLUMN ${column}\\b`));
  }

  assert.match(directUploadMigration, /idx_uploads_direct_upload_token_hash/);
  assert.match(directUploadMigration, /idx_uploads_direct_upload_token_expires_at/);
});

test("multipart upload migration tracks multipart state", () => {
  for (const column of [
    "multipart_upload_id",
    "multipart_part_size",
    "multipart_part_count",
    "multipart_completed_parts",
    "multipart_aborted_at"
  ]) {
    assert.match(multipartUploadMigration, new RegExp(`ADD COLUMN ${column}\\b`));
  }

  assert.match(multipartUploadMigration, /idx_uploads_multipart_upload_id/);
  assert.match(multipartUploadMigration, /idx_uploads_multipart_aborted_at/);
});

test("R2 cleanup migration tracks object deletion retry state", () => {
  for (const column of [
    "r2_delete_requested_at",
    "r2_delete_completed_at",
    "r2_delete_failed_at",
    "r2_delete_error"
  ]) {
    assert.match(r2CleanupMigration, new RegExp(`ADD COLUMN ${column}\\b`));
  }

  assert.match(r2CleanupMigration, /idx_uploads_r2_delete_completed_at/);
  assert.match(r2CleanupMigration, /idx_uploads_r2_delete_failed_at/);
});

test("update settings migration seeds self-update app settings", () => {
  for (const key of ["update_source_url", "update_channel", "auto_update_enabled"]) {
    assert.match(updateSettingsMigration, new RegExp(`'${key}'`));
  }

  assert.match(updateSettingsMigration, /INSERT OR IGNORE INTO app_settings/);
});

test("update check results migration seeds read-only result settings", () => {
  for (const key of [
    "update_last_checked_at",
    "update_latest_version",
    "update_latest_name",
    "update_release_url",
    "update_published_at",
    "update_available",
    "update_last_error"
  ]) {
    assert.match(updateCheckResultsMigration, new RegExp(`'${key}'`));
  }

  assert.match(updateCheckResultsMigration, /INSERT OR IGNORE INTO app_settings/);
});

test("uploads table keeps file bytes out of D1 metadata", () => {
  assert.doesNotMatch(migration, /\b(blob|bytes|data)\s+BLOB\b/i);
  assert.match(migration, /\bobject_key TEXT NOT NULL UNIQUE\b/);
});

test("v2 foundation adds expiration, storage accounting, and upload mode metadata", () => {
  for (const column of ["expires_at", "expired_at", "upload_mode", "storage_state"]) {
    assert.match(v2Migration, new RegExp(`ADD COLUMN ${column}\\b`));
  }

  assert.match(v2Migration, /CREATE TABLE app_settings \(/);
  assert.match(v2Migration, /key TEXT PRIMARY KEY/);
});
