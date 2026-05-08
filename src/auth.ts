export const ADMIN_SESSION_COOKIE = "glyph_admin";
export const ADMIN_SESSION_DAYS = 30;
export const WEBAUTHN_CHALLENGE_MINUTES = 5;

export type WebAuthnChallengePurpose = "registration" | "authentication";

export function expectedOriginFromUrl(url: URL): string {
  return url.origin;
}

export function rpIdFromUrl(url: URL): string {
  return url.hostname;
}

export function sessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export function challengeExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + WEBAUTHN_CHALLENGE_MINUTES * 60 * 1000);
}

export function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=") || "";
    }
  }

  return null;
}

export function createSessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0"
  ]
    .filter(Boolean)
    .join("; ");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

export function decodeClientDataChallenge(clientDataJSON: string): string {
  const json = new TextDecoder().decode(base64UrlDecode(clientDataJSON));
  const parsed: unknown = JSON.parse(json);

  if (!isClientData(parsed)) {
    throw new Error("Passkey response did not include a valid challenge.");
  }

  return parsed.challenge;
}

export function isHttpsUrl(url: URL): boolean {
  return url.protocol === "https:";
}

function isClientData(value: unknown): value is { challenge: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "challenge" in value &&
    typeof (value as { challenge: unknown }).challenge === "string"
  );
}
