import assert from "node:assert/strict";
import test from "node:test";

import { adminNoticeMessage, isSameOriginAdminRequest } from "../src/admin.ts";
import { ADMIN_SESSION_COOKIE } from "../src/auth.ts";
import worker from "../src/index.ts";

const adminUserRow = {
  id: "admin-user",
  username: "admin",
  display_name: "Glyph Admin",
  created_at: "2026-05-08T00:00:00.000Z",
  last_login_at: "2026-05-08T01:00:00.000Z"
};

const activeSessionRow = {
  id: "session",
  admin_user_id: adminUserRow.id,
  session_hash: "hashed-token",
  created_at: "2026-05-08T01:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
  revoked_at: null
};

const activeUploadRow = {
  id: "active123",
  object_key: "uploads/active123/report.pdf",
  original_filename: "report.pdf",
  content_type: "application/pdf",
  size_bytes: 1536,
  created_at: "2026-05-08T02:00:00.000Z",
  deleted_at: null
};

const deletedUploadRow = {
  id: "deleted123",
  object_key: "uploads/deleted123/archive.zip",
  original_filename: "archive.zip",
  content_type: "application/zip",
  size_bytes: 4096,
  created_at: "2026-05-08T01:30:00.000Z",
  deleted_at: "2026-05-08T03:00:00.000Z"
};

interface FakeEnvOptions {
  adminCount?: number;
  authenticated?: boolean;
  uploads?: unknown[];
  uploadById?: unknown | null;
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {}
  } as ExecutionContext;
}

function createFakeEnv(options: FakeEnvOptions = {}): Env & {
  deletedObjectKeys: string[];
  markedDeletedIds: string[];
} {
  const deletedObjectKeys: string[] = [];
  const markedDeletedIds: string[] = [];
  const adminCount = options.adminCount ?? 1;
  const authenticated = options.authenticated ?? false;

  const db = {
    prepare(sql: string) {
      let bindings: unknown[] = [];

      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes("COUNT(*) AS count FROM admin_users")) {
            return { count: adminCount };
          }

          if (sql.includes("FROM admin_sessions")) {
            return authenticated ? activeSessionRow : null;
          }

          if (sql.includes("FROM admin_users WHERE id = ?")) {
            return authenticated ? adminUserRow : null;
          }

          if (sql.includes("FROM uploads WHERE id = ? AND deleted_at IS NULL")) {
            return null;
          }

          if (sql.includes("FROM uploads WHERE id = ?")) {
            return options.uploadById ?? null;
          }

          throw new Error(`Unhandled first query: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM uploads")) {
            return { results: options.uploads ?? [] };
          }

          throw new Error(`Unhandled all query: ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE uploads SET deleted_at = ?")) {
            markedDeletedIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          throw new Error(`Unhandled run query: ${sql}`);
        }
      };
    }
  };

  return {
    DB: db as unknown as D1Database,
    FILES: {
      async delete(key: string) {
        deletedObjectKeys.push(key);
      }
    } as unknown as R2Bucket,
    APP_ENV: "test",
    deletedObjectKeys,
    markedDeletedIds
  } as Env & { deletedObjectKeys: string[]; markedDeletedIds: string[] };
}

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `${ADMIN_SESSION_COOKIE}=test-token`);

  return new Request(`https://glyph.example${path}`, {
    ...init,
    headers
  });
}

test("adminNoticeMessage maps known dashboard notices", () => {
  assert.equal(adminNoticeMessage("deleted"), "Upload deleted. R2 object deletion was requested and the metadata is marked deleted.");
  assert.equal(adminNoticeMessage("missing-upload"), "That upload no longer exists.");
  assert.equal(adminNoticeMessage("missing-id"), "No upload was selected.");
  assert.equal(adminNoticeMessage("unknown"), null);
});

test("isSameOriginAdminRequest accepts absent or matching origins", () => {
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", null), true);
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", "https://glyph.example"), true);
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", "https://evil.example"), false);
});

test("protected admin page shows passkey login without a valid session", async () => {
  const env = createFakeEnv({ authenticated: false });
  const response = await worker.fetch(new Request("https://glyph.example/admin"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Use passkey/);
  assert.doesNotMatch(body, /<h1>Files<\/h1>/);
});

test("authenticated admin page lists active and deleted upload metadata", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploads: [activeUploadRow, deletedUploadRow]
  });

  const response = await worker.fetch(adminRequest("/admin?notice=deleted"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /<h1>Files<\/h1>/);
  assert.match(body, /Upload deleted/);
  assert.match(body, /report\.pdf/);
  assert.match(body, /archive\.zip/);
  assert.match(body, /1\.50 KB/);
  assert.match(body, /4\.00 KB/);
  assert.match(body, /status">Active/);
  assert.match(body, /status deleted">Deleted/);
  assert.match(body, /data-copy-url="https:\/\/glyph\.example\/active123"/);
  assert.match(body, /Object uploads\/active123\/report\.pdf/);
  assert.match(body, /name="id" value="active123"/);
  assert.doesNotMatch(body, /name="id" value="deleted123"/);
});

test("admin delete rejects cross-origin form posts before touching R2 or upload metadata", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploadById: activeUploadRow
  });
  const request = adminRequest("/admin/uploads/delete", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: new URLSearchParams({ id: "active123" })
  });

  const response = await worker.fetch(request, env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 403);
  assert.match(body, /Action blocked/);
  assert.deepEqual(env.deletedObjectKeys, []);
  assert.deepEqual(env.markedDeletedIds, []);
});

test("admin delete redirects with missing upload notices", async () => {
  const env = createFakeEnv({ authenticated: true });

  const missingId = await worker.fetch(
    adminRequest("/admin/uploads/delete", { method: "POST", body: new URLSearchParams() }),
    env,
    createExecutionContext()
  );
  assert.equal(missingId.status, 303);
  assert.equal(missingId.headers.get("Location"), "/admin?notice=missing-id");

  const missingUpload = await worker.fetch(
    adminRequest("/admin/uploads/delete", { method: "POST", body: new URLSearchParams({ id: "missing123" }) }),
    env,
    createExecutionContext()
  );
  assert.equal(missingUpload.status, 303);
  assert.equal(missingUpload.headers.get("Location"), "/admin?notice=missing-upload");
});

test("admin delete removes the R2 object and marks metadata deleted", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploadById: activeUploadRow
  });

  const response = await worker.fetch(
    adminRequest("/admin/uploads/delete", { method: "POST", body: new URLSearchParams({ id: "active123" }) }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=deleted");
  assert.deepEqual(env.deletedObjectKeys, ["uploads/active123/report.pdf"]);
  assert.deepEqual(env.markedDeletedIds, ["active123"]);
});

test("deleted short links return the polished not-found page", async () => {
  const env = createFakeEnv();

  const response = await worker.fetch(new Request("https://glyph.example/deleted123"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.match(body, /Unavailable link/);
  assert.match(body, /not exist or is no longer available/);
});
