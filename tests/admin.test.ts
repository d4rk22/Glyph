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
  deleted_at: null,
  expires_at: null,
  expired_at: null,
  upload_mode: "worker",
  storage_state: "stored"
};

const deletedUploadRow = {
  id: "deleted123",
  object_key: "uploads/deleted123/archive.zip",
  original_filename: "archive.zip",
  content_type: "application/zip",
  size_bytes: 4096,
  created_at: "2026-05-08T01:30:00.000Z",
  deleted_at: "2026-05-08T03:00:00.000Z",
  expires_at: null,
  expired_at: null,
  upload_mode: "worker",
  storage_state: "deleted"
};

const expiredUploadRow = {
  id: "expired123",
  object_key: "uploads/expired123/old.txt",
  original_filename: "old.txt",
  content_type: "text/plain",
  size_bytes: 12,
  created_at: "2026-05-08T01:00:00.000Z",
  deleted_at: null,
  expires_at: "2020-01-01T00:00:00.000Z",
  expired_at: null,
  upload_mode: "worker",
  storage_state: "stored"
};

interface FakeEnvOptions {
  adminCount?: number;
  authenticated?: boolean;
  activeUploadById?: unknown | null;
  appSettings?: unknown[];
  oldestActiveUploads?: unknown[];
  storageUsage?: unknown;
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
  expirationUpdates: unknown[][];
  markedExpiredIds: string[];
  markedDeletedIds: string[];
  settingsUpdates: unknown[][];
} {
  const deletedObjectKeys: string[] = [];
  const expirationUpdates: unknown[][] = [];
  const markedExpiredIds: string[] = [];
  const markedDeletedIds: string[] = [];
  const settingsUpdates: unknown[][] = [];
  const settingsRows = [...(options.appSettings ?? [])] as Array<{ key: string; value: string; updated_at: string }>;
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
            return options.activeUploadById ?? null;
          }

          if (sql.includes("FROM uploads WHERE id = ?")) {
            return options.uploadById ?? null;
          }

          if (sql.includes("FROM uploads")) {
            return (
              options.storageUsage ?? {
                active_bytes: 1536,
                active_count: 1,
                expired_bytes: 0,
                expired_count: 0,
                deleted_bytes: 4096,
                deleted_count: 1,
                total_bytes: 5632,
                total_count: 2
              }
            );
          }

          throw new Error(`Unhandled first query: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM app_settings")) {
            return { results: settingsRows };
          }

          if (sql.includes("FROM uploads")) {
            if (sql.includes("ORDER BY created_at ASC")) {
              return { results: options.oldestActiveUploads ?? [] };
            }

            return { results: options.uploads ?? [] };
          }

          throw new Error(`Unhandled all query: ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE uploads SET deleted_at = ?")) {
            markedDeletedIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET expires_at = ?")) {
            expirationUpdates.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET expired_at = ?")) {
            markedExpiredIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("INSERT INTO app_settings")) {
            settingsUpdates.push(bindings);
            const [key, value, updatedAt] = bindings as [string, string, string];
            const existing = settingsRows.find((row) => row.key === key);
            if (existing) {
              existing.value = value;
              existing.updated_at = updatedAt;
            } else {
              settingsRows.push({ key, value, updated_at: updatedAt });
            }
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
      async get() {
        return {
          body: new Blob(["hello"]).stream(),
          httpMetadata: { contentType: "text/plain" }
        };
      },
      async delete(key: string) {
        deletedObjectKeys.push(key);
      }
    } as unknown as R2Bucket,
    APP_ENV: "test",
    deletedObjectKeys,
    expirationUpdates,
    markedExpiredIds,
    markedDeletedIds,
    settingsUpdates
  } as Env & {
    deletedObjectKeys: string[];
    expirationUpdates: unknown[][];
    markedExpiredIds: string[];
    markedDeletedIds: string[];
    settingsUpdates: unknown[][];
  };
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
  assert.equal(adminNoticeMessage("expiration-updated"), "Upload expiration updated.");
  assert.equal(adminNoticeMessage("expiration-cleared"), "Upload expiration cleared.");
  assert.equal(adminNoticeMessage("invalid-expiration"), "That expiration date could not be read.");
  assert.equal(
    adminNoticeMessage("storage-cap-updated"),
    "Storage cap updated. Oldest active uploads were expired if active storage was over the cap."
  );
  assert.equal(adminNoticeMessage("storage-cap-cleared"), "Storage cap cleared.");
  assert.equal(adminNoticeMessage("invalid-storage-cap"), "Storage cap must be a non-negative whole number of bytes.");
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
  assert.match(body, /aria-label="Usage summary"/);
  assert.match(body, /<span class="usage-label">Active<\/span>/);
  assert.match(body, /<span class="usage-value">1.50 KB<\/span>/);
  assert.match(body, /<span class="usage-subvalue">1 upload<\/span>/);
  assert.match(body, /<span class="usage-label">Deleted<\/span>/);
  assert.match(body, /<span class="usage-value">4.00 KB<\/span>/);
  assert.match(body, /<span class="usage-label">Total<\/span>/);
  assert.match(body, /<span class="usage-value">5.50 KB<\/span>/);
  assert.match(body, /aria-label="Storage cap"/);
  assert.match(body, /Current No cap/);
  assert.match(body, /name="storageCapBytes"/);
  assert.match(body, /report\.pdf/);
  assert.match(body, /archive\.zip/);
  assert.match(body, /1\.50 KB/);
  assert.match(body, /4\.00 KB/);
  assert.match(body, /status">Active/);
  assert.match(body, /status deleted">Deleted/);
  assert.match(body, /data-copy-url="https:\/\/glyph\.example\/active123"/);
  assert.match(body, /Object uploads\/active123\/report\.pdf/);
  assert.match(body, /No expiration/);
  assert.match(body, /name="expiresAt"/);
  assert.match(body, /name="id" value="active123"/);
  assert.doesNotMatch(body, /name="id" value="deleted123"/);
});

test("authenticated admin page displays configured storage cap", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [{ key: "storage_cap_bytes", value: "2048", updated_at: "2026-05-08T12:00:00.000Z" }],
    uploads: [activeUploadRow]
  });

  const response = await worker.fetch(adminRequest("/admin"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Current 2\.00 KB/);
  assert.match(body, /Remaining 512 B/);
  assert.match(body, /value="2048"/);
});

test("authenticated admin page displays expired upload state and expiration timestamps", async () => {
  const env = createFakeEnv({
    authenticated: true,
    storageUsage: {
      active_bytes: 0,
      active_count: 0,
      expired_bytes: 12,
      expired_count: 1,
      deleted_bytes: 0,
      deleted_count: 0,
      total_bytes: 12,
      total_count: 1
    },
    uploads: [expiredUploadRow]
  });

  const response = await worker.fetch(adminRequest("/admin"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /<span class="usage-label">Expired<\/span>/);
  assert.match(body, /<span class="usage-value">12 B<\/span>/);
  assert.match(body, /status deleted">Expired/);
  assert.match(body, /Expires 2020-01-01T00:00:00.000Z/);
  assert.match(body, /value="2020-01-01T00:00"/);
});

test("active and future-expiring short links download normally", async () => {
  const env = createFakeEnv({
    activeUploadById: {
      ...activeUploadRow,
      expires_at: "2099-01-01T00:00:00.000Z"
    }
  });

  const response = await worker.fetch(new Request("https://glyph.example/active123", { method: "HEAD" }), env, createExecutionContext());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  assert.deepEqual(env.markedExpiredIds, []);
});

test("past expiration and explicit expired state return not found", async () => {
  const pastEnv = createFakeEnv({ activeUploadById: expiredUploadRow });
  const pastResponse = await worker.fetch(new Request("https://glyph.example/expired123"), pastEnv, createExecutionContext());
  const pastBody = await pastResponse.text();

  assert.equal(pastResponse.status, 404);
  assert.match(pastBody, /Unavailable link/);
  assert.deepEqual(pastEnv.markedExpiredIds, ["expired123"]);

  const explicitEnv = createFakeEnv({
    activeUploadById: {
      ...expiredUploadRow,
      expired_at: "2026-05-08T03:00:00.000Z"
    }
  });
  const explicitResponse = await worker.fetch(new Request("https://glyph.example/expired123"), explicitEnv, createExecutionContext());

  assert.equal(explicitResponse.status, 404);
  assert.deepEqual(explicitEnv.markedExpiredIds, []);
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

test("admin expiration update validates origin and missing uploads", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploadById: activeUploadRow
  });
  const blocked = await worker.fetch(
    adminRequest("/admin/uploads/expiration", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ id: "active123", expiresAt: "2099-01-01T00:00" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(blocked.status, 403);
  assert.deepEqual(env.expirationUpdates, []);

  const missing = await worker.fetch(
    adminRequest("/admin/uploads/expiration", {
      method: "POST",
      body: new URLSearchParams({ id: "missing123", expiresAt: "2099-01-01T00:00" })
    }),
    createFakeEnv({ authenticated: true }),
    createExecutionContext()
  );

  assert.equal(missing.status, 303);
  assert.equal(missing.headers.get("Location"), "/admin?notice=missing-upload");
});

test("admin expiration update sets and clears upload expiration", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploadById: activeUploadRow
  });

  const setResponse = await worker.fetch(
    adminRequest("/admin/uploads/expiration", {
      method: "POST",
      body: new URLSearchParams({ id: "active123", expiresAt: "2099-01-01T00:00" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(setResponse.status, 303);
  assert.equal(setResponse.headers.get("Location"), "/admin?notice=expiration-updated");
  assert.equal(env.expirationUpdates[0][1], "active123");
  assert.match(String(env.expirationUpdates[0][0]), /^2099-01-01T/);

  const clearResponse = await worker.fetch(
    adminRequest("/admin/uploads/expiration", {
      method: "POST",
      body: new URLSearchParams({ id: "active123" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(clearResponse.status, 303);
  assert.equal(clearResponse.headers.get("Location"), "/admin?notice=expiration-cleared");
  assert.deepEqual(env.expirationUpdates[1], [null, "active123"]);
});

test("admin storage cap update validates origin before touching settings or uploads", async () => {
  const env = createFakeEnv({ authenticated: true });
  const response = await worker.fetch(
    adminRequest("/admin/settings/storage-cap", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ storageCapBytes: "150" })
    }),
    env,
    createExecutionContext()
  );
  const body = await response.text();

  assert.equal(response.status, 403);
  assert.match(body, /Action blocked/);
  assert.deepEqual(env.settingsUpdates, []);
  assert.deepEqual(env.markedExpiredIds, []);
  assert.deepEqual(env.deletedObjectKeys, []);
});

test("admin storage cap update rejects invalid byte limits", async () => {
  const env = createFakeEnv({ authenticated: true });
  const response = await worker.fetch(
    adminRequest("/admin/settings/storage-cap", {
      method: "POST",
      body: new URLSearchParams({ storageCapBytes: "-1" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=invalid-storage-cap");
  assert.deepEqual(env.settingsUpdates, []);
  assert.deepEqual(env.markedExpiredIds, []);
});

test("admin storage cap update expires oldest active uploads until usage is under cap", async () => {
  const env = createFakeEnv({
    authenticated: true,
    storageUsage: {
      active_bytes: 300,
      active_count: 2,
      expired_bytes: 0,
      expired_count: 0,
      deleted_bytes: 512,
      deleted_count: 1,
      total_bytes: 812,
      total_count: 3
    },
    oldestActiveUploads: [
      {
        ...activeUploadRow,
        id: "oldest",
        object_key: "uploads/oldest/a.txt",
        original_filename: "a.txt",
        size_bytes: 200,
        created_at: "2026-05-08T00:00:00.000Z"
      },
      {
        ...activeUploadRow,
        id: "newest",
        object_key: "uploads/newest/b.txt",
        original_filename: "b.txt",
        size_bytes: 100,
        created_at: "2026-05-08T01:00:00.000Z"
      },
      {
        ...deletedUploadRow,
        id: "deleted-old",
        object_key: "uploads/deleted-old/c.txt",
        original_filename: "c.txt",
        size_bytes: 512,
        created_at: "2026-05-07T01:00:00.000Z"
      }
    ]
  });

  const response = await worker.fetch(
    adminRequest("/admin/settings/storage-cap", {
      method: "POST",
      body: new URLSearchParams({ storageCapBytes: "150" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=storage-cap-updated");
  assert.deepEqual(env.settingsUpdates[0].slice(0, 2), ["storage_cap_bytes", "150"]);
  assert.deepEqual(env.markedExpiredIds, ["oldest"]);
  assert.deepEqual(env.deletedObjectKeys, ["uploads/oldest/a.txt"]);
});

test("admin storage cap can be cleared without enforcement", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [{ key: "storage_cap_bytes", value: "150", updated_at: "2026-05-08T12:00:00.000Z" }],
    storageUsage: {
      active_bytes: 300,
      active_count: 2,
      expired_bytes: 0,
      expired_count: 0,
      deleted_bytes: 0,
      deleted_count: 0,
      total_bytes: 300,
      total_count: 2
    },
    oldestActiveUploads: [activeUploadRow]
  });

  const response = await worker.fetch(
    adminRequest("/admin/settings/storage-cap", { method: "POST", body: new URLSearchParams() }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=storage-cap-cleared");
  assert.deepEqual(env.settingsUpdates[0].slice(0, 2), ["storage_cap_bytes", ""]);
  assert.deepEqual(env.markedExpiredIds, []);
  assert.deepEqual(env.deletedObjectKeys, []);
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
