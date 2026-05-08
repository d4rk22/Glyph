import assert from "node:assert/strict";
import test from "node:test";

import {
  createUploadMetadata,
  getAppSettings,
  getPendingDirectUploadByToken,
  getPendingMultipartUploadByToken,
  getR2DeletionCleanupStats,
  getUploadStorageUsage,
  listOldestActiveUploads,
  listUploadsPendingR2Deletion,
  listUploadsDueForExpiration,
  markDirectUploadFailed,
  markDirectUploadStored,
  markMultipartUploadAborted,
  markMultipartUploadFailed,
  markMultipartUploadStored,
  markUploadExpired,
  markUploadR2DeleteCompleted,
  markUploadR2DeleteFailed,
  markUploadR2DeleteRequested,
  setMultipartUploadId,
  setAppSetting,
  updateAppSettings,
  updateUploadExpiration
} from "../src/db.ts";

interface FakeStatementResult {
  first?: unknown;
  all?: unknown[];
}

function createFakeDb(results: FakeStatementResult[] = []): D1Database & {
  bindings: unknown[][];
  queries: string[];
} {
  const bindings: unknown[][] = [];
  const queries: string[] = [];

  return {
    bindings,
    queries,
    prepare(sql: string) {
      queries.push(sql);
      let bound: unknown[] = [];

      return {
        bind(...values: unknown[]) {
          bound = values;
          bindings.push(values);
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async first() {
          const result = results.shift();
          return result?.first ?? null;
        },
        async all() {
          const result = results.shift();
          return { results: result?.all ?? [] };
        }
      };
    }
  } as unknown as D1Database & { bindings: unknown[][]; queries: string[] };
}

test("createUploadMetadata stores v2 expiration and upload mode fields", async () => {
  const db = createFakeDb();
  const createdAt = new Date("2026-05-08T12:00:00.000Z");
  const expiresAt = new Date("2026-05-09T12:00:00.000Z");

  const metadata = await createUploadMetadata(
    db,
    {
      originalFilename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      expiresAt,
      uploadMode: "direct",
      storageState: "pending"
    },
    { now: createdAt }
  );

  assert.equal(metadata.createdAt, createdAt.toISOString());
  assert.equal(metadata.expiresAt, expiresAt.toISOString());
  assert.equal(metadata.expiredAt, null);
  assert.equal(metadata.uploadMode, "direct");
  assert.equal(metadata.storageState, "pending");
  assert.equal(db.bindings[0][6], expiresAt.toISOString());
  assert.equal(db.bindings[0][7], "direct");
  assert.equal(db.bindings[0][8], "pending");
});

test("direct upload helpers store pending token metadata and finalize state", async () => {
  const db = createFakeDb([
    {
      first: {
        id: "direct1",
        object_key: "uploads/direct1/file.txt",
        original_filename: "file.txt",
        content_type: "text/plain",
        size_bytes: 12,
        created_at: "2026-05-08T11:00:00.000Z",
        deleted_at: null,
        expires_at: null,
        expired_at: null,
        upload_mode: "direct",
        storage_state: "pending",
        direct_upload_token_hash: "hashed-token",
        direct_upload_token_expires_at: "2026-05-08T12:15:00.000Z",
        direct_upload_finalized_at: null,
        direct_upload_error: null
      }
    }
  ]);
  const expiresAt = new Date("2026-05-08T12:15:00.000Z");

  const metadata = await createUploadMetadata(db, {
    originalFilename: "file.txt",
    contentType: "text/plain",
    sizeBytes: 12,
    uploadMode: "direct",
    storageState: "pending",
    directUploadTokenHash: "hashed-token",
    directUploadTokenExpiresAt: expiresAt
  });
  const pending = await getPendingDirectUploadByToken(db, "direct1", "hashed-token", new Date("2026-05-08T12:00:00.000Z"));
  assert.equal(await markDirectUploadStored(db, "direct1", new Date("2026-05-08T12:01:00.000Z")), true);
  assert.equal(await markDirectUploadFailed(db, "direct2", "bad size"), true);

  assert.equal(metadata.uploadMode, "direct");
  assert.equal(metadata.storageState, "pending");
  assert.equal(metadata.directUploadTokenExpiresAt, expiresAt.toISOString());
  assert.equal(db.bindings[0][9], "hashed-token");
  assert.equal(db.bindings[0][10], expiresAt.toISOString());
  assert.equal(pending?.id, "direct1");
  assert.match(db.queries[1], /storage_state = 'pending'/);
  assert.deepEqual(db.bindings[2], ["2026-05-08T12:01:00.000Z", "direct1"]);
  assert.deepEqual(db.bindings[3], ["bad size", "direct2"]);
});

test("multipart upload helpers track R2 upload state and terminal transitions", async () => {
  const db = createFakeDb([
    {
      first: {
        id: "multi1",
        object_key: "uploads/multi1/large.bin",
        original_filename: "large.bin",
        content_type: "application/octet-stream",
        size_bytes: 16_777_216,
        created_at: "2026-05-08T11:00:00.000Z",
        deleted_at: null,
        expires_at: null,
        expired_at: null,
        upload_mode: "multipart",
        storage_state: "pending",
        direct_upload_token_hash: "hashed-token",
        direct_upload_token_expires_at: "2026-05-08T12:15:00.000Z",
        direct_upload_finalized_at: null,
        direct_upload_error: null,
        multipart_upload_id: "r2-upload-id",
        multipart_part_size: 8_388_608,
        multipart_part_count: 2,
        multipart_completed_parts: null,
        multipart_aborted_at: null
      }
    }
  ]);
  const expiresAt = new Date("2026-05-08T12:15:00.000Z");

  const metadata = await createUploadMetadata(db, {
    originalFilename: "large.bin",
    contentType: "application/octet-stream",
    sizeBytes: 16_777_216,
    uploadMode: "multipart",
    storageState: "pending",
    directUploadTokenHash: "hashed-token",
    directUploadTokenExpiresAt: expiresAt,
    multipartPartSize: 8_388_608,
    multipartPartCount: 2
  });
  const pending = await getPendingMultipartUploadByToken(db, "multi1", "hashed-token", new Date("2026-05-08T12:00:00.000Z"));
  assert.equal(await setMultipartUploadId(db, "multi1", "r2-upload-id", 8_388_608, 2), true);
  assert.equal(await markMultipartUploadStored(db, "multi1", '[{"partNumber":1,"etag":"one"}]', new Date("2026-05-08T12:01:00.000Z")), true);
  assert.equal(await markMultipartUploadFailed(db, "multi2", "complete failed"), true);
  assert.equal(await markMultipartUploadAborted(db, "multi3", new Date("2026-05-08T12:02:00.000Z")), true);

  assert.equal(metadata.uploadMode, "multipart");
  assert.equal(metadata.storageState, "pending");
  assert.equal(metadata.multipartPartSize, 8_388_608);
  assert.equal(metadata.multipartPartCount, 2);
  assert.equal(db.bindings[0][7], "multipart");
  assert.equal(db.bindings[0][13], 8_388_608);
  assert.equal(db.bindings[0][14], 2);
  assert.equal(pending?.id, "multi1");
  assert.equal(pending?.multipartUploadId, "r2-upload-id");
  assert.match(db.queries[1], /upload_mode = 'multipart'/);
  assert.deepEqual(db.bindings[2], ["r2-upload-id", 8_388_608, 2, "multi1"]);
  assert.deepEqual(db.bindings[3], ["2026-05-08T12:01:00.000Z", '[{"partNumber":1,"etag":"one"}]', "multi1"]);
  assert.deepEqual(db.bindings[4], ["complete failed", "multi2"]);
  assert.deepEqual(db.bindings[5], ["2026-05-08T12:02:00.000Z", "multi3"]);
});

test("expiration helpers update and list expiration metadata", async () => {
  const dueAt = "2026-05-08T12:00:00.000Z";
  const db = createFakeDb([
    {
      all: [
        {
          id: "upload1",
          object_key: "uploads/upload1/file.txt",
          original_filename: "file.txt",
          content_type: "text/plain",
          size_bytes: 12,
          created_at: "2026-05-08T11:00:00.000Z",
          deleted_at: null,
          expires_at: dueAt,
          expired_at: null,
          upload_mode: "worker",
          storage_state: "stored"
        }
      ]
    }
  ]);

  assert.equal(await updateUploadExpiration(db, "upload1", dueAt), true);
  assert.equal(await markUploadExpired(db, "upload1", new Date(dueAt)), true);
  assert.match(db.queries[0], /r2_delete_completed_at IS NULL/);

  const due = await listUploadsDueForExpiration(db, new Date("2026-05-08T13:00:00.000Z"));

  assert.equal(due.length, 1);
  assert.equal(due[0].id, "upload1");
  assert.equal(due[0].expiresAt, dueAt);
});

test("oldest active upload helper excludes inactive uploads at query time", async () => {
  const db = createFakeDb([
    {
      all: [
        {
          id: "oldest",
          object_key: "uploads/oldest/file.txt",
          original_filename: "file.txt",
          content_type: "text/plain",
          size_bytes: 12,
          created_at: "2026-05-08T09:00:00.000Z",
          deleted_at: null,
          expires_at: null,
          expired_at: null,
          upload_mode: "worker",
          storage_state: "stored"
        }
      ]
    }
  ]);

  const uploads = await listOldestActiveUploads(db, new Date("2026-05-08T12:00:00.000Z"), 25);

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].id, "oldest");
  assert.equal(db.bindings[0][0], "2026-05-08T12:00:00.000Z");
  assert.equal(db.bindings[0][1], 25);
  assert.match(db.queries[0], /deleted_at IS NULL/);
  assert.match(db.queries[0], /expired_at IS NULL/);
  assert.match(db.queries[0], /ORDER BY created_at ASC/);
});

test("R2 cleanup helpers select pending expired or deleted uploads", async () => {
  const db = createFakeDb([
    {
      all: [
        {
          id: "deleted1",
          object_key: "uploads/deleted1/file.txt",
          original_filename: "file.txt",
          content_type: "text/plain",
          size_bytes: 12,
          created_at: "2026-05-08T09:00:00.000Z",
          deleted_at: "2026-05-08T10:00:00.000Z",
          expires_at: null,
          expired_at: null,
          upload_mode: "worker",
          storage_state: "deleted",
          r2_delete_requested_at: "2026-05-08T10:00:00.000Z",
          r2_delete_completed_at: null,
          r2_delete_failed_at: "2026-05-08T10:01:00.000Z",
          r2_delete_error: "temporary failure"
        }
      ]
    },
    {
      first: {
        pending_count: 2,
        failed_count: 1,
        completed_count: 3
      }
    }
  ]);

  const pending = await listUploadsPendingR2Deletion(db, new Date("2026-05-08T12:00:00.000Z"), 10);
  const stats = await getR2DeletionCleanupStats(db, new Date("2026-05-08T12:00:00.000Z"));

  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "deleted1");
  assert.equal(pending[0].r2DeleteFailedAt, "2026-05-08T10:01:00.000Z");
  assert.equal(pending[0].r2DeleteError, "temporary failure");
  assert.deepEqual(db.bindings[0], ["2026-05-08T12:00:00.000Z", 10]);
  assert.match(db.queries[0], /r2_delete_completed_at IS NULL/);
  assert.match(db.queries[0], /deleted_at IS NOT NULL/);
  assert.deepEqual(stats, {
    pendingCount: 2,
    failedCount: 1,
    completedCount: 3
  });
});

test("R2 deletion state helpers record requested, completed, and failed cleanup", async () => {
  const db = createFakeDb();
  const now = new Date("2026-05-08T12:00:00.000Z");

  assert.equal(await markUploadR2DeleteRequested(db, "upload1", now), true);
  assert.equal(await markUploadR2DeleteCompleted(db, "upload1", now), true);
  assert.equal(await markUploadR2DeleteFailed(db, "upload2", "object delete failed", now), true);

  assert.deepEqual(db.bindings[0], ["2026-05-08T12:00:00.000Z", "upload1"]);
  assert.deepEqual(db.bindings[1], ["2026-05-08T12:00:00.000Z", "2026-05-08T12:00:00.000Z", "upload1"]);
  assert.deepEqual(db.bindings[2], ["2026-05-08T12:00:00.000Z", "2026-05-08T12:00:00.000Z", "object delete failed", "upload2"]);
});

test("app settings helpers parse defaults and typed values", async () => {
  const db = createFakeDb([
    {
      all: [
        { key: "storage_cap_bytes", value: "10737418240", updated_at: "2026-05-08T12:00:00.000Z" },
        { key: "default_upload_ttl_seconds", value: "604800", updated_at: "2026-05-08T12:00:00.000Z" },
        { key: "upload_mode", value: "multipart", updated_at: "2026-05-08T12:00:00.000Z" }
      ]
    },
    {
      all: [
        { key: "storage_cap_bytes", value: "", updated_at: "2026-05-08T12:00:00.000Z" },
        { key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }
      ]
    }
  ]);

  assert.deepEqual(await getAppSettings(db), {
    storageCapBytes: 10_737_418_240,
    defaultUploadTtlSeconds: 604_800,
    uploadMode: "multipart"
  });

  assert.deepEqual(await getAppSettings(db), {
    storageCapBytes: null,
    defaultUploadTtlSeconds: null,
    uploadMode: "direct"
  });
});

test("app settings helpers validate and persist known setting keys", async () => {
  const db = createFakeDb([{ all: [{ key: "upload_mode", value: "direct", updated_at: "2026-05-08T12:00:00.000Z" }] }]);

  const setting = await setAppSetting(db, "storage_cap_bytes", "1024", new Date("2026-05-08T12:00:00.000Z"));
  assert.equal(setting.key, "storage_cap_bytes");
  assert.equal(setting.value, "1024");

  const settings = await updateAppSettings(db, {
    storageCapBytes: null,
    defaultUploadTtlSeconds: 3600,
    uploadMode: "direct"
  });

  assert.equal(settings.uploadMode, "direct");
  assert.deepEqual(
    db.bindings.map((binding) => binding.slice(0, 2)),
    [
      ["storage_cap_bytes", "1024"],
      ["storage_cap_bytes", ""],
      ["default_upload_ttl_seconds", "3600"],
      ["upload_mode", "direct"]
    ]
  );
  await assert.rejects(() => setAppSetting(db, "upload_mode", "invalid"));
});

test("storage usage helper maps aggregate counters", async () => {
  const db = createFakeDb([
    {
      first: {
        active_bytes: 1200,
        active_count: 2,
        expired_bytes: 300,
        expired_count: 1,
        deleted_bytes: 400,
        deleted_count: 1,
        total_bytes: 1900,
        total_count: 4
      }
    }
  ]);

  assert.deepEqual(await getUploadStorageUsage(db, new Date("2026-05-08T12:00:00.000Z")), {
    activeBytes: 1200,
    activeCount: 2,
    expiredBytes: 300,
    expiredCount: 1,
    deletedBytes: 400,
    deletedCount: 1,
    totalBytes: 1900,
    totalCount: 4
  });
  assert.deepEqual(db.bindings[0], [
    "2026-05-08T12:00:00.000Z",
    "2026-05-08T12:00:00.000Z",
    "2026-05-08T12:00:00.000Z",
    "2026-05-08T12:00:00.000Z"
  ]);
});
