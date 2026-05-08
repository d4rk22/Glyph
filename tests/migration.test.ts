import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");

test("initial migration includes the phase 2 metadata tables", () => {
  for (const table of ["uploads", "admin_users", "webauthn_credentials", "admin_sessions"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  }
});

test("uploads table keeps file bytes out of D1 metadata", () => {
  assert.doesNotMatch(migration, /\b(blob|bytes|data)\s+BLOB\b/i);
  assert.match(migration, /\bobject_key TEXT NOT NULL UNIQUE\b/);
});
