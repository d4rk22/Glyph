import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const v2Migration = readFileSync(new URL("../migrations/0003_v2_foundation.sql", import.meta.url), "utf8");

test("migrations include the core metadata and auth tables", () => {
  const allMigrations = [
    migration,
    readFileSync(new URL("../migrations/0002_webauthn_challenges.sql", import.meta.url), "utf8"),
    v2Migration
  ].join("\n");

  for (const table of ["uploads", "admin_users", "webauthn_credentials", "admin_sessions", "webauthn_challenges", "app_settings"]) {
    assert.match(allMigrations, new RegExp(`CREATE TABLE ${table} \\(`));
  }
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
