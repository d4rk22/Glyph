import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicUrl, contentDisposition, getShortIdFromPath } from "../src/http.ts";

test("getShortIdFromPath returns only single-segment IDs", () => {
  assert.equal(getShortIdFromPath("/abc123"), "abc123");
  assert.equal(getShortIdFromPath("/"), null);
  assert.equal(getShortIdFromPath("/admin/settings"), null);
  assert.equal(getShortIdFromPath("/admin%2Fsettings"), null);
  assert.equal(getShortIdFromPath("abc123"), null);
});

test("buildPublicUrl prefers configured base URL and trims trailing slashes", () => {
  assert.equal(buildPublicUrl("https://worker.example", undefined, "abc123"), "https://worker.example/abc123");
  assert.equal(buildPublicUrl("https://worker.example", "https://glyph.example///", "abc123"), "https://glyph.example/abc123");
});

test("contentDisposition includes ASCII fallback and encoded filename", () => {
  const header = contentDisposition('r\u00e9sum\u00e9 "final".pdf');

  assert.match(header, /^attachment; filename="r_sum_ _final_\.pdf"/);
  assert.match(header, /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf$/);
});
