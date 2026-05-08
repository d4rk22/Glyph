import { DEFAULT_SHORT_ID_LENGTH, generateShortId, sanitizeObjectName } from "./ids";
import type { WebAuthnChallengePurpose } from "./auth";

const DEFAULT_MAX_ID_ATTEMPTS = 8;
const SESSION_TOKEN_BYTES = 32;

export interface UploadMetadata {
  id: string;
  objectKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface CreateUploadMetadataInput {
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  objectKey?: string;
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
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(id, objectKey, input.originalFilename, input.contentType, input.sizeBytes, createdAt)
        .run();

      return {
        id,
        objectKey,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        createdAt,
        deletedAt: null
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
    .prepare("UPDATE uploads SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(now.toISOString(), id)
    .run();

  return result.meta.changes > 0;
}

export async function deleteUploadMetadata(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
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
}

function mapUpload(row: UploadRow): UploadMetadata {
  return {
    id: row.id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
