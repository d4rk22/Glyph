import assert from "node:assert/strict";
import test from "node:test";

import {
  createUploadMetadata,
  getAppSettings,
  getUploadStorageUsage,
  listUploadsDueForExpiration,
  markUploadExpired,
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

  const due = await listUploadsDueForExpiration(db, new Date("2026-05-08T13:00:00.000Z"));

  assert.equal(due.length, 1);
  assert.equal(due[0].id, "upload1");
  assert.equal(due[0].expiresAt, dueAt);
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
        deleted_count: 1
      }
    }
  ]);

  assert.deepEqual(await getUploadStorageUsage(db), {
    activeBytes: 1200,
    activeCount: 2,
    expiredBytes: 300,
    expiredCount: 1,
    deletedBytes: 400,
    deletedCount: 1
  });
});
