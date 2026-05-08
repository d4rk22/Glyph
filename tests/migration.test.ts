import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const v2Migration = readFileSync(new URL("../migrations/0003_v2_foundation.sql", import.meta.url), "utf8");
const r2CleanupMigration = readFileSync(new URL("../migrations/0004_r2_deletion_cleanup.sql", import.meta.url), "utf8");
const directUploadMigration = readFileSync(new URL("../migrations/0005_direct_uploads.sql", import.meta.url), "utf8");

test("migrations include the core metadata and auth tables", () => {
  const allMigrations = [
    migration,
    readFileSync(new URL("../migrations/0002_webauthn_challenges.sql", import.meta.url), "utf8"),
    v2Migration,
    r2CleanupMigration,
    directUploadMigration
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
