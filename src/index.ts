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
} from "./auth";
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
  getWebAuthnCredentialByCredentialId,
  listWebAuthnCredentials,
  touchAdminUserLogin,
  updateWebAuthnCredentialUse,
  type AdminUser,
  type UploadMetadata
} from "./db";
import { formatBytes } from "./format";
import { buildPublicUrl, contentDisposition, getShortIdFromPath } from "./http";

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

  const origin = new URL(request.url).origin;
  return html(renderShell("Upload Ready", uploadSuccessPage(metadata, buildPublicUrl(origin, env.PUBLIC_BASE_URL, metadata.id))), 201);
}

async function handleDownload(request: Request, env: Env, id: string): Promise<Response> {
  const metadata = await getActiveUploadMetadata(env.DB, id);

  if (!metadata) {
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
    return html(renderShell("Glyph Admin", adminDashboardPage(auth.user)));
  }

  if ((await countAdminUsers(env.DB)) === 0) {
    return html(renderShell("Glyph Admin Setup", adminBootstrapPage()));
  }

  return html(renderShell("Glyph Admin Login", adminLoginPage()));
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

function renderShell(title: string, main: string): string {
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
  <main>${main}</main>
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

function adminDashboardPage(user: AdminUser): string {
  const name = user.displayName || user.username;
  return `<p class="eyebrow">Admin</p>
<h1>Signed in</h1>
<p class="lede">Welcome, ${escapeHtml(name)}. File listing, metadata, link copying, and deletion come next.</p>
<div class="meta">
  <div class="meta-item">
    <span class="meta-label">User</span>
    <span class="meta-value">${escapeHtml(user.username)}</span>
  </div>
  <div class="meta-item">
    <span class="meta-label">Last login</span>
    <span class="meta-value">${escapeHtml(user.lastLoginAt || "First session")}</span>
  </div>
</div>
<form method="post" action="/admin/logout">
  <div class="actions">
    <button type="submit">Sign out</button>
    <a class="button secondary" href="/">Home</a>
  </div>
</form>`;
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
`;
}
