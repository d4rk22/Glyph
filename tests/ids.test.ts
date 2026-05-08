import assert from "node:assert/strict";
import test from "node:test";

import { SHORT_ID_ALPHABET, generateShortId, sanitizeObjectName } from "../src/ids.ts";

test("generateShortId returns the requested length from the configured alphabet", () => {
  let next = 0;
  const id = generateShortId(16, (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = next;
      next = (next + 1) % 256;
    }

    return bytes;
  });

  assert.equal(id.length, 16);

  for (const character of id) {
    assert.ok(SHORT_ID_ALPHABET.includes(character));
  }
});

test("generateShortId rejects invalid lengths", () => {
  assert.throws(() => generateShortId(0), RangeError);
  assert.throws(() => generateShortId(1.5), RangeError);
});

test("sanitizeObjectName removes path separators and keeps a fallback name", () => {
  assert.equal(sanitizeObjectName("../invoice.pdf"), "..-invoice.pdf");
  assert.equal(sanitizeObjectName(""), "file");
});

