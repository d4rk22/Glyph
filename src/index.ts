import {
  createUploadMetadata,
  deleteUploadMetadata,
  getActiveUploadMetadata,
  type UploadMetadata
} from "./db";
import { buildPublicUrl, contentDisposition, getShortIdFromPath } from "./http";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} as const;

const UPLOAD_FIELD_NAME = "file";

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

    if (url.pathname === "/admin" && request.method === "GET") {
      return html(renderShell("Glyph Admin", adminPlaceholder()));
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS
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
      --bg: #f7f4ed;
      --panel: #fffdf8;
      --text: #24221e;
      --muted: #69635b;
      --border: #ddd5c8;
      --accent: #176b87;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }

    main {
      width: min(100%, 520px);
      padding: 28px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 16px 48px rgb(36 34 30 / 0.08);
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 7vw, 3.25rem);
      line-height: 1;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    form {
      margin-top: 24px;
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
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      font: inherit;
    }

    input[type="file"]::file-selector-button {
      min-height: 34px;
      margin-right: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font: inherit;
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
      text-decoration: none;
    }

    .secondary {
      background: transparent;
      color: var(--accent);
    }

    .error {
      margin-top: 16px;
      color: #a43131;
    }

    .copy-row {
      margin-top: 20px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151717;
        --panel: #1e2222;
        --text: #f3f0e9;
        --muted: #bbb5aa;
        --border: #333a39;
        --accent: #71c4d6;
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

  return `<h1>Glyph</h1>
<p>A private file drop for short, unlisted links.</p>
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
  return `<h1>Ready</h1>
<p>${escapeHtml(metadata.originalFilename)} is available at an unlisted short URL.</p>
<div class="copy-row">
  <input value="${escapeAttribute(shortUrl)}" readonly aria-label="Short URL">
</div>
<div class="actions">
  <a class="button" href="${escapeAttribute(shortUrl)}">Download</a>
  <a class="button secondary" href="/admin">Admin</a>
</div>`;
}

function adminPlaceholder(): string {
  return `<h1>Admin</h1>
<p>Passkey setup, upload listing, metadata, copy links, and deletion will be added in the admin phase.</p>
<div class="actions">
  <a class="button secondary" href="/">Back</a>
</div>`;
}

function notFoundPage(): string {
  return `<h1>Not found</h1>
<p>This Glyph link does not exist or is no longer available.</p>
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
  const formData = await request.formData();
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
