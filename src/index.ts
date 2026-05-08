import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential as SimpleWebAuthnCredential
} from "@simplewebauthn/server";

import { adminNoticeMessage, isSameOriginAdminRequest } from "./admin.ts";
import {
  ADMIN_SESSION_COOKIE,
  base64UrlDecode,
  base64UrlEncode,
  challengeExpiresAt,
  clearSessionCookie,
  createSessionCookie,
  decodeClientDataChallenge,
  expectedOriginFromUrl,
  getCookieValue,
  isHttpsUrl,
  rpIdFromUrl,
  sessionExpiresAt,
  utf8Bytes
} from "./auth.ts";
import {
  consumeWebAuthnChallenge,
  countAdminUsers,
  createAdminSession,
  createUploadMetadata,
  createAdminUser,
  createWebAuthnChallenge,
  createWebAuthnCredential,
  deleteAdminUser,
  deleteUploadMetadata,
  getActiveAdminSessionByToken,
  getActiveUploadMetadata,
  getActiveWebAuthnChallenge,
  getAdminUserById,
  getAppSettings,
  getR2DeletionCleanupStats,
  getUploadMetadata,
  getUploadStorageUsage,
  getWebAuthnCredentialByCredentialId,
  listOldestActiveUploads,
  listUploadsPendingR2Deletion,
  listUploadMetadata,
  markUploadExpired,
  markUploadR2DeleteCompleted,
  markUploadR2DeleteFailed,
  markUploadR2DeleteRequested,
  listWebAuthnCredentials,
  markUploadDeleted,
  touchAdminUserLogin,
  updateAppSettings,
  updateUploadExpiration,
  updateWebAuthnCredentialUse,
  type AppSettings,
  type AdminUser,
  type R2DeletionCleanupStats,
  type StorageUsage,
  type UploadMetadata
} from "./db.ts";
import { formatBytes } from "./format.ts";
import { buildPublicUrl, contentDisposition, getShortIdFromPath } from "./http.ts";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} as const;

const UPLOAD_FIELD_NAME = "file";
const ADMIN_USERNAME = "admin";

interface UploadedFile extends Blob {
  name: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, app: "glyph", env: env.APP_ENV });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return html(renderShell("Glyph", uploadPage()));
    }

    if (url.pathname === "/" && request.method === "POST") {
      return handleUpload(request, env);
    }

    if (url.pathname === "/admin.js" && request.method === "GET") {
      return javascript(adminClientScript());
    }

    if (url.pathname === "/admin" && request.method === "GET") {
      return handleAdminPage(request, env);
    }

    if (url.pathname === "/admin/logout" && request.method === "POST") {
      return handleAdminLogout(request, env);
    }

    if (url.pathname === "/admin/uploads/delete" && request.method === "POST") {
      return handleAdminUploadDelete(request, env);
    }

    if (url.pathname === "/admin/uploads/expiration" && request.method === "POST") {
      return handleAdminUploadExpiration(request, env);
    }

    if (url.pathname === "/admin/settings/storage-cap" && request.method === "POST") {
      return handleAdminStorageCap(request, env);
    }

    if (url.pathname === "/admin/maintenance/r2-cleanup" && request.method === "POST") {
      return handleAdminR2Cleanup(request, env);
    }

    if (url.pathname === "/admin/passkeys/register/options" && request.method === "POST") {
      return handleRegistrationOptions(request, env);
    }

    if (url.pathname === "/admin/passkeys/register/verify" && request.method === "POST") {
      return handleRegistrationVerify(request, env);
    }

    if (url.pathname === "/admin/passkeys/login/options" && request.method === "POST") {
      return handleAuthenticationOptions(request, env);
    }

    if (url.pathname === "/admin/passkeys/login/verify" && request.method === "POST") {
      return handleAuthenticationVerify(request, env);
    }

    const shortId = getShortIdFromPath(url.pathname);
    if (shortId && (request.method === "GET" || request.method === "HEAD")) {
      return handleDownload(request, env, shortId);
    }

    ctx.waitUntil(Promise.resolve());
    return html(renderShell("Not Found", notFoundPage()), 404);
  }
};

async function handleUpload(request: Request, env: Env): Promise<Response> {
  let file: UploadedFile;

  try {
    file = await readUploadFile(request);
  } catch (error) {
    return html(renderShell("Upload Error", uploadPage(errorMessage(error))), 400);
  }

  const contentType = file.type || "application/octet-stream";
  const metadata = await createUploadMetadata(env.DB, {
    originalFilename: file.name || "file",
    contentType,
    sizeBytes: file.size
  });

  try {
    await env.FILES.put(metadata.objectKey, file, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        uploadId: metadata.id,
        originalFilename: metadata.originalFilename
      }
    });
  } catch (error) {
    await deleteUploadMetadata(env.DB, metadata.id);
    console.error("R2 upload failed", error);
    return html(renderShell("Upload Error", uploadPage("The file could not be stored. Try again.")), 500);
  }

  await enforceStorageCap(env);

  const origin = new URL(request.url).origin;
  return html(renderShell("Upload Ready", uploadSuccessPage(metadata, buildPublicUrl(origin, env.PUBLIC_BASE_URL, metadata.id))), 201);
}

async function handleDownload(request: Request, env: Env, id: string): Promise<Response> {
  const metadata = await getActiveUploadMetadata(env.DB, id);

  if (!metadata) {
    return html(renderShell("Not Found", notFoundPage()), 404);
  }

  if (isUploadExpired(metadata)) {
    if (metadata.expiredAt === null) {
      await markUploadExpired(env.DB, metadata.id);
    }

    return html(renderShell("Not Found", notFoundPage()), 404);
  }

  const object = await env.FILES.get(metadata.objectKey);

  if (!object) {
    return html(renderShell("Not Found", notFoundPage()), 404);
  }

  const headers = new Headers({
    "Content-Type": metadata.contentType || object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Length": String(metadata.sizeBytes),
    "Content-Disposition": contentDisposition(metadata.originalFilename),
    "Cache-Control": "private, max-age=0, no-store",
    ...SECURITY_HEADERS
  });

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers
  });
}

async function handleAdminPage(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthenticatedAdmin(request, env);

  if (auth) {
    const url = new URL(request.url);
    const uploads = await listUploadMetadata(env.DB, {
      includeDeleted: true,
      limit: 100
    });
    const usage = await getUploadStorageUsage(env.DB);
    const settings = await getAppSettings(env.DB);
    const cleanup = await getR2DeletionCleanupStats(env.DB);

    return html(
      renderShell(
        "Glyph Admin",
        adminDashboardPage(auth.user, uploads, usage, settings, cleanup, url.origin, env.PUBLIC_BASE_URL, url.searchParams.get("notice")),
        { wide: true }
      )
    );
  }

  if ((await countAdminUsers(env.DB)) === 0) {
    return html(renderShell("Glyph Admin Setup", adminBootstrapPage()));
  }

  return html(renderShell("Glyph Admin Login", adminLoginPage()));
}

async function handleAdminUploadDelete(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthenticatedAdmin(request, env);
  if (!auth) {
    return redirect("/admin");
  }

  if (!isSameOriginRequest(request)) {
    return html(renderShell("Forbidden", adminActionErrorPage("The delete request could not be verified.")), 403);
  }

  const formData = await request.formData();
  const id = formString(formData, "id");

  if (!id) {
    return redirect("/admin?notice=missing-id");
  }

  const metadata = await getUploadMetadata(env.DB, id);
  if (!metadata) {
    return redirect("/admin?notice=missing-upload");
  }

  await markUploadDeleted(env.DB, id);
  await deleteR2ObjectForUpload(env, metadata);
  return redirect("/admin?notice=deleted");
}

async function handleAdminUploadExpiration(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthenticatedAdmin(request, env);
  if (!auth) {
    return redirect("/admin");
  }

  if (!isSameOriginRequest(request)) {
    return html(renderShell("Forbidden", adminActionErrorPage("The expiration request could not be verified.")), 403);
  }

  const formData = await request.formData();
  const id = formString(formData, "id");

  if (!id) {
    return redirect("/admin?notice=missing-id");
  }

  const metadata = await getUploadMetadata(env.DB, id);
  if (!metadata) {
    return redirect("/admin?notice=missing-upload");
  }

  if (metadata.r2DeleteCompletedAt !== null) {
    return redirect("/admin?notice=expiration-object-cleaned");
  }

  const expiresAt = parseExpirationFormValue(formString(formData, "expiresAt"));
  if (expiresAt instanceof Error) {
    return redirect("/admin?notice=invalid-expiration");
  }

  await updateUploadExpiration(env.DB, id, expiresAt);
  return redirect(`/admin?notice=${expiresAt === null ? "expiration-cleared" : "expiration-updated"}`);
}

async function handleAdminStorageCap(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthenticatedAdmin(request, env);
  if (!auth) {
    return redirect("/admin");
  }

  if (!isSameOriginRequest(request)) {
    return html(renderShell("Forbidden", adminActionErrorPage("The storage cap request could not be verified.")), 403);
  }

  const formData = await request.formData();
  const storageCapBytes = parseStorageCapFormValue(formString(formData, "storageCapBytes"));
  if (storageCapBytes instanceof Error) {
    return redirect("/admin?notice=invalid-storage-cap");
  }

  await updateAppSettings(env.DB, { storageCapBytes });
  await enforceStorageCap(env);

  return redirect(`/admin?notice=${storageCapBytes === null ? "storage-cap-cleared" : "storage-cap-updated"}`);
}

async function handleAdminR2Cleanup(request: Request, env: Env): Promise<Response> {
  const auth = await getAuthenticatedAdmin(request, env);
  if (!auth) {
    return redirect("/admin");
  }

  if (!isSameOriginRequest(request)) {
    return html(renderShell("Forbidden", adminActionErrorPage("The cleanup request could not be verified.")), 403);
  }

  const result = await retryR2DeletionCleanup(env);
  if (result.attemptedCount === 0) {
    return redirect("/admin?notice=r2-cleanup-none");
  }

  return redirect(`/admin?notice=${result.failedCount === 0 ? "r2-cleanup-complete" : "r2-cleanup-partial"}`);
}

async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const token = getCookieValue(request, ADMIN_SESSION_COOKIE);

  if (token) {
    const session = await getActiveAdminSessionByToken(env.DB, token);
    if (session) {
      await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), session.id)
        .run();
    }
  }

  return redirect("/admin", {
    "Set-Cookie": clearSessionCookie(isHttpsUrl(new URL(request.url)))
  });
}

async function handleRegistrationOptions(request: Request, env: Env): Promise<Response> {
  if ((await countAdminUsers(env.DB)) > 0) {
    return json({ error: "Admin bootstrap is already complete." }, 409);
  }

  const url = new URL(request.url);
  const rpID = rpIdFromUrl(url);
  const body = await readJsonObject(request);
  const displayName = stringFromBody(body, "displayName") || "Glyph Admin";
  const adminUserId = crypto.randomUUID();

  const options = await generateRegistrationOptions({
    rpName: "Glyph",
    rpID,
    userID: utf8Bytes(adminUserId),
    userName: ADMIN_USERNAME,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required"
    }
  });

  await createWebAuthnChallenge(env.DB, {
    challenge: options.challenge,
    purpose: "registration",
    adminUserId,
    username: ADMIN_USERNAME,
    displayName,
    expiresAt: challengeExpiresAt()
  });

  return json(options);
}

async function handleRegistrationVerify(request: Request, env: Env): Promise<Response> {
  if ((await countAdminUsers(env.DB)) > 0) {
    return json({ error: "Admin bootstrap is already complete." }, 409);
  }

  let response: RegistrationResponseJSON;
  let challenge: string;
  try {
    response = (await request.json()) as RegistrationResponseJSON;
    challenge = decodeClientDataChallenge(response.response.clientDataJSON);
  } catch {
    return json({ error: "Passkey setup response was invalid." }, 400);
  }

  const storedChallenge = await getActiveWebAuthnChallenge(env.DB, challenge, "registration");

  if (!storedChallenge || !storedChallenge.adminUserId || !storedChallenge.username) {
    return json({ error: "Passkey setup expired. Try again." }, 400);
  }

  try {
    const url = new URL(request.url);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: expectedOriginFromUrl(url),
      expectedRPID: rpIdFromUrl(url),
      requireUserVerification: true
    });

    if (!verification.verified) {
      await consumeWebAuthnChallenge(env.DB, storedChallenge.id);
      return json({ error: "Passkey setup could not be verified." }, 400);
    }

    const user = await createAdminUser(env.DB, {
      id: storedChallenge.adminUserId,
      username: storedChallenge.username,
      displayName: storedChallenge.displayName || "Glyph Admin"
    });
    const credential = verification.registrationInfo.credential;

    try {
      await createWebAuthnCredential(env.DB, {
        adminUserId: user.id,
        credentialId: credential.id,
        publicKey: base64UrlEncode(credential.publicKey),
        signatureCounter: credential.counter,
        transports: response.response.transports ?? credential.transports ?? []
      });
    } catch (error) {
      await deleteAdminUser(env.DB, user.id);
      throw error;
    }

    await consumeWebAuthnChallenge(env.DB, storedChallenge.id);

    return await createAdminSessionResponse(request, env, user.id);
  } catch (error) {
    console.error("Passkey registration failed", error);
    await consumeWebAuthnChallenge(env.DB, storedChallenge.id);
    return json({ error: "Passkey setup failed. Try again." }, 400);
  }
}

async function handleAuthenticationOptions(request: Request, env: Env): Promise<Response> {
  if ((await countAdminUsers(env.DB)) === 0) {
    return json({ error: "Admin bootstrap is required first." }, 409);
  }

  const url = new URL(request.url);
  const credentials = await listWebAuthnCredentials(env.DB);
  const options = await generateAuthenticationOptions({
    rpID: rpIdFromUrl(url),
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[]
    })),
    userVerification: "required"
  });

  await createWebAuthnChallenge(env.DB, {
    challenge: options.challenge,
    purpose: "authentication",
    expiresAt: challengeExpiresAt()
  });

  return json(options);
}

async function handleAuthenticationVerify(request: Request, env: Env): Promise<Response> {
  let response: AuthenticationResponseJSON;
  let challenge: string;
  try {
    response = (await request.json()) as AuthenticationResponseJSON;
    challenge = decodeClientDataChallenge(response.response.clientDataJSON);
  } catch {
    return json({ error: "Passkey login response was invalid." }, 400);
  }

  const credential = await getWebAuthnCredentialByCredentialId(env.DB, response.id);

  if (!credential) {
    return json({ error: "Passkey is not registered for this Glyph admin." }, 400);
  }

  const storedChallenge = await getActiveWebAuthnChallenge(env.DB, challenge, "authentication");

  if (!storedChallenge) {
    return json({ error: "Passkey login expired. Try again." }, 400);
  }

  try {
    const url = new URL(request.url);
    const simpleCredential: SimpleWebAuthnCredential = {
      id: credential.credentialId,
      publicKey: base64UrlDecode(credential.publicKey) as Uint8Array<ArrayBuffer>,
      counter: credential.signatureCounter,
      transports: credential.transports as AuthenticatorTransportFuture[]
    };
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: expectedOriginFromUrl(url),
      expectedRPID: rpIdFromUrl(url),
      credential: simpleCredential,
      requireUserVerification: true
    });

    if (!verification.verified) {
      await consumeWebAuthnChallenge(env.DB, storedChallenge.id);
      return json({ error: "Passkey login could not be verified." }, 400);
    }

    await updateWebAuthnCredentialUse(
      env.DB,
      credential.credentialId,
      verification.authenticationInfo.newCounter
    );
    await touchAdminUserLogin(env.DB, credential.adminUserId);
    await consumeWebAuthnChallenge(env.DB, storedChallenge.id);

    return await createAdminSessionResponse(request, env, credential.adminUserId);
  } catch (error) {
    console.error("Passkey authentication failed", error);
    await consumeWebAuthnChallenge(env.DB, storedChallenge.id);
    return json({ error: "Passkey login failed. Try again." }, 400);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS
    }
  });
}

function jsonWithHeaders(data: unknown, headers: HeadersInit, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...headers
    }
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SECURITY_HEADERS
    }
  });
}

function javascript(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      ...SECURITY_HEADERS
    }
  });
}

function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      ...SECURITY_HEADERS,
      ...headers
    }
  });
}

async function createAdminSessionResponse(request: Request, env: Env, adminUserId: string): Promise<Response> {
  const expiresAt = sessionExpiresAt();
  const created = await createAdminSession(env.DB, {
    adminUserId,
    expiresAt
  });

  return jsonWithHeaders(
    { ok: true, redirect: "/admin" },
    {
      "Set-Cookie": createSessionCookie(created.token, expiresAt, isHttpsUrl(new URL(request.url)))
    }
  );
}

async function getAuthenticatedAdmin(
  request: Request,
  env: Env
): Promise<{ user: AdminUser } | null> {
  const token = getCookieValue(request, ADMIN_SESSION_COOKIE);
  if (!token) {
    return null;
  }

  const session = await getActiveAdminSessionByToken(env.DB, token);
  if (!session) {
    return null;
  }

  const user = await getAdminUserById(env.DB, session.adminUserId);
  return user ? { user } : null;
}

function renderShell(title: string, main: string, options: { wide?: boolean } = {}): string {
  const mainClass = options.wide ? ' class="wide"' : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5f7f6;
      --surface: #ffffff;
      --surface-muted: #eef3f0;
      --text: #202321;
      --muted: #626b66;
      --border: #d9e0dc;
      --accent: #276749;
      --accent-strong: #1f5139;
      --danger-bg: #fff0ec;
      --danger-border: #efb2a5;
      --danger-text: #8c2f1f;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }

    main {
      width: min(100%, 560px);
      padding: 32px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 18px 48px rgb(32 35 33 / 0.08);
    }

    main.wide {
      width: min(100%, 1080px);
    }

    h1 {
      margin: 0;
      font-size: clamp(2.25rem, 9vw, 4rem);
      line-height: 0.95;
      letter-spacing: 0;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 1rem;
      line-height: 1.2;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    .eyebrow {
      margin-bottom: 14px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 750;
      text-transform: uppercase;
    }

    .lede {
      margin-top: 12px;
      font-size: 1.05rem;
    }

    form {
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: var(--text);
      font-weight: 650;
    }

    input[type="file"],
    input[type="number"],
    input[readonly] {
      width: 100%;
      min-height: 44px;
      padding: 11px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    input[type="file"]::file-selector-button {
      min-height: 34px;
      margin-right: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-muted);
      color: var(--text);
      font: inherit;
    }

    input[readonly] {
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92rem;
    }

    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 24px;
    }

    button,
    a.button {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }

    button:hover,
    a.button:hover {
      background: var(--accent-strong);
      border-color: var(--accent-strong);
    }

    .secondary {
      background: transparent;
      color: var(--accent);
    }

    .secondary:hover {
      background: var(--surface-muted);
      color: var(--accent-strong);
    }

    .error {
      margin-top: 20px;
      padding: 12px 14px;
      border: 1px solid var(--danger-border);
      border-radius: 6px;
      background: var(--danger-bg);
      color: var(--danger-text);
    }

    .copy-row {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 24px;
    }

    .toolbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }

    .toolbar .actions {
      margin-top: 0;
    }

    .notice {
      margin-top: 20px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-muted);
      color: var(--text);
    }

    .upload-list {
      display: grid;
      gap: 12px;
      margin-top: 24px;
    }

    .usage-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 24px;
    }

    .usage-item {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
    }

    .usage-label {
      display: block;
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .usage-value {
      display: block;
      margin-top: 4px;
      color: var(--text);
      font-size: 1.2rem;
      font-weight: 800;
    }

    .usage-subvalue {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 0.86rem;
    }

    .settings-panel {
      margin-top: 24px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
    }

    .settings-panel form {
      margin-top: 16px;
      padding-top: 16px;
    }

    .settings-panel form:first-of-type {
      margin-top: 18px;
    }

    .settings-detail {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.9rem;
    }

    .settings-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
    }

    .settings-form label {
      margin-bottom: 8px;
    }

    .upload-card {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(180px, 0.9fr) auto;
      gap: 16px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .upload-name {
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--text);
      font-weight: 750;
    }

    .upload-url {
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.86rem;
      overflow-wrap: anywhere;
    }

    .upload-meta {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.9rem;
    }

    .status {
      display: inline-flex;
      width: fit-content;
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-muted);
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 700;
    }

    .status.deleted {
      border-color: var(--danger-border);
      background: var(--danger-bg);
      color: var(--danger-text);
    }

    .upload-actions {
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .upload-actions form {
      margin: 0;
      padding: 0;
      border: 0;
    }

    .expiration-form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 0;
      padding: 0;
      border: 0;
    }

    .expiration-form label {
      width: 100%;
      margin-bottom: 0;
      font-size: 0.78rem;
    }

    .expiration-form input {
      min-height: 44px;
      max-width: 220px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    .danger {
      border-color: var(--danger-border);
      background: var(--danger-bg);
      color: var(--danger-text);
    }

    .danger:hover {
      border-color: var(--danger-text);
      background: var(--danger-text);
      color: white;
    }

    .empty {
      margin-top: 24px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
    }

    .meta-item {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-muted);
    }

    .meta-label {
      display: block;
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .meta-value {
      display: block;
      margin-top: 4px;
      overflow-wrap: anywhere;
      color: var(--text);
      font-weight: 650;
    }

    @media (max-width: 520px) {
      body {
        align-items: stretch;
        padding: 12px;
      }

      main {
        padding: 24px;
      }

      .actions,
      button,
      a.button {
        width: 100%;
      }

      .meta {
        grid-template-columns: 1fr;
      }

      .upload-card {
        grid-template-columns: 1fr;
      }

      .usage-grid {
        grid-template-columns: 1fr;
      }

      .settings-form {
        grid-template-columns: 1fr;
      }

      .upload-actions {
        justify-content: stretch;
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141716;
        --surface: #1f2422;
        --surface-muted: #29312d;
        --text: #f4f7f4;
        --muted: #b5bdb8;
        --border: #36413c;
        --accent: #87d6a6;
        --accent-strong: #a4e7bb;
        --danger-bg: #351f1a;
        --danger-border: #7f4033;
        --danger-text: #f5b9ab;
      }
    }
  </style>
</head>
<body>
  <main${mainClass}>${main}</main>
</body>
</html>`;
}

function uploadPage(error?: string): string {
  const errorMarkup = error ? `<p class="error">${escapeHtml(error)}</p>` : "";

  return `<p class="eyebrow">Private file drop</p>
<h1>Glyph</h1>
<p class="lede">Upload a file and get a short, unlisted download link backed by Cloudflare R2.</p>
${errorMarkup}
<form method="post" enctype="multipart/form-data">
  <label for="file">File</label>
  <input id="file" name="${UPLOAD_FIELD_NAME}" type="file" required>
  <div class="actions">
    <button type="submit">Upload</button>
    <a class="button secondary" href="/admin">Admin</a>
  </div>
</form>`;
}

function uploadSuccessPage(metadata: UploadMetadata, shortUrl: string): string {
  return `<p class="eyebrow">Upload complete</p>
<h1>Ready</h1>
<p class="lede">${escapeHtml(metadata.originalFilename)} is available at an unlisted short URL.</p>
<div class="copy-row">
  <label for="short-url">Short URL</label>
  <input id="short-url" value="${escapeAttribute(shortUrl)}" readonly aria-label="Short URL">
</div>
<div class="meta">
  <div class="meta-item">
    <span class="meta-label">File</span>
    <span class="meta-value">${escapeHtml(metadata.originalFilename)}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Size</span>
    <span class="meta-value">${formatBytes(metadata.sizeBytes)}</span>
  </div>
</div>
<div class="actions">
  <a class="button" href="${escapeAttribute(shortUrl)}">Download</a>
  <a class="button secondary" href="/admin">Admin</a>
</div>`;
}

function adminPlaceholder(): string {
  return `<p class="eyebrow">Admin</p>
<h1>Not ready</h1>
<p class="lede">Passkey setup, upload listing, metadata, copy links, and deletion will be added in the admin phase.</p>
<div class="actions">
  <a class="button secondary" href="/">Back</a>
</div>`;
}

function adminBootstrapPage(): string {
  return `<p class="eyebrow">Admin setup</p>
<h1>Create passkey</h1>
<p class="lede">Register the first admin passkey for this private Glyph instance.</p>
<p class="error" id="admin-status" hidden></p>
<form id="register-form">
  <label for="display-name">Display name</label>
  <input id="display-name" name="displayName" autocomplete="name" value="Glyph Admin">
  <div class="actions">
    <button type="submit">Create passkey</button>
    <a class="button secondary" href="/">Home</a>
  </div>
</form>
<script type="module" src="/admin.js"></script>`;
}

function adminLoginPage(): string {
  return `<p class="eyebrow">Admin</p>
<h1>Use passkey</h1>
<p class="lede">Sign in with the passkey registered for this Glyph instance.</p>
<p class="error" id="admin-status" hidden></p>
<form id="login-form">
  <div class="actions">
    <button type="submit">Sign in</button>
    <a class="button secondary" href="/">Home</a>
  </div>
</form>
<script type="module" src="/admin.js"></script>`;
}

function adminDashboardPage(
  user: AdminUser,
  uploads: UploadMetadata[],
  usage: StorageUsage,
  settings: AppSettings,
  cleanup: R2DeletionCleanupStats,
  origin: string,
  configuredBaseUrl: string | undefined,
  notice: string | null
): string {
  const name = user.displayName || user.username;
  return `<div class="toolbar">
  <div>
    <p class="eyebrow">Admin</p>
    <h1>Files</h1>
    <p class="lede">Welcome, ${escapeHtml(name)}. Manage short links and uploaded file metadata.</p>
  </div>
  <form method="post" action="/admin/logout">
    <div class="actions">
      <button type="submit" class="secondary">Sign out</button>
    </div>
  </form>
</div>
${noticeMarkup(notice)}
<div class="meta">
  <div class="meta-item">
    <span class="meta-label">User</span>
    <span class="meta-value">${escapeHtml(user.username)}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Uploads</span>
    <span class="meta-value">${uploads.length}</span>
  </div>
</div>
${usageDashboard(usage)}
${storageCapPanel(settings, usage)}
${r2CleanupPanel(cleanup)}
${uploadList(uploads, origin, configuredBaseUrl)}
<script type="module" src="/admin.js"></script>`;
}

function notFoundPage(): string {
  return `<p class="eyebrow">Unavailable link</p>
<h1>Not found</h1>
<p class="lede">This Glyph link does not exist or is no longer available.</p>
<div class="actions">
  <a class="button secondary" href="/">Home</a>
</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

async function readUploadFile(request: Request): Promise<UploadedFile> {
  const requestContentType = request.headers.get("Content-Type") || "";
  if (!requestContentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error("Choose a file to upload.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new Error("Choose a file to upload.");
  }

  const value = formData.get(UPLOAD_FIELD_NAME);

  if (!isUploadedFile(value)) {
    throw new Error("Choose a file to upload.");
  }

  if (value.size === 0) {
    throw new Error("Choose a non-empty file.");
  }

  return value;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "size" in value &&
    "type" in value &&
    "stream" in value
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Upload failed.";
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function uploadList(uploads: UploadMetadata[], origin: string, configuredBaseUrl: string | undefined): string {
  if (uploads.length === 0) {
    return `<div class="empty">
  <p>No uploads yet.</p>
</div>`;
  }

  return `<div class="upload-list">
${uploads.map((upload) => uploadCard(upload, buildPublicUrl(origin, configuredBaseUrl, upload.id))).join("\n")}
</div>`;
}

function usageDashboard(usage: StorageUsage): string {
  return `<section class="usage-grid" aria-label="Usage summary">
  ${usageItem("Active", usage.activeBytes, usage.activeCount)}
  ${usageItem("Expired", usage.expiredBytes, usage.expiredCount)}
  ${usageItem("Deleted", usage.deletedBytes, usage.deletedCount)}
  ${usageItem("Total", usage.totalBytes, usage.totalCount)}
</section>`;
}

function usageItem(label: string, bytes: number, count: number): string {
  return `<div class="usage-item">
    <span class="usage-label">${escapeHtml(label)}</span>
    <span class="usage-value">${formatBytes(bytes)}</span>
    <span class="usage-subvalue">${count} ${count === 1 ? "upload" : "uploads"}</span>
  </div>`;
}

function storageCapPanel(settings: AppSettings, usage: StorageUsage): string {
  const cap = settings.storageCapBytes;
  const capValue = cap === null ? "" : String(cap);
  const capLabel = cap === null ? "No cap" : formatBytes(cap);
  const remainingLabel = cap === null ? "Unlimited" : formatBytes(Math.max(0, cap - usage.activeBytes));

  return `<section class="settings-panel" aria-label="Storage cap">
  <h2>Storage cap</h2>
  <div class="settings-detail">
    <span>Current ${escapeHtml(capLabel)}</span>
    <span>Active ${formatBytes(usage.activeBytes)}</span>
    <span>Remaining ${escapeHtml(remainingLabel)}</span>
  </div>
  <form class="settings-form" method="post" action="/admin/settings/storage-cap">
    <div>
      <label for="storage-cap-bytes">Cap in bytes</label>
      <input id="storage-cap-bytes" name="storageCapBytes" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttribute(capValue)}">
    </div>
    <button type="submit">Save cap</button>
  </form>
  <form method="post" action="/admin/settings/storage-cap">
    <button class="secondary" type="submit">Clear cap</button>
  </form>
</section>`;
}

function r2CleanupPanel(cleanup: R2DeletionCleanupStats): string {
  return `<section class="settings-panel" aria-label="R2 cleanup">
  <h2>R2 cleanup</h2>
  <div class="settings-detail">
    <span>Pending ${cleanup.pendingCount}</span>
    <span>Failed ${cleanup.failedCount}</span>
    <span>Completed ${cleanup.completedCount}</span>
  </div>
  <form method="post" action="/admin/maintenance/r2-cleanup">
    <button type="submit">Retry cleanup</button>
  </form>
</section>`;
}

function uploadCard(upload: UploadMetadata, shortUrl: string): string {
  const isDeleted = upload.deletedAt !== null;
  const isExpired = !isDeleted && isUploadExpired(upload);
  const status = isDeleted ? "Deleted" : isExpired ? "Expired" : "Active";
  const deletedMeta = isDeleted ? `<span>Deleted ${escapeHtml(upload.deletedAt || "")}</span>` : "";
  const expirationMeta = upload.expiresAt ? `<span>Expires ${escapeHtml(upload.expiresAt)}</span>` : "<span>No expiration</span>";
  const expiredMeta = upload.expiredAt ? `<span>Expired ${escapeHtml(upload.expiredAt)}</span>` : "";
  const copyButton = `<button class="secondary" type="button" data-copy-url="${escapeAttribute(shortUrl)}">Copy URL</button>`;
  const r2CleanupMeta = upload.r2DeleteCompletedAt
    ? `<span>R2 cleanup complete ${escapeHtml(upload.r2DeleteCompletedAt)}</span>`
    : upload.r2DeleteFailedAt
      ? `<span>R2 cleanup failed ${escapeHtml(upload.r2DeleteFailedAt)}</span>`
      : upload.r2DeleteRequestedAt
        ? `<span>R2 cleanup requested ${escapeHtml(upload.r2DeleteRequestedAt)}</span>`
        : "";
  const r2CleanupErrorMeta = upload.r2DeleteError ? `<span>R2 cleanup error ${escapeHtml(upload.r2DeleteError)}</span>` : "";
  const expirationActions = upload.r2DeleteCompletedAt === null ? expirationForm(upload) : "";
  const actions = isDeleted
    ? `<a class="button secondary" href="${escapeAttribute(shortUrl)}">Open link</a>
    ${copyButton}`
    : `<a class="button secondary" href="${escapeAttribute(shortUrl)}">Open link</a>
    ${copyButton}
    ${expirationActions}
    <form method="post" action="/admin/uploads/delete">
      <input type="hidden" name="id" value="${escapeAttribute(upload.id)}">
      <button class="danger" type="submit">Delete</button>
    </form>`;

  return `<article class="upload-card">
  <div>
    <p class="upload-name">${escapeHtml(upload.originalFilename)}</p>
    <p class="upload-url">${escapeHtml(shortUrl)}</p>
  </div>
  <div class="upload-meta">
    <span class="status${isDeleted || isExpired ? " deleted" : ""}">${status}</span>
    <span>${formatBytes(upload.sizeBytes)}</span>
    <span>${escapeHtml(upload.contentType)}</span>
    <span>Created ${escapeHtml(upload.createdAt)}</span>
    ${expirationMeta}
    ${expiredMeta}
    ${r2CleanupMeta}
    ${r2CleanupErrorMeta}
    ${deletedMeta}
    <span>ID ${escapeHtml(upload.id)}</span>
    <span>Object ${escapeHtml(upload.objectKey)}</span>
  </div>
  <div class="upload-actions">
    ${actions}
  </div>
</article>`;
}

function expirationForm(upload: UploadMetadata): string {
  return `<form class="expiration-form" method="post" action="/admin/uploads/expiration">
      <input type="hidden" name="id" value="${escapeAttribute(upload.id)}">
      <label for="expires-${escapeAttribute(upload.id)}">Expires (UTC)</label>
      <input id="expires-${escapeAttribute(upload.id)}" name="expiresAt" type="datetime-local" value="${escapeAttribute(datetimeLocalValue(upload.expiresAt))}">
      <button class="secondary" type="submit">Save</button>
    </form>
    <form method="post" action="/admin/uploads/expiration">
      <input type="hidden" name="id" value="${escapeAttribute(upload.id)}">
      <button class="secondary" type="submit">Clear expiration</button>
    </form>`;
}

function noticeMarkup(notice: string | null): string {
  const message = adminNoticeMessage(notice);
  return message ? `<p class="notice">${escapeHtml(message)}</p>` : "";
}

function adminActionErrorPage(message: string): string {
  return `<p class="eyebrow">Admin</p>
<h1>Action blocked</h1>
<p class="error">${escapeHtml(message)}</p>
<div class="actions">
  <a class="button secondary" href="/admin">Back</a>
</div>`;
}

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseExpirationFormValue(value: string | null): string | null | Error {
  if (value === null || value.trim() === "") {
    return null;
  }

  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return new Error("Invalid expiration.");
  }

  return parsed.toISOString();
}

function parseStorageCapFormValue(value: string | null): number | null | Error {
  if (value === null || value.trim() === "") {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return new Error("Invalid storage cap.");
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return new Error("Invalid storage cap.");
  }

  return parsed;
}

async function enforceStorageCap(env: Env): Promise<{ expiredCount: number; expiredBytes: number }> {
  const settings = await getAppSettings(env.DB);
  if (settings.storageCapBytes === null) {
    return { expiredCount: 0, expiredBytes: 0 };
  }

  const cap = settings.storageCapBytes;
  const usage = await getUploadStorageUsage(env.DB);
  let activeBytes = usage.activeBytes;
  let expiredCount = 0;
  let expiredBytes = 0;

  while (activeBytes > cap) {
    const candidates = await listOldestActiveUploads(env.DB, new Date(), 50);
    if (candidates.length === 0) {
      break;
    }

    let changed = false;
    for (const upload of candidates) {
      if (activeBytes <= cap) {
        break;
      }

      const expired = await markUploadExpired(env.DB, upload.id);
      if (!expired) {
        continue;
      }

      changed = true;
      expiredCount += 1;
      expiredBytes += upload.sizeBytes;
      activeBytes = Math.max(0, activeBytes - upload.sizeBytes);

      await deleteR2ObjectForUpload(env, upload);
    }

    if (!changed) {
      break;
    }
  }

  return { expiredCount, expiredBytes };
}

async function retryR2DeletionCleanup(env: Env): Promise<{ attemptedCount: number; completedCount: number; failedCount: number }> {
  const candidates = await listUploadsPendingR2Deletion(env.DB, new Date(), 50);
  let completedCount = 0;
  let failedCount = 0;

  for (const upload of candidates) {
    if (await deleteR2ObjectForUpload(env, upload)) {
      completedCount += 1;
    } else {
      failedCount += 1;
    }
  }

  return {
    attemptedCount: candidates.length,
    completedCount,
    failedCount
  };
}

async function deleteR2ObjectForUpload(env: Env, upload: UploadMetadata): Promise<boolean> {
  await markUploadR2DeleteRequested(env.DB, upload.id);

  try {
    await env.FILES.delete(upload.objectKey);
    await markUploadR2DeleteCompleted(env.DB, upload.id);
    return true;
  } catch (error) {
    const message = r2DeleteErrorMessage(error);
    console.error("R2 delete failed", error);
    await markUploadR2DeleteFailed(env.DB, upload.id, message);
    return false;
  }
}

function r2DeleteErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "R2 delete failed.";
}

function datetimeLocalValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 16);
}

function isUploadExpired(upload: UploadMetadata, now = new Date()): boolean {
  if (upload.expiredAt !== null) {
    return true;
  }

  if (upload.expiresAt === null) {
    return false;
  }

  const expiresAt = Date.parse(upload.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function isSameOriginRequest(request: Request): boolean {
  return isSameOriginAdminRequest(request.url, request.headers.get("Origin"));
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringFromBody(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function adminClientScript(): string {
  return `
const statusEl = document.getElementById("admin-status");
const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");

function setStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function creationOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: {
      ...options.user,
      id: fromBase64Url(options.user.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  };
}

function requestOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  };
}

function registrationJSON(credential) {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      attestationObject: toBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

function authenticationJSON(credential) {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      authenticatorData: toBase64Url(credential.response.authenticatorData),
      signature: toBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle ? toBase64Url(credential.response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Passkey request failed.");
  }
  return data;
}

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");
  try {
    const displayName = new FormData(registerForm).get("displayName") || "Glyph Admin";
    const options = await postJSON("/admin/passkeys/register/options", { displayName });
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    const result = await postJSON("/admin/passkeys/register/verify", registrationJSON(credential));
    window.location.assign(result.redirect || "/admin");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Passkey setup failed.");
  }
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");
  try {
    const options = await postJSON("/admin/passkeys/login/options", {});
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    const result = await postJSON("/admin/passkeys/login/verify", authenticationJSON(credential));
    window.location.assign(result.redirect || "/admin");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Passkey login failed.");
  }
});

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

document.querySelectorAll("[data-copy-url]").forEach((button) => {
  button.addEventListener("click", async () => {
    const value = button.getAttribute("data-copy-url");
    if (!value) return;

    const originalLabel = button.textContent || "Copy URL";
    try {
      await copyText(value);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1800);
  });
});
`;
}
