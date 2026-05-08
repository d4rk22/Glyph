import { DEFAULT_SHORT_ID_LENGTH, generateShortId, sanitizeObjectName } from "./ids.ts";
import type { WebAuthnChallengePurpose } from "./auth.ts";

const DEFAULT_MAX_ID_ATTEMPTS = 8;
const SESSION_TOKEN_BYTES = 32;

export type UploadMode = "worker" | "direct" | "multipart";
export type UploadStorageState = "pending" | "stored" | "deleted" | "expired" | "failed";
export type AppSettingKey = "storage_cap_bytes" | "default_upload_ttl_seconds" | "upload_mode";

export interface UploadMetadata {
  id: string;
  objectKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
  expiresAt: string | null;
  expiredAt: string | null;
  uploadMode: UploadMode;
  storageState: UploadStorageState;
  r2DeleteRequestedAt: string | null;
  r2DeleteCompletedAt: string | null;
  r2DeleteFailedAt: string | null;
  r2DeleteError: string | null;
  directUploadTokenExpiresAt: string | null;
  directUploadFinalizedAt: string | null;
  directUploadError: string | null;
  multipartUploadId: string | null;
  multipartPartSize: number | null;
  multipartPartCount: number | null;
  multipartCompletedParts: string | null;
  multipartAbortedAt: string | null;
}

export interface CreateUploadMetadataInput {
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  objectKey?: string;
  expiresAt?: Date | string | null;
  uploadMode?: UploadMode;
  storageState?: UploadStorageState;
  directUploadTokenHash?: string | null;
  directUploadTokenExpiresAt?: Date | string | null;
  directUploadError?: string | null;
  multipartUploadId?: string | null;
  multipartPartSize?: number | null;
  multipartPartCount?: number | null;
  multipartCompletedParts?: string | null;
}

export interface CreateUploadMetadataOptions {
  idLength?: number;
  maxAttempts?: number;
  now?: Date;
}

interface UploadRow {
  id: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
  expires_at?: string | null;
  expired_at?: string | null;
  upload_mode?: string | null;
  storage_state?: string | null;
  r2_delete_requested_at?: string | null;
  r2_delete_completed_at?: string | null;
  r2_delete_failed_at?: string | null;
  r2_delete_error?: string | null;
  direct_upload_token_hash?: string | null;
  direct_upload_token_expires_at?: string | null;
  direct_upload_finalized_at?: string | null;
  direct_upload_error?: string | null;
  multipart_upload_id?: string | null;
  multipart_part_size?: number | null;
  multipart_part_count?: number | null;
  multipart_completed_parts?: string | null;
  multipart_aborted_at?: string | null;
}

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface AppSetting {
  key: AppSettingKey;
  value: string;
  updatedAt: string;
}

export interface AppSettings {
  storageCapBytes: number | null;
  defaultUploadTtlSeconds: number | null;
  uploadMode: UploadMode;
}

export interface StorageUsage {
  activeBytes: number;
  activeCount: number;
  expiredBytes: number;
  expiredCount: number;
  deletedBytes: number;
  deletedCount: number;
  totalBytes: number;
  totalCount: number;
}

export interface R2DeletionCleanupStats {
  pendingCount: number;
  failedCount: number;
  completedCount: number;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateAdminUserInput {
  id?: string;
  username: string;
  displayName?: string | null;
  now?: Date;
}

interface AdminUserRow {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface WebAuthnCredential {
  id: string;
  adminUserId: string;
  credentialId: string;
  publicKey: string;
  signatureCounter: number;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateWebAuthnCredentialInput {
  id?: string;
  adminUserId: string;
  credentialId: string;
  publicKey: string;
  signatureCounter?: number;
  transports?: string[];
  now?: Date;
}

interface WebAuthnCredentialRow {
  id: string;
  admin_user_id: string;
  credential_id: string;
  public_key: string;
  signature_counter: number;
  transports: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AdminSession {
  id: string;
  adminUserId: string;
  sessionHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface WebAuthnChallenge {
  id: string;
  challenge: string;
  purpose: WebAuthnChallengePurpose;
  adminUserId: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface CreateWebAuthnChallengeInput {
  id?: string;
  challenge: string;
  purpose: WebAuthnChallengePurpose;
  adminUserId?: string | null;
  username?: string | null;
  displayName?: string | null;
  expiresAt: Date;
  now?: Date;
}

interface WebAuthnChallengeRow {
  id: string;
  challenge: string;
  purpose: WebAuthnChallengePurpose;
  admin_user_id: string | null;
  username: string | null;
  display_name: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface CreateAdminSessionInput {
  id?: string;
  adminUserId: string;
  expiresAt: Date;
  now?: Date;
}

export interface CreatedAdminSession {
  token: string;
  session: AdminSession;
}

interface AdminSessionRow {
  id: string;
  admin_user_id: string;
  session_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export async function createUploadMetadata(
  db: D1Database,
  input: CreateUploadMetadataInput,
  options: CreateUploadMetadataOptions = {}
): Promise<UploadMetadata> {
  assertValidUploadInput(input);

  const idLength = options.idLength ?? DEFAULT_SHORT_ID_LENGTH;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ID_ATTEMPTS;
  const createdAt = iso(options.now);
  const expiresAt = optionalIso(input.expiresAt);
  const uploadMode = input.uploadMode ?? "worker";
  const storageState = input.storageState ?? "stored";
  const directUploadTokenExpiresAt = optionalIso(input.directUploadTokenExpiresAt);
  const directUploadTokenHash = input.directUploadTokenHash ?? null;
  const directUploadError = input.directUploadError ?? null;
  const multipartUploadId = input.multipartUploadId ?? null;
  const multipartPartSize = input.multipartPartSize ?? null;
  const multipartPartCount = input.multipartPartCount ?? null;
  const multipartCompletedParts = input.multipartCompletedParts ?? null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generateShortId(idLength);
    const objectKey = input.objectKey ?? buildUploadObjectKey(id, input.originalFilename);

    try {
      await db
        .prepare(
          `INSERT INTO uploads (
            id,
            object_key,
            original_filename,
            content_type,
            size_bytes,
            created_at,
            expires_at,
            upload_mode,
            storage_state,
            direct_upload_token_hash,
            direct_upload_token_expires_at,
            direct_upload_error,
            multipart_upload_id,
            multipart_part_size,
            multipart_part_count,
            multipart_completed_parts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          objectKey,
          input.originalFilename,
          input.contentType,
          input.sizeBytes,
          createdAt,
          expiresAt,
          uploadMode,
          storageState,
          directUploadTokenHash,
          directUploadTokenExpiresAt,
          directUploadError,
          multipartUploadId,
          multipartPartSize,
          multipartPartCount,
          multipartCompletedParts
        )
        .run();

      return {
        id,
        objectKey,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        createdAt,
        deletedAt: null,
        expiresAt,
        expiredAt: null,
        uploadMode,
        storageState,
        r2DeleteRequestedAt: null,
        r2DeleteCompletedAt: null,
        r2DeleteFailedAt: null,
        r2DeleteError: null,
        directUploadTokenExpiresAt,
        directUploadFinalizedAt: null,
        directUploadError,
        multipartUploadId,
        multipartPartSize,
        multipartPartCount,
        multipartCompletedParts,
        multipartAbortedAt: null
      };
    } catch (error) {
      if (
        input.objectKey === undefined &&
        (isUniqueConstraintFor(error, "uploads.id") || isUniqueConstraintFor(error, "uploads.object_key"))
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not allocate a unique upload ID after ${maxAttempts} attempts.`);
}

export async function getUploadMetadata(db: D1Database, id: string): Promise<UploadMetadata | null> {
  const row = await db.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first<UploadRow>();
  return row ? mapUpload(row) : null;
}

export async function getActiveUploadMetadata(db: D1Database, id: string): Promise<UploadMetadata | null> {
  const row = await db
    .prepare("SELECT * FROM uploads WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<UploadRow>();

  return row ? mapUpload(row) : null;
}

export async function getPendingDirectUploadByToken(
  db: D1Database,
  id: string,
  tokenHash: string,
  now = new Date()
): Promise<UploadMetadata | null> {
  const row = await db
    .prepare(
      `SELECT *
        FROM uploads
        WHERE id = ?
          AND direct_upload_token_hash = ?
          AND upload_mode = 'direct'
          AND storage_state = 'pending'
          AND deleted_at IS NULL
          AND direct_upload_token_expires_at > ?`
    )
    .bind(id, tokenHash, now.toISOString())
    .first<UploadRow>();

  return row ? mapUpload(row) : null;
}

export async function getPendingMultipartUploadByToken(
  db: D1Database,
  id: string,
  tokenHash: string,
  now = new Date()
): Promise<UploadMetadata | null> {
  const row = await db
    .prepare(
      `SELECT *
        FROM uploads
        WHERE id = ?
          AND direct_upload_token_hash = ?
          AND upload_mode = 'multipart'
          AND storage_state = 'pending'
          AND deleted_at IS NULL
          AND direct_upload_token_expires_at > ?
          AND multipart_upload_id IS NOT NULL
          AND multipart_aborted_at IS NULL`
    )
    .bind(id, tokenHash, now.toISOString())
    .first<UploadRow>();

  return row ? mapUpload(row) : null;
}

export async function setMultipartUploadId(
  db: D1Database,
  id: string,
  multipartUploadId: string,
  partSize: number,
  partCount: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET multipart_upload_id = ?,
          multipart_part_size = ?,
          multipart_part_count = ?
        WHERE id = ?
          AND upload_mode = 'multipart'
          AND storage_state = 'pending'
          AND deleted_at IS NULL
          AND multipart_aborted_at IS NULL`
    )
    .bind(multipartUploadId, partSize, partCount, id)
    .run();

  return result.meta.changes > 0;
}

export async function listUploadMetadata(
  db: D1Database,
  options: { includeDeleted?: boolean; limit?: number; offset?: number } = {}
): Promise<UploadMetadata[]> {
  const includeDeleted = options.includeDeleted ?? false;
  const limit = clampLimit(options.limit ?? 50);
  const offset = Math.max(0, options.offset ?? 0);
  const where = includeDeleted ? "" : "WHERE deleted_at IS NULL";
  const rows = await db
    .prepare(`SELECT * FROM uploads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<UploadRow>();

  return rows.results.map(mapUpload);
}

export async function markUploadDeleted(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare("UPDATE uploads SET deleted_at = ?, storage_state = 'deleted' WHERE id = ? AND deleted_at IS NULL")
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function updateUploadExpiration(
  db: D1Database,
  id: string,
  expiresAt: Date | string | null
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET expires_at = ?,
          expired_at = NULL,
          storage_state = CASE
            WHEN deleted_at IS NULL THEN 'stored'
            ELSE storage_state
          END
        WHERE id = ?
          AND r2_delete_completed_at IS NULL`
    )
    .bind(optionalIso(expiresAt), id)
    .run();

  return result.meta.changes > 0;
}

export async function markUploadExpired(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET expired_at = ?, storage_state = 'expired'
        WHERE id = ?
          AND expired_at IS NULL
          AND deleted_at IS NULL`
    )
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function markDirectUploadStored(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET storage_state = 'stored',
          direct_upload_token_hash = NULL,
          direct_upload_token_expires_at = NULL,
          direct_upload_finalized_at = ?,
          direct_upload_error = NULL
        WHERE id = ?
          AND upload_mode = 'direct'
          AND storage_state = 'pending'
          AND deleted_at IS NULL`
    )
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function markMultipartUploadStored(
  db: D1Database,
  id: string,
  completedParts: string,
  now = new Date()
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET storage_state = 'stored',
          direct_upload_token_hash = NULL,
          direct_upload_token_expires_at = NULL,
          direct_upload_finalized_at = ?,
          direct_upload_error = NULL,
          multipart_completed_parts = ?
        WHERE id = ?
          AND upload_mode = 'multipart'
          AND storage_state = 'pending'
          AND deleted_at IS NULL
          AND multipart_aborted_at IS NULL`
    )
    .bind(now.toISOString(), completedParts, id)
    .run();

  return result.meta.changes > 0;
}

export async function markDirectUploadFailed(db: D1Database, id: string, error: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET storage_state = 'failed',
          direct_upload_token_hash = NULL,
          direct_upload_token_expires_at = NULL,
          direct_upload_error = ?
        WHERE id = ?
          AND upload_mode = 'direct'
          AND storage_state = 'pending'
          AND deleted_at IS NULL`
    )
    .bind(error.slice(0, 500), id)
    .run();

  return result.meta.changes > 0;
}

export async function markMultipartUploadFailed(db: D1Database, id: string, error: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET storage_state = 'failed',
          direct_upload_token_hash = NULL,
          direct_upload_token_expires_at = NULL,
          direct_upload_error = ?
        WHERE id = ?
          AND upload_mode = 'multipart'
          AND storage_state = 'pending'
          AND deleted_at IS NULL`
    )
    .bind(error.slice(0, 500), id)
    .run();

  return result.meta.changes > 0;
}

export async function markMultipartUploadAborted(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET storage_state = 'failed',
          direct_upload_token_hash = NULL,
          direct_upload_token_expires_at = NULL,
          direct_upload_error = 'Multipart upload aborted.',
          multipart_aborted_at = ?
        WHERE id = ?
          AND upload_mode = 'multipart'
          AND storage_state = 'pending'
          AND deleted_at IS NULL`
    )
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function listUploadsDueForExpiration(db: D1Database, now = new Date(), limit = 50): Promise<UploadMetadata[]> {
  const rows = await db
    .prepare(
      `SELECT *
        FROM uploads
        WHERE deleted_at IS NULL
          AND expired_at IS NULL
          AND expires_at IS NOT NULL
          AND expires_at <= ?
        ORDER BY expires_at ASC
        LIMIT ?`
    )
    .bind(now.toISOString(), clampLimit(limit))
    .all<UploadRow>();

  return rows.results.map(mapUpload);
}

export async function listOldestActiveUploads(db: D1Database, now = new Date(), limit = 50): Promise<UploadMetadata[]> {
  const rows = await db
    .prepare(
      `SELECT *
        FROM uploads
        WHERE deleted_at IS NULL
          AND expired_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at ASC
        LIMIT ?`
    )
    .bind(now.toISOString(), clampLimit(limit))
    .all<UploadRow>();

  return rows.results.map(mapUpload);
}

export async function listUploadsPendingR2Deletion(db: D1Database, now = new Date(), limit = 50): Promise<UploadMetadata[]> {
  const rows = await db
    .prepare(
      `SELECT *
        FROM uploads
        WHERE r2_delete_completed_at IS NULL
          AND (
            deleted_at IS NOT NULL
            OR expired_at IS NOT NULL
            OR (expires_at IS NOT NULL AND expires_at <= ?)
          )
        ORDER BY COALESCE(deleted_at, expired_at, expires_at, created_at) ASC
        LIMIT ?`
    )
    .bind(now.toISOString(), clampLimit(limit))
    .all<UploadRow>();

  return rows.results.map(mapUpload);
}

export async function getR2DeletionCleanupStats(db: D1Database, now = new Date()): Promise<R2DeletionCleanupStats> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE
          WHEN r2_delete_completed_at IS NULL
            AND (deleted_at IS NOT NULL OR expired_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?))
          THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE
          WHEN r2_delete_completed_at IS NULL
            AND r2_delete_failed_at IS NOT NULL
            AND (deleted_at IS NOT NULL OR expired_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?))
          THEN 1 ELSE 0 END), 0) AS failed_count,
        COALESCE(SUM(CASE WHEN r2_delete_completed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed_count
        FROM uploads`
    )
    .bind(nowIso, nowIso)
    .first<{
      pending_count: number;
      failed_count: number;
      completed_count: number;
    }>();

  return {
    pendingCount: row?.pending_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    completedCount: row?.completed_count ?? 0
  };
}

export async function markUploadR2DeleteRequested(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploads
        SET r2_delete_requested_at = ?,
          r2_delete_failed_at = NULL,
          r2_delete_error = NULL
        WHERE id = ?
          AND r2_delete_completed_at IS NULL`
    )
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function markUploadR2DeleteCompleted(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const completedAt = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE uploads
        SET r2_delete_requested_at = COALESCE(r2_delete_requested_at, ?),
          r2_delete_completed_at = ?,
          r2_delete_failed_at = NULL,
          r2_delete_error = NULL
        WHERE id = ?`
    )
    .bind(completedAt, completedAt, id)
    .run();

  return result.meta.changes > 0;
}

export async function markUploadR2DeleteFailed(
  db: D1Database,
  id: string,
  error: string,
  now = new Date()
): Promise<boolean> {
  const failedAt = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE uploads
        SET r2_delete_requested_at = COALESCE(r2_delete_requested_at, ?),
          r2_delete_failed_at = ?,
          r2_delete_error = ?
        WHERE id = ?
          AND r2_delete_completed_at IS NULL`
    )
    .bind(failedAt, failedAt, error.slice(0, 500), id)
    .run();

  return result.meta.changes > 0;
}

export async function getUploadStorageUsage(db: D1Database, now = new Date()): Promise<StorageUsage> {
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND expired_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN size_bytes ELSE 0 END), 0) AS active_bytes,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND expired_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END), 0) AS active_count,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND (expired_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?)) THEN size_bytes ELSE 0 END), 0) AS expired_bytes,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND (expired_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?)) THEN 1 ELSE 0 END), 0) AS expired_count,
        COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN size_bytes ELSE 0 END), 0) AS deleted_bytes,
        COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS deleted_count,
        COALESCE(SUM(size_bytes), 0) AS total_bytes,
        COUNT(*) AS total_count
        FROM uploads`
    )
    .bind(nowIso, nowIso, nowIso, nowIso)
    .first<{
      active_bytes: number;
      active_count: number;
      expired_bytes: number;
      expired_count: number;
      deleted_bytes: number;
      deleted_count: number;
      total_bytes: number;
      total_count: number;
    }>();

  return {
    activeBytes: row?.active_bytes ?? 0,
    activeCount: row?.active_count ?? 0,
    expiredBytes: row?.expired_bytes ?? 0,
    expiredCount: row?.expired_count ?? 0,
    deletedBytes: row?.deleted_bytes ?? 0,
    deletedCount: row?.deleted_count ?? 0,
    totalBytes: row?.total_bytes ?? 0,
    totalCount: row?.total_count ?? 0
  };
}

export async function deleteUploadMetadata(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function getAppSetting(db: D1Database, key: AppSettingKey): Promise<AppSetting | null> {
  const row = await db.prepare("SELECT * FROM app_settings WHERE key = ?").bind(key).first<AppSettingRow>();
  return row ? mapAppSetting(row) : null;
}

export async function setAppSetting(db: D1Database, key: AppSettingKey, value: string, now = new Date()): Promise<AppSetting> {
  validateAppSetting(key, value);

  const updatedAt = now.toISOString();
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value, updatedAt)
    .run();

  return { key, value, updatedAt };
}

export async function getAppSettings(db: D1Database): Promise<AppSettings> {
  const rows = await db.prepare("SELECT * FROM app_settings").all<AppSettingRow>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));

  return {
    storageCapBytes: parseNullableIntegerSetting(values.get("storage_cap_bytes")),
    defaultUploadTtlSeconds: parseNullableIntegerSetting(values.get("default_upload_ttl_seconds")),
    uploadMode: parseUploadMode(values.get("upload_mode"))
  };
}

export async function updateAppSettings(
  db: D1Database,
  settings: Partial<{
    storageCapBytes: number | null;
    defaultUploadTtlSeconds: number | null;
    uploadMode: UploadMode;
  }>,
  now = new Date()
): Promise<AppSettings> {
  if ("storageCapBytes" in settings) {
    await setAppSetting(db, "storage_cap_bytes", stringifyNullableIntegerSetting(settings.storageCapBytes), now);
  }

  if ("defaultUploadTtlSeconds" in settings) {
    await setAppSetting(
      db,
      "default_upload_ttl_seconds",
      stringifyNullableIntegerSetting(settings.defaultUploadTtlSeconds),
      now
    );
  }

  if (settings.uploadMode !== undefined) {
    await setAppSetting(db, "upload_mode", settings.uploadMode, now);
  }

  return getAppSettings(db);
}

export async function createAdminUser(db: D1Database, input: CreateAdminUserInput): Promise<AdminUser> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = iso(input.now);
  const displayName = input.displayName ?? null;

  await db
    .prepare(
      `INSERT INTO admin_users (
        id,
        username,
        display_name,
        created_at
      ) VALUES (?, ?, ?, ?)`
    )
    .bind(id, input.username, displayName, createdAt)
    .run();

  return {
    id,
    username: input.username,
    displayName,
    createdAt,
    lastLoginAt: null
  };
}

export async function countAdminUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getAdminUserById(db: D1Database, id: string): Promise<AdminUser | null> {
  const row = await db.prepare("SELECT * FROM admin_users WHERE id = ?").bind(id).first<AdminUserRow>();
  return row ? mapAdminUser(row) : null;
}

export async function getAdminUserByUsername(db: D1Database, username: string): Promise<AdminUser | null> {
  const row = await db
    .prepare("SELECT * FROM admin_users WHERE username = ?")
    .bind(username)
    .first<AdminUserRow>();

  return row ? mapAdminUser(row) : null;
}

export async function deleteAdminUser(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM admin_users WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function touchAdminUserLogin(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?")
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function createWebAuthnCredential(
  db: D1Database,
  input: CreateWebAuthnCredentialInput
): Promise<WebAuthnCredential> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = iso(input.now);
  const signatureCounter = input.signatureCounter ?? 0;
  const transports = input.transports ?? [];

  await db
    .prepare(
      `INSERT INTO webauthn_credentials (
        id,
        admin_user_id,
        credential_id,
        public_key,
        signature_counter,
        transports,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.adminUserId,
      input.credentialId,
      input.publicKey,
      signatureCounter,
      JSON.stringify(transports),
      createdAt
    )
    .run();

  return {
    id,
    adminUserId: input.adminUserId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    signatureCounter,
    transports,
    createdAt,
    lastUsedAt: null
  };
}

export async function getWebAuthnCredentialByCredentialId(
  db: D1Database,
  credentialId: string
): Promise<WebAuthnCredential | null> {
  const row = await db
    .prepare("SELECT * FROM webauthn_credentials WHERE credential_id = ?")
    .bind(credentialId)
    .first<WebAuthnCredentialRow>();

  return row ? mapWebAuthnCredential(row) : null;
}

export async function listWebAuthnCredentialsForAdminUser(
  db: D1Database,
  adminUserId: string
): Promise<WebAuthnCredential[]> {
  const rows = await db
    .prepare("SELECT * FROM webauthn_credentials WHERE admin_user_id = ? ORDER BY created_at ASC")
    .bind(adminUserId)
    .all<WebAuthnCredentialRow>();

  return rows.results.map(mapWebAuthnCredential);
}

export async function listWebAuthnCredentials(db: D1Database): Promise<WebAuthnCredential[]> {
  const rows = await db
    .prepare("SELECT * FROM webauthn_credentials ORDER BY created_at ASC")
    .all<WebAuthnCredentialRow>();

  return rows.results.map(mapWebAuthnCredential);
}

export async function updateWebAuthnCredentialUse(
  db: D1Database,
  credentialId: string,
  signatureCounter: number,
  now = new Date()
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE webauthn_credentials
        SET signature_counter = ?, last_used_at = ?
        WHERE credential_id = ?`
    )
    .bind(signatureCounter, now.toISOString(), credentialId)
    .run();

  return result.meta.changes > 0;
}

export async function deleteWebAuthnCredential(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM webauthn_credentials WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function createAdminSession(
  db: D1Database,
  input: CreateAdminSessionInput
): Promise<CreatedAdminSession> {
  const id = input.id ?? crypto.randomUUID();
  const token = generateSessionToken();
  const sessionHash = await hashSessionToken(token);
  const createdAt = iso(input.now);
  const expiresAt = input.expiresAt.toISOString();

  await db
    .prepare(
      `INSERT INTO admin_sessions (
        id,
        admin_user_id,
        session_hash,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, input.adminUserId, sessionHash, createdAt, expiresAt)
    .run();

  return {
    token,
    session: {
      id,
      adminUserId: input.adminUserId,
      sessionHash,
      createdAt,
      expiresAt,
      revokedAt: null
    }
  };
}

export async function getActiveAdminSessionByToken(
  db: D1Database,
  token: string,
  now = new Date()
): Promise<AdminSession | null> {
  const sessionHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      `SELECT *
        FROM admin_sessions
        WHERE session_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?`
    )
    .bind(sessionHash, now.toISOString())
    .first<AdminSessionRow>();

  return row ? mapAdminSession(row) : null;
}

export async function revokeAdminSession(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare("UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function createWebAuthnChallenge(
  db: D1Database,
  input: CreateWebAuthnChallengeInput
): Promise<WebAuthnChallenge> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = iso(input.now);
  const expiresAt = input.expiresAt.toISOString();
  const adminUserId = input.adminUserId ?? null;
  const username = input.username ?? null;
  const displayName = input.displayName ?? null;

  await db
    .prepare(
      `INSERT INTO webauthn_challenges (
        id,
        challenge,
        purpose,
        admin_user_id,
        username,
        display_name,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.challenge, input.purpose, adminUserId, username, displayName, createdAt, expiresAt)
    .run();

  return {
    id,
    challenge: input.challenge,
    purpose: input.purpose,
    adminUserId,
    username,
    displayName,
    createdAt,
    expiresAt,
    consumedAt: null
  };
}

export async function getActiveWebAuthnChallenge(
  db: D1Database,
  challenge: string,
  purpose: WebAuthnChallengePurpose,
  now = new Date()
): Promise<WebAuthnChallenge | null> {
  const row = await db
    .prepare(
      `SELECT *
        FROM webauthn_challenges
        WHERE challenge = ?
          AND purpose = ?
          AND consumed_at IS NULL
          AND expires_at > ?`
    )
    .bind(challenge, purpose, now.toISOString())
    .first<WebAuthnChallengeRow>();

  return row ? mapWebAuthnChallenge(row) : null;
}

export async function consumeWebAuthnChallenge(db: D1Database, id: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare("UPDATE webauthn_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export function buildUploadObjectKey(id: string, filename: string): string {
  return `uploads/${id}/${sanitizeObjectName(filename)}`;
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return base64UrlEncode(bytes);
}

export async function hashSessionToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function assertValidUploadInput(input: CreateUploadMetadataInput): void {
  if (input.originalFilename.trim().length === 0) {
    throw new Error("Upload filename is required.");
  }

  if (input.contentType.trim().length === 0) {
    throw new Error("Upload content type is required.");
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("Upload size must be a non-negative safe integer.");
  }

  assertValidUploadMode(input.uploadMode ?? "worker");
  assertValidStorageState(input.storageState ?? "stored");
}

function mapUpload(row: UploadRow): UploadMetadata {
  return {
    id: row.id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at ?? null,
    expiredAt: row.expired_at ?? null,
    uploadMode: parseUploadMode(row.upload_mode),
    storageState: parseStorageState(row.storage_state),
    r2DeleteRequestedAt: row.r2_delete_requested_at ?? null,
    r2DeleteCompletedAt: row.r2_delete_completed_at ?? null,
    r2DeleteFailedAt: row.r2_delete_failed_at ?? null,
    r2DeleteError: row.r2_delete_error ?? null,
    directUploadTokenExpiresAt: row.direct_upload_token_expires_at ?? null,
    directUploadFinalizedAt: row.direct_upload_finalized_at ?? null,
    directUploadError: row.direct_upload_error ?? null,
    multipartUploadId: row.multipart_upload_id ?? null,
    multipartPartSize: row.multipart_part_size ?? null,
    multipartPartCount: row.multipart_part_count ?? null,
    multipartCompletedParts: row.multipart_completed_parts ?? null,
    multipartAbortedAt: row.multipart_aborted_at ?? null
  };
}

function mapAppSetting(row: AppSettingRow): AppSetting {
  return {
    key: parseAppSettingKey(row.key),
    value: row.value,
    updatedAt: row.updated_at
  };
}

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}

function mapWebAuthnCredential(row: WebAuthnCredentialRow): WebAuthnCredential {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    signatureCounter: row.signature_counter,
    transports: parseTransports(row.transports),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  };
}

function mapAdminSession(row: AdminSessionRow): AdminSession {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    sessionHash: row.session_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

function mapWebAuthnChallenge(row: WebAuthnChallengeRow): WebAuthnChallenge {
  return {
    id: row.id,
    challenge: row.challenge,
    purpose: row.purpose,
    adminUserId: row.admin_user_id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function parseTransports(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function isUniqueConstraintFor(error: unknown, column: string): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes(column);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function iso(date = new Date()): string {
  return date.toISOString();
}

function optionalIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function assertValidUploadMode(value: string): asserts value is UploadMode {
  if (value !== "worker" && value !== "direct" && value !== "multipart") {
    throw new Error("Upload mode must be worker, direct, or multipart.");
  }
}

function assertValidStorageState(value: string): asserts value is UploadStorageState {
  if (value !== "pending" && value !== "stored" && value !== "deleted" && value !== "expired" && value !== "failed") {
    throw new Error("Upload storage state must be pending, stored, deleted, expired, or failed.");
  }
}

function parseUploadMode(value: string | null | undefined): UploadMode {
  if (!value) {
    return "worker";
  }

  assertValidUploadMode(value);
  return value;
}

function parseStorageState(value: string | null | undefined): UploadStorageState {
  if (!value) {
    return "stored";
  }

  assertValidStorageState(value);
  return value;
}

function parseAppSettingKey(value: string): AppSettingKey {
  if (value !== "storage_cap_bytes" && value !== "default_upload_ttl_seconds" && value !== "upload_mode") {
    throw new Error(`Unknown app setting: ${value}`);
  }

  return value;
}

function validateAppSetting(key: AppSettingKey, value: string): void {
  if (key === "upload_mode") {
    assertValidUploadMode(value);
    return;
  }

  if (value === "") {
    return;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be empty or a non-negative safe integer.`);
  }
}

function parseNullableIntegerSetting(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("App setting must be empty or a non-negative safe integer.");
  }

  return parsed;
}

function stringifyNullableIntegerSetting(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("App setting must be null or a non-negative safe integer.");
  }

  return String(value);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
