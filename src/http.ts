export function getShortIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/") || pathname === "/") {
    return null;
  }

  const withoutSlash = pathname.slice(1);

  if (withoutSlash.includes("/") || withoutSlash.length === 0) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(withoutSlash);
    return decoded.includes("/") || decoded.length === 0 ? null : decoded;
  } catch {
    return null;
  }
}

export function buildPublicUrl(origin: string, configuredBaseUrl: string | undefined, id: string): string {
  const base = configuredBaseUrl || origin;
  return `${base.replace(/\/+$/u, "")}/${encodeURIComponent(id)}`;
}

export function contentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim()
    .slice(0, 160) || "download";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`;
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}
