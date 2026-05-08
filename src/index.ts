const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
} as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, app: "glyph", env: env.APP_ENV });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return html(renderShell("Glyph", uploadPage()));
    }

    if (url.pathname === "/admin" && request.method === "GET") {
      return html(renderShell("Glyph Admin", adminPlaceholder()));
    }

    ctx.waitUntil(Promise.resolve());
    return html(renderShell("Not Found", notFoundPage()), 404);
  }
};

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

function uploadPage(): string {
  return `<h1>Glyph</h1>
<p>A private file drop for short, unlisted links. Upload flow comes next.</p>
<div class="actions">
  <button type="button" disabled>Upload soon</button>
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

