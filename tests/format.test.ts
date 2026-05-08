import assert from "node:assert/strict";
import test from "node:test";

import { formatBytes } from "../src/format.ts";

test("formatBytes keeps byte values compact", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
});

test("formatBytes scales larger values with stable precision", () => {
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(12_288), "12.0 KB");
  assert.equal(formatBytes(1_572_864), "1.50 MB");
});

