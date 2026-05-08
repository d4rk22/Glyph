import assert from "node:assert/strict";
import test from "node:test";

import { adminNoticeMessage, isSameOriginAdminRequest } from "../src/admin.ts";

test("adminNoticeMessage maps known dashboard notices", () => {
  assert.equal(adminNoticeMessage("deleted"), "Upload deleted. R2 object deletion was requested and the metadata is marked deleted.");
  assert.equal(adminNoticeMessage("missing-upload"), "That upload no longer exists.");
  assert.equal(adminNoticeMessage("missing-id"), "No upload was selected.");
  assert.equal(adminNoticeMessage("unknown"), null);
});

test("isSameOriginAdminRequest accepts absent or matching origins", () => {
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", null), true);
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", "https://glyph.example"), true);
  assert.equal(isSameOriginAdminRequest("https://glyph.example/admin/uploads/delete", "https://evil.example"), false);
});

