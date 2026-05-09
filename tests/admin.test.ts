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
  r2CleanupCandidates?: unknown[];
  r2CleanupStats?: unknown;
  r2DeleteFailures?: string[];
  oldestActiveUploads?: unknown[];
  pendingDirectUploadByToken?: unknown | null;
  pendingMultipartUploadByToken?: unknown | null;
  directUploadCredentials?: boolean;
  headObject?: { size: number } | null;
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
  r2DeleteCompletedIds: string[];
  r2DeleteFailedUpdates: unknown[][];
  r2DeleteRequestedIds: string[];
  directStoredIds: string[];
  directFailedUpdates: unknown[][];
  multipartUploadIdUpdates: unknown[][];
  multipartStoredUpdates: unknown[][];
  multipartFailedUpdates: unknown[][];
  multipartAbortedIds: string[];
  insertedUploadBindings: unknown[][];
  uploadedObjectKeys: string[];
  settingsUpdates: unknown[][];
} {
  const deletedObjectKeys: string[] = [];
  const expirationUpdates: unknown[][] = [];
  const markedExpiredIds: string[] = [];
  const markedDeletedIds: string[] = [];
  const r2DeleteCompletedIds: string[] = [];
  const r2DeleteFailedUpdates: unknown[][] = [];
  const r2DeleteRequestedIds: string[] = [];
  const directStoredIds: string[] = [];
  const directFailedUpdates: unknown[][] = [];
  const multipartUploadIdUpdates: unknown[][] = [];
  const multipartStoredUpdates: unknown[][] = [];
  const multipartFailedUpdates: unknown[][] = [];
  const multipartAbortedIds: string[] = [];
  const insertedUploadBindings: unknown[][] = [];
  const uploadedObjectKeys: string[] = [];
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

          if (sql.includes("direct_upload_token_hash") && sql.includes("upload_mode = 'multipart'")) {
            return options.pendingMultipartUploadByToken ?? null;
          }

          if (sql.includes("direct_upload_token_hash")) {
            return options.pendingDirectUploadByToken ?? null;
          }

          if (sql.includes("FROM uploads WHERE id = ? AND deleted_at IS NULL")) {
            return options.activeUploadById ?? null;
          }

          if (sql.includes("FROM uploads WHERE id = ?")) {
            return options.uploadById ?? null;
          }

          if (sql.includes("r2_delete_completed_at")) {
            return (
              options.r2CleanupStats ?? {
                pending_count: 1,
                failed_count: 0,
                completed_count: 0
              }
            );
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
            if (sql.includes("r2_delete_completed_at IS NULL")) {
              return { results: options.r2CleanupCandidates ?? [] };
            }

            if (sql.includes("ORDER BY created_at ASC")) {
              return { results: options.oldestActiveUploads ?? [] };
            }

            return { results: options.uploads ?? [] };
          }

          throw new Error(`Unhandled all query: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO uploads")) {
            insertedUploadBindings.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET multipart_upload_id = ?")) {
            multipartUploadIdUpdates.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET r2_delete_requested_at = ?")) {
            r2DeleteRequestedIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET r2_delete_requested_at = COALESCE") && sql.includes("r2_delete_completed_at = ?")) {
            r2DeleteCompletedIds.push(String(bindings[2]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET r2_delete_requested_at = COALESCE") && sql.includes("r2_delete_failed_at = ?")) {
            r2DeleteFailedUpdates.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE uploads SET deleted_at = ?")) {
            markedDeletedIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET storage_state = 'stored'") && sql.includes("upload_mode = 'multipart'")) {
            multipartStoredUpdates.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET storage_state = 'stored'")) {
            directStoredIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("multipart_aborted_at = ?")) {
            multipartAbortedIds.push(String(bindings[1]));
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET storage_state = 'failed'") && sql.includes("upload_mode = 'multipart'")) {
            multipartFailedUpdates.push(bindings);
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET storage_state = 'failed'")) {
            directFailedUpdates.push(bindings);
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
      async put(key: string) {
        uploadedObjectKeys.push(key);
      },
      async get() {
        return {
          body: new Blob(["hello"]).stream(),
          httpMetadata: { contentType: "text/plain" }
        };
      },
      async head() {
        return options.headObject ?? null;
      },
      async delete(key: string) {
        deletedObjectKeys.push(key);
        if (options.r2DeleteFailures?.includes(key)) {
          throw new Error("delete failed");
        }
      }
    } as unknown as R2Bucket,
    APP_ENV: "test",
    R2_ACCOUNT_ID: options.directUploadCredentials ? "account-id" : undefined,
    R2_ACCESS_KEY_ID: options.directUploadCredentials ? "access-key-id" : undefined,
    R2_SECRET_ACCESS_KEY: options.directUploadCredentials ? "secret-access-key" : undefined,
    R2_BUCKET_NAME: options.directUploadCredentials ? "glyph-files" : undefined,
    deletedObjectKeys,
    expirationUpdates,
    markedExpiredIds,
    markedDeletedIds,
    r2DeleteCompletedIds,
    r2DeleteFailedUpdates,
    r2DeleteRequestedIds,
    directStoredIds,
    directFailedUpdates,
    multipartUploadIdUpdates,
    multipartStoredUpdates,
    multipartFailedUpdates,
    multipartAbortedIds,
    insertedUploadBindings,
    uploadedObjectKeys,
    settingsUpdates
  } as Env & {
    deletedObjectKeys: string[];
    expirationUpdates: unknown[][];
    markedExpiredIds: string[];
    markedDeletedIds: string[];
    r2DeleteCompletedIds: string[];
    r2DeleteFailedUpdates: unknown[][];
    r2DeleteRequestedIds: string[];
    directStoredIds: string[];
    directFailedUpdates: unknown[][];
    multipartUploadIdUpdates: unknown[][];
    multipartStoredUpdates: unknown[][];
    multipartFailedUpdates: unknown[][];
    multipartAbortedIds: string[];
    insertedUploadBindings: unknown[][];
    uploadedObjectKeys: string[];
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

async function withMockedFetch<T>(handler: typeof fetch, callback: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("adminNoticeMessage maps known dashboard notices", () => {
  assert.equal(adminNoticeMessage("deleted"), "Upload deleted. R2 object deletion was requested and the metadata is marked deleted.");
  assert.equal(adminNoticeMessage("missing-upload"), "That upload no longer exists.");
  assert.equal(adminNoticeMessage("missing-id"), "No upload was selected.");
  assert.equal(adminNoticeMessage("expiration-updated"), "Upload expiration updated.");
  assert.equal(adminNoticeMessage("expiration-cleared"), "Upload expiration cleared.");
  assert.equal(adminNoticeMessage("invalid-expiration"), "That expiration date could not be read.");
  assert.equal(
    adminNoticeMessage("expiration-object-cleaned"),
    "That upload's R2 object has already been cleaned up, so its expiration cannot be changed."
  );
  assert.equal(
    adminNoticeMessage("storage-cap-updated"),
    "Storage cap updated. Oldest active uploads were expired if active storage was over the cap."
  );
  assert.equal(adminNoticeMessage("storage-cap-cleared"), "Storage cap cleared.");
  assert.equal(adminNoticeMessage("invalid-storage-cap"), "Storage cap must be a non-negative whole number of bytes.");
  assert.equal(adminNoticeMessage("upload-mode-updated"), "Upload mode updated.");
  assert.equal(adminNoticeMessage("invalid-upload-mode"), "Upload mode must be worker-mediated, direct-to-R2, or multipart direct-to-R2.");
  assert.equal(adminNoticeMessage("r2-cleanup-complete"), "R2 cleanup retry finished.");
  assert.equal(
    adminNoticeMessage("r2-cleanup-partial"),
    "R2 cleanup retried, but one or more objects still could not be deleted."
  );
  assert.equal(adminNoticeMessage("r2-cleanup-none"), "No expired or deleted uploads currently need R2 cleanup.");
  assert.equal(adminNoticeMessage("update-settings-saved"), "Update settings saved. Automatic updates remain opt-in and no update was run.");
  assert.equal(adminNoticeMessage("invalid-update-settings"), "Update settings must use a valid HTTPS source URL and known channel.");
  assert.equal(adminNoticeMessage("update-source-missing"), "Add a public GitHub update source before checking for updates.");
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
  assert.match(body, /aria-label="Upload mode"/);
  assert.match(body, /Worker-mediated/);
  assert.match(body, /Multipart direct-to-R2/);
  assert.match(body, /name="uploadMode"/);
  assert.match(body, /aria-label="R2 cleanup"/);
  assert.match(body, /Pending 1/);
  assert.match(body, /action="\/admin\/maintenance\/r2-cleanup"/);
  assert.match(body, /aria-label="Self-update"/);
  assert.match(body, /Current 0\.1\.2/);
  assert.match(body, /Source Not configured/);
  assert.match(body, /Official public update source/);
  assert.match(body, /https:\/\/github\.com\/d4rk22\/Glyph/);
  assert.match(body, /placeholder="https:\/\/github\.com\/d4rk22\/Glyph"/);
  assert.match(body, /Automatic Disabled/);
  assert.match(body, /action="\/admin\/settings\/updates"/);
  assert.match(body, /action="\/admin\/updates\/check"/);
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

test("authenticated admin page displays configured update settings", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [
      { key: "update_source_url", value: "https://github.com/example/glyph", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "update_channel", value: "beta", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "auto_update_enabled", value: "true", updated_at: "2026-05-08T12:00:00.000Z" }
    ],
    uploads: [activeUploadRow]
  });

  const response = await worker.fetch(adminRequest("/admin"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Source https:\/\/github\.com\/example\/glyph/);
  assert.match(body, /Channel beta/);
  assert.match(body, /Automatic Enabled/);
  assert.match(body, /name="autoUpdateEnabled" type="checkbox" value="true" checked/);
  assert.match(body, /<option value="beta" selected>Beta<\/option>/);
  assert.doesNotMatch(body, /Leave blank for forks or private deployments/);
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

test("authenticated admin page displays completed R2 cleanup state without expiration controls", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploads: [
      {
        ...expiredUploadRow,
        expired_at: "2026-05-08T03:00:00.000Z",
        r2_delete_requested_at: "2026-05-08T03:01:00.000Z",
        r2_delete_completed_at: "2026-05-08T03:02:00.000Z"
      }
    ]
  });

  const response = await worker.fetch(adminRequest("/admin"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /R2 cleanup complete 2026-05-08T03:02:00.000Z/);
  assert.doesNotMatch(body, /name="expiresAt"/);
  assert.doesNotMatch(body, /Clear expiration/);
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

test("pending and failed direct uploads are not downloadable", async () => {
  const pending = createFakeEnv({
    activeUploadById: {
      ...activeUploadRow,
      upload_mode: "direct",
      storage_state: "pending"
    }
  });
  const pendingResponse = await worker.fetch(new Request("https://glyph.example/active123"), pending, createExecutionContext());

  const failed = createFakeEnv({
    activeUploadById: {
      ...activeUploadRow,
      upload_mode: "direct",
      storage_state: "failed"
    }
  });
  const failedResponse = await worker.fetch(new Request("https://glyph.example/active123"), failed, createExecutionContext());

  assert.equal(pendingResponse.status, 404);
  assert.equal(failedResponse.status, 404);
});

test("pending and failed multipart uploads are not downloadable", async () => {
  const pending = createFakeEnv({
    activeUploadById: {
      ...activeUploadRow,
      upload_mode: "multipart",
      storage_state: "pending",
      multipart_upload_id: "r2-upload-id"
    }
  });
  const pendingResponse = await worker.fetch(new Request("https://glyph.example/active123"), pending, createExecutionContext());

  const failed = createFakeEnv({
    activeUploadById: {
      ...activeUploadRow,
      upload_mode: "multipart",
      storage_state: "failed",
      multipart_upload_id: "r2-upload-id",
      multipart_aborted_at: "2026-05-08T03:00:00.000Z"
    }
  });
  const failedResponse = await worker.fetch(new Request("https://glyph.example/active123"), failed, createExecutionContext());

  assert.equal(pendingResponse.status, 404);
  assert.equal(failedResponse.status, 404);
});

test("direct upload initiate requires direct mode and configured R2 credentials", async () => {
  const disabled = createFakeEnv();
  const disabledResponse = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/initiate", {
      method: "POST",
      body: JSON.stringify({ filename: "file.txt", contentType: "text/plain", sizeBytes: 12 })
    }),
    disabled,
    createExecutionContext()
  );

  const missingCredentials = createFakeEnv({
    appSettings: [{ key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }]
  });
  const missingResponse = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/initiate", {
      method: "POST",
      body: JSON.stringify({ filename: "file.txt", contentType: "text/plain", sizeBytes: 12 })
    }),
    missingCredentials,
    createExecutionContext()
  );

  assert.equal(disabledResponse.status, 409);
  assert.equal(missingResponse.status, 409);
});

test("direct upload initiate creates pending metadata and returns a presigned R2 URL", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    appSettings: [{ key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }]
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "file.txt", contentType: "text/plain", sizeBytes: 12 })
    }),
    env,
    createExecutionContext()
  );
  const body = (await response.json()) as { id: string; token: string; uploadUrl: string; finalizeUrl: string };

  assert.equal(response.status, 200);
  assert.equal(body.finalizeUrl, "/uploads/direct/finalize");
  assert.match(body.uploadUrl, /^https:\/\/account-id\.r2\.cloudflarestorage\.com\/glyph-files\/uploads\//);
  assert.match(body.uploadUrl, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.equal(env.insertedUploadBindings.length, 1);
  assert.equal(env.insertedUploadBindings[0][7], "direct");
  assert.equal(env.insertedUploadBindings[0][8], "pending");
  assert.equal(typeof env.insertedUploadBindings[0][9], "string");
  assert.equal(typeof body.id, "string");
  assert.equal(typeof body.token, "string");
});

test("multipart mode keeps small direct uploads and rejects threshold-sized direct uploads", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    appSettings: [{ key: "upload_mode", value: "multipart", updated_at: "2026-05-08T12:00:00.000Z" }]
  });

  const small = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "small.bin", contentType: "application/octet-stream", sizeBytes: 1024 })
    }),
    env,
    createExecutionContext()
  );
  const large = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "large.bin", contentType: "application/octet-stream", sizeBytes: 32 * 1024 * 1024 })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(small.status, 200);
  assert.equal(large.status, 409);
  assert.equal(env.insertedUploadBindings.length, 1);
  assert.equal(env.insertedUploadBindings[0][7], "direct");
});

test("public upload page enables direct upload only when mode and credentials are configured", async () => {
  const workerMode = await worker.fetch(new Request("https://glyph.example/"), createFakeEnv(), createExecutionContext());
  const workerBody = await workerMode.text();
  const directMode = await worker.fetch(
    new Request("https://glyph.example/"),
    createFakeEnv({
      directUploadCredentials: true,
      appSettings: [{ key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }]
    }),
    createExecutionContext()
  );
  const directBody = await directMode.text();
  const multipartMode = await worker.fetch(
    new Request("https://glyph.example/"),
    createFakeEnv({
      directUploadCredentials: true,
      appSettings: [{ key: "upload_mode", value: "multipart", updated_at: "2026-05-08T12:00:00.000Z" }]
    }),
    createExecutionContext()
  );
  const multipartBody = await multipartMode.text();

  assert.doesNotMatch(workerBody, /data-direct-upload="true"/);
  assert.match(directBody, /data-direct-upload="true"/);
  assert.match(multipartBody, /data-direct-upload="true"/);
  assert.match(multipartBody, /data-upload-mode="multipart"/);
  assert.match(multipartBody, /data-multipart-threshold-bytes="\d+"/);
  assert.match(multipartBody, /data-multipart-part-size-bytes="\d+"/);
  assert.match(multipartBody, /src="\/admin\.js"/);
});

test("client upload script includes multipart progress hooks", async () => {
  const response = await worker.fetch(new Request("https://glyph.example/admin.js"), createFakeEnv(), createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /uploadMultipartDirect/);
  assert.match(body, /uploadProgressText/);
  assert.match(body, /formatDuration/);
});

test("worker-mediated upload path remains available as fallback", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    appSettings: [{ key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }]
  });
  const form = new FormData();
  form.set("file", new File(["hello"], "fallback.txt", { type: "text/plain" }));

  const response = await worker.fetch(new Request("https://glyph.example/", { method: "POST", body: form }), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 201);
  assert.match(body, /Upload complete/);
  assert.equal(env.insertedUploadBindings[0][7], "worker");
  assert.equal(env.insertedUploadBindings[0][8], "stored");
  assert.equal(env.uploadedObjectKeys.length, 1);
});

test("direct upload finalization marks pending metadata stored after R2 object appears", async () => {
  const env = createFakeEnv({
    pendingDirectUploadByToken: {
      ...activeUploadRow,
      id: "direct123",
      object_key: "uploads/direct123/file.txt",
      original_filename: "file.txt",
      content_type: "text/plain",
      size_bytes: 12,
      upload_mode: "direct",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z"
    },
    headObject: { size: 12 }
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "direct123", token: "direct-token" })
    }),
    env,
    createExecutionContext()
  );
  const body = await response.text();

  assert.equal(response.status, 201);
  assert.match(body, /Upload complete/);
  assert.match(body, /https:\/\/glyph\.example\/direct123/);
  assert.deepEqual(env.directStoredIds, ["direct123"]);
});

test("direct upload finalization leaves missing R2 objects pending", async () => {
  const env = createFakeEnv({
    pendingDirectUploadByToken: {
      ...activeUploadRow,
      id: "direct123",
      upload_mode: "direct",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z"
    },
    headObject: null
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/finalize", {
      method: "POST",
      body: JSON.stringify({ id: "direct123", token: "direct-token" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 409);
  assert.deepEqual(env.directStoredIds, []);
  assert.deepEqual(env.directFailedUpdates, []);
});

test("direct upload finalization marks size mismatches failed and cleans R2", async () => {
  const env = createFakeEnv({
    pendingDirectUploadByToken: {
      ...activeUploadRow,
      id: "direct123",
      object_key: "uploads/direct123/file.txt",
      size_bytes: 12,
      upload_mode: "direct",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z"
    },
    headObject: { size: 99 }
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/direct/finalize", {
      method: "POST",
      body: JSON.stringify({ id: "direct123", token: "direct-token" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 400);
  assert.deepEqual(env.directFailedUpdates[0], ["Uploaded object size did not match metadata.", "direct123"]);
  assert.deepEqual(env.deletedObjectKeys, ["uploads/direct123/file.txt"]);
  assert.deepEqual(env.r2DeleteCompletedIds, ["direct123"]);
});

test("multipart upload initiate creates pending metadata and stores the R2 upload id", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    appSettings: [{ key: "upload_mode", value: "multipart", updated_at: "2026-05-08T12:00:00.000Z" }]
  });

  await withMockedFetch(
    async () =>
      new Response("<InitiateMultipartUploadResult><UploadId>r2-upload-id</UploadId></InitiateMultipartUploadResult>", {
        status: 200
      }),
    async () => {
      const response = await worker.fetch(
        new Request("https://glyph.example/uploads/multipart/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: "large.bin", contentType: "application/octet-stream", sizeBytes: 40 * 1024 * 1024 })
        }),
        env,
        createExecutionContext()
      );
      const body = (await response.json()) as {
        id: string;
        token: string;
        partSize: number;
        partCount: number;
        authorizePartUrl: string;
        finalizeUrl: string;
        abortUrl: string;
      };

      assert.equal(response.status, 200);
      assert.equal(body.partSize, 8 * 1024 * 1024);
      assert.equal(body.partCount, 5);
      assert.equal(body.authorizePartUrl, "/uploads/multipart/part");
      assert.equal(body.finalizeUrl, "/uploads/multipart/finalize");
      assert.equal(body.abortUrl, "/uploads/multipart/abort");
      assert.equal(env.insertedUploadBindings[0][7], "multipart");
      assert.equal(env.insertedUploadBindings[0][8], "pending");
      assert.deepEqual(env.multipartUploadIdUpdates[0].slice(0, 3), ["r2-upload-id", 8 * 1024 * 1024, 5]);
      assert.equal(typeof body.id, "string");
      assert.equal(typeof body.token, "string");
    }
  );
});

test("multipart part authorization returns presigned URLs for expected parts", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    pendingMultipartUploadByToken: {
      ...activeUploadRow,
      id: "multi123",
      object_key: "uploads/multi123/large.bin",
      size_bytes: 40 * 1024 * 1024,
      upload_mode: "multipart",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z",
      multipart_upload_id: "r2-upload-id",
      multipart_part_size: 8 * 1024 * 1024,
      multipart_part_count: 5
    }
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/multipart/part", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "multi123", token: "multipart-token", partNumber: 2 })
    }),
    env,
    createExecutionContext()
  );
  const body = (await response.json()) as { partNumber: number; uploadUrl: string };

  assert.equal(response.status, 200);
  assert.equal(body.partNumber, 2);
  assert.match(body.uploadUrl, /partNumber=2/);
  assert.match(body.uploadUrl, /uploadId=r2-upload-id/);
  assert.match(body.uploadUrl, /X-Amz-Signature=/);
});

test("multipart finalization rejects incomplete parts without storing metadata", async () => {
  const env = createFakeEnv({
    pendingMultipartUploadByToken: {
      ...activeUploadRow,
      id: "multi123",
      upload_mode: "multipart",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z",
      multipart_upload_id: "r2-upload-id",
      multipart_part_count: 2
    }
  });

  const response = await worker.fetch(
    new Request("https://glyph.example/uploads/multipart/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "multi123", token: "multipart-token", parts: [{ partNumber: 1, etag: '"one"' }] })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 400);
  assert.deepEqual(env.multipartStoredUpdates, []);
});

test("multipart finalization completes R2 upload and marks metadata stored", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    pendingMultipartUploadByToken: {
      ...activeUploadRow,
      id: "multi123",
      object_key: "uploads/multi123/large.bin",
      original_filename: "large.bin",
      size_bytes: 16,
      upload_mode: "multipart",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z",
      multipart_upload_id: "r2-upload-id",
      multipart_part_size: 8,
      multipart_part_count: 2
    },
    headObject: { size: 16 }
  });
  let completeBody = "";

  await withMockedFetch(
    async (_input, init) => {
      completeBody = String(init?.body ?? "");
      return new Response("<CompleteMultipartUploadResult />", { status: 200 });
    },
    async () => {
      const response = await worker.fetch(
        new Request("https://glyph.example/uploads/multipart/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "multi123",
            token: "multipart-token",
            parts: [
              { partNumber: 2, etag: '"two"' },
              { partNumber: 1, etag: '"one"' }
            ]
          })
        }),
        env,
        createExecutionContext()
      );
      const body = await response.text();

      assert.equal(response.status, 201);
      assert.match(body, /Upload complete/);
      assert.match(completeBody, /<PartNumber>1<\/PartNumber>/);
      assert.match(completeBody, /<PartNumber>2<\/PartNumber>/);
      assert.equal(env.multipartStoredUpdates[0][2], "multi123");
      assert.match(String(env.multipartStoredUpdates[0][1]), /"partNumber":1/);
    }
  );
});

test("multipart abort marks pending metadata failed and unavailable", async () => {
  const env = createFakeEnv({
    directUploadCredentials: true,
    pendingMultipartUploadByToken: {
      ...activeUploadRow,
      id: "multi123",
      object_key: "uploads/multi123/large.bin",
      upload_mode: "multipart",
      storage_state: "pending",
      direct_upload_token_expires_at: "2099-01-01T00:00:00.000Z",
      multipart_upload_id: "r2-upload-id",
      multipart_part_count: 2
    }
  });

  await withMockedFetch(
    async () => new Response(null, { status: 204 }),
    async () => {
      const response = await worker.fetch(
        new Request("https://glyph.example/uploads/multipart/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "multi123", token: "multipart-token" })
        }),
        env,
        createExecutionContext()
      );

      assert.equal(response.status, 200);
      assert.deepEqual(env.multipartAbortedIds, ["multi123"]);
    }
  );
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

test("admin expiration update refuses uploads whose R2 object was cleaned", async () => {
  const env = createFakeEnv({
    authenticated: true,
    uploadById: {
      ...expiredUploadRow,
      expired_at: "2026-05-08T03:00:00.000Z",
      r2_delete_completed_at: "2026-05-08T03:02:00.000Z"
    }
  });

  const response = await worker.fetch(
    adminRequest("/admin/uploads/expiration", {
      method: "POST",
      body: new URLSearchParams({ id: "expired123" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=expiration-object-cleaned");
  assert.deepEqual(env.expirationUpdates, []);
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
  assert.deepEqual(env.r2DeleteRequestedIds, ["oldest"]);
  assert.deepEqual(env.r2DeleteCompletedIds, ["oldest"]);
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

test("admin upload mode update validates origin and persists multipart mode", async () => {
  const env = createFakeEnv({ authenticated: true });
  const blocked = await worker.fetch(
    adminRequest("/admin/settings/upload-mode", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({ uploadMode: "multipart" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(blocked.status, 403);
  assert.deepEqual(env.settingsUpdates, []);

  const saved = await worker.fetch(
    adminRequest("/admin/settings/upload-mode", {
      method: "POST",
      body: new URLSearchParams({ uploadMode: "multipart" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("Location"), "/admin?notice=upload-mode-updated");
  assert.deepEqual(env.settingsUpdates[0].slice(0, 2), ["upload_mode", "multipart"]);
});

test("admin upload mode update rejects unknown modes", async () => {
  const env = createFakeEnv({ authenticated: true });
  const response = await worker.fetch(
    adminRequest("/admin/settings/upload-mode", {
      method: "POST",
      body: new URLSearchParams({ uploadMode: "banana" })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=invalid-upload-mode");
  assert.deepEqual(env.settingsUpdates, []);
});

test("admin update settings validate origin and persist source channel and opt-in", async () => {
  const env = createFakeEnv({ authenticated: true });
  const blocked = await worker.fetch(
    adminRequest("/admin/settings/updates", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: new URLSearchParams({
        updateSourceUrl: "https://github.com/example/glyph",
        updateChannel: "beta",
        autoUpdateEnabled: "true"
      })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(blocked.status, 403);
  assert.deepEqual(env.settingsUpdates, []);

  const saved = await worker.fetch(
    adminRequest("/admin/settings/updates", {
      method: "POST",
      body: new URLSearchParams({
        updateSourceUrl: "https://github.com/example/glyph",
        updateChannel: "beta",
        autoUpdateEnabled: "true"
      })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("Location"), "/admin?notice=update-settings-saved");
  assert.deepEqual(
    env.settingsUpdates.map((binding) => binding.slice(0, 2)),
    [
      ["update_source_url", "https://github.com/example/glyph"],
      ["update_channel", "beta"],
      ["auto_update_enabled", "true"]
    ]
  );
});

test("admin update settings reject invalid source and channel", async () => {
  const env = createFakeEnv({ authenticated: true });
  const response = await worker.fetch(
    adminRequest("/admin/settings/updates", {
      method: "POST",
      body: new URLSearchParams({
        updateSourceUrl: "http://example.com/glyph",
        updateChannel: "nightly"
      })
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=invalid-update-settings");
  assert.deepEqual(env.settingsUpdates, []);
});

test("admin update check requires auth, same origin, and configured source", async () => {
  const unauthenticated = await worker.fetch(
    new Request("https://glyph.example/admin/updates/check", { method: "POST" }),
    createFakeEnv({ authenticated: false }),
    createExecutionContext()
  );
  assert.equal(unauthenticated.status, 303);
  assert.equal(unauthenticated.headers.get("Location"), "/admin");

  const env = createFakeEnv({ authenticated: true });
  const blocked = await worker.fetch(
    adminRequest("/admin/updates/check", {
      method: "POST",
      headers: { Origin: "https://evil.example" }
    }),
    env,
    createExecutionContext()
  );
  assert.equal(blocked.status, 403);

  const missingSource = await worker.fetch(
    adminRequest("/admin/updates/check", { method: "POST" }),
    env,
    createExecutionContext()
  );
  assert.equal(missingSource.status, 303);
  assert.equal(missingSource.headers.get("Location"), "/admin?notice=update-source-missing");
});

test("admin update check fetches release metadata without mutating deploy state", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [
      { key: "update_source_url", value: "https://github.com/example/glyph", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "update_channel", value: "stable", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "auto_update_enabled", value: "false", updated_at: "2026-05-08T12:00:00.000Z" }
    ]
  });
  const requestedUrls: string[] = [];

  await withMockedFetch(
    async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          tag_name: "v0.10.0",
          name: "Glyph 0.10.0",
          body: "## Changes\n\n- Safer updates\n- Escaped <script>alert(1)</script>",
          html_url: "https://github.com/example/glyph/releases/tag/v0.10.0",
          published_at: "2026-05-08T12:00:00.000Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    async () => {
      const response = await worker.fetch(
        adminRequest("/admin/updates/check", { method: "POST" }),
        env,
        createExecutionContext()
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.deepEqual(requestedUrls, ["https://api.github.com/repos/example/glyph/releases/latest"]);
      assert.match(body, /A newer release is available: v0\.10\.0/);
      assert.match(body, /Glyph 0\.10\.0/);
      assert.match(body, /Current<\/span>/);
      assert.match(body, /0\.1\.2/);
      assert.match(body, /Latest<\/span>/);
      assert.match(body, /v0\.10\.0/);
      assert.match(body, /aria-label="Release notes"/);
      assert.match(body, /Escaped &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
      assert.match(body, /aria-label="Manual update workflow"/);
      assert.match(body, /pnpm run release:check/);
      assert.match(body, /This admin page does not deploy, apply migrations, restart the Worker, mutate code, or store GitHub tokens\./);
      assert.match(body, /Open release/);
      assert.deepEqual(env.settingsUpdates, []);
    }
  );
});

test("admin beta update check reads the newest release list entry", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [
      { key: "update_source_url", value: "https://github.com/example/glyph", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "update_channel", value: "beta", updated_at: "2026-05-08T12:00:00.000Z" }
    ]
  });
  const requestedUrls: string[] = [];

  await withMockedFetch(
    async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify([{ tag_name: "v0.1.0", html_url: "https://github.com/example/glyph/releases/tag/v0.1.0" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    },
    async () => {
      const response = await worker.fetch(
        adminRequest("/admin/updates/check", { method: "POST" }),
        env,
        createExecutionContext()
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.deepEqual(requestedUrls, ["https://api.github.com/repos/example/glyph/releases?per_page=1"]);
      assert.match(body, /This deployment is current for beta/);
    }
  );
});

test("admin update check treats older semver releases as not newer", async () => {
  const env = createFakeEnv({
    authenticated: true,
    appSettings: [
      { key: "update_source_url", value: "https://github.com/example/glyph", updated_at: "2026-05-08T12:00:00.000Z" },
      { key: "update_channel", value: "stable", updated_at: "2026-05-08T12:00:00.000Z" }
    ]
  });

  await withMockedFetch(
    async () =>
      new Response(JSON.stringify({ tag_name: "v0.0.9", name: "Glyph 0.0.9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }),
    async () => {
      const response = await worker.fetch(
        adminRequest("/admin/updates/check", { method: "POST" }),
        env,
        createExecutionContext()
      );
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /This deployment is current for stable/);
      assert.doesNotMatch(body, /A newer release is available/);
    }
  );
});

test("admin R2 cleanup validates origin before touching candidates", async () => {
  const env = createFakeEnv({
    authenticated: true,
    r2CleanupCandidates: [deletedUploadRow]
  });
  const response = await worker.fetch(
    adminRequest("/admin/maintenance/r2-cleanup", {
      method: "POST",
      headers: { Origin: "https://evil.example" }
    }),
    env,
    createExecutionContext()
  );
  const body = await response.text();

  assert.equal(response.status, 403);
  assert.match(body, /Action blocked/);
  assert.deepEqual(env.deletedObjectKeys, []);
  assert.deepEqual(env.r2DeleteRequestedIds, []);
});

test("admin R2 cleanup retries pending deleted and expired object deletes", async () => {
  const env = createFakeEnv({
    authenticated: true,
    r2CleanupCandidates: [
      {
        ...deletedUploadRow,
        id: "deleted123",
        object_key: "uploads/deleted123/archive.zip"
      },
      {
        ...expiredUploadRow,
        id: "expired123",
        object_key: "uploads/expired123/old.txt",
        expired_at: "2026-05-08T03:00:00.000Z"
      }
    ]
  });

  const response = await worker.fetch(
    adminRequest("/admin/maintenance/r2-cleanup", {
      method: "POST",
      headers: { Origin: "https://glyph.example" }
    }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=r2-cleanup-complete");
  assert.deepEqual(env.deletedObjectKeys, ["uploads/deleted123/archive.zip", "uploads/expired123/old.txt"]);
  assert.deepEqual(env.r2DeleteRequestedIds, ["deleted123", "expired123"]);
  assert.deepEqual(env.r2DeleteCompletedIds, ["deleted123", "expired123"]);
  assert.deepEqual(env.r2DeleteFailedUpdates, []);
});

test("admin R2 cleanup records failed object deletes and redirects with partial notice", async () => {
  const env = createFakeEnv({
    authenticated: true,
    r2CleanupCandidates: [deletedUploadRow],
    r2DeleteFailures: ["uploads/deleted123/archive.zip"]
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  let response: Response;
  try {
    response = await worker.fetch(
      adminRequest("/admin/maintenance/r2-cleanup", { method: "POST" }),
      env,
      createExecutionContext()
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=r2-cleanup-partial");
  assert.deepEqual(env.deletedObjectKeys, ["uploads/deleted123/archive.zip"]);
  assert.deepEqual(env.r2DeleteRequestedIds, ["deleted123"]);
  assert.deepEqual(env.r2DeleteCompletedIds, []);
  assert.equal(env.r2DeleteFailedUpdates[0][2], "delete failed");
  assert.equal(env.r2DeleteFailedUpdates[0][3], "deleted123");
});

test("admin R2 cleanup handles no pending candidates", async () => {
  const env = createFakeEnv({
    authenticated: true,
    r2CleanupCandidates: []
  });

  const response = await worker.fetch(
    adminRequest("/admin/maintenance/r2-cleanup", { method: "POST" }),
    env,
    createExecutionContext()
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/admin?notice=r2-cleanup-none");
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
  assert.deepEqual(env.r2DeleteRequestedIds, ["active123"]);
  assert.deepEqual(env.r2DeleteCompletedIds, ["active123"]);
});

test("deleted short links return the polished not-found page", async () => {
  const env = createFakeEnv();

  const response = await worker.fetch(new Request("https://glyph.example/deleted123"), env, createExecutionContext());
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.match(body, /Unavailable link/);
  assert.match(body, /not exist or is no longer available/);
});
