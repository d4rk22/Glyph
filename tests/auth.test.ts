import assert from "node:assert/strict";
import test from "node:test";

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
} from "../src/auth.ts";

test("origin and RP ID derive from the request URL", () => {
  const url = new URL("https://glyph.example/admin");

  assert.equal(expectedOriginFromUrl(url), "https://glyph.example");
  assert.equal(rpIdFromUrl(url), "glyph.example");
  assert.equal(isHttpsUrl(url), true);
});

test("session cookie helpers scope admin sessions to admin routes", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const cookie = createSessionCookie("token-value", expiresAt, true);

  assert.match(cookie, new RegExp(`${ADMIN_SESSION_COOKIE}=token-value`));
  assert.match(cookie, /Path=\/admin/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);

  const clearCookie = clearSessionCookie(false);
  assert.match(clearCookie, /Max-Age=0/);
  assert.doesNotMatch(clearCookie, /Secure/);
});

test("getCookieValue reads a named cookie", () => {
  const request = new Request("https://glyph.example/admin", {
    headers: {
      Cookie: "other=1; glyph_admin=abc.def; theme=dark"
    }
  });

  assert.equal(getCookieValue(request, ADMIN_SESSION_COOKIE), "abc.def");
  assert.equal(getCookieValue(request, "missing"), null);
});

test("base64url helpers round trip binary data and client challenges", () => {
  const challenge = "passkey-challenge";
  const clientData = JSON.stringify({ type: "webauthn.get", challenge });
  const encoded = base64UrlEncode(utf8Bytes(clientData));

  assert.deepEqual(base64UrlDecode(base64UrlEncode(new Uint8Array([1, 2, 252]))), new Uint8Array([1, 2, 252]));
  assert.equal(decodeClientDataChallenge(encoded), challenge);
});

test("expiration helpers move forward from the given time", () => {
  const now = new Date("2026-05-08T00:00:00.000Z");

  assert.ok(sessionExpiresAt(now).getTime() > now.getTime());
  assert.equal(challengeExpiresAt(now).toISOString(), "2026-05-08T00:05:00.000Z");
});

