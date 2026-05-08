import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildReleaseCheckSteps,
  DEFAULT_RELEASE_DRY_RUN_OUTDIR,
  parseReleaseArgs,
  validateVersionSource
} from "../scripts/release-check.mjs";

test("release check argument parser stays non-publishing by default", () => {
  assert.deepEqual(parseReleaseArgs([]), {
    skipD1: false,
    outdir: DEFAULT_RELEASE_DRY_RUN_OUTDIR,
    help: false
  });

  assert.deepEqual(parseReleaseArgs(["--skip-d1", "--outdir=/tmp/release"]), {
    skipD1: true,
    outdir: "/tmp/release",
    help: false
  });

  assert.throws(() => parseReleaseArgs(["--outdir="]), /Dry-run output directory cannot be empty/);
});

test("release check steps do not publish deploy or apply remote migrations", () => {
  const steps = buildReleaseCheckSteps(parseReleaseArgs(["--outdir=/tmp/release"]));
  assert.deepEqual(
    steps.map((step) => step.command),
    [
      ["./node_modules/.bin/tsc", "--noEmit"],
      ["node", "--test", "--experimental-strip-types", "tests/*.test.ts"],
      ["./node_modules/.bin/wrangler", "deploy", "--dry-run", "--outdir", "/tmp/release"],
      ["./node_modules/.bin/wrangler", "d1", "migrations", "apply", "glyph", "--local"]
    ]
  );

  const commands = steps.map((step) => step.command.join(" ")).join("\n");
  assert.doesNotMatch(commands, /wrangler deploy$/m);
  assert.doesNotMatch(commands, /--remote/);
});

test("release check validates package-backed version source", () => {
  const root = mkdtempSync(join(tmpdir(), "glyph-release-check-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(join(root, "src/version.ts"), 'import packageJson from "../package.json" with { type: "json" };\nexport const GLYPH_VERSION = packageJson.version;\n');

  assert.deepEqual(validateVersionSource(root), {
    version: "1.2.3",
    errors: []
  });

  writeFileSync(join(root, "src/version.ts"), 'export const GLYPH_VERSION = "1.2.3";\n');
  assert.match(validateVersionSource(root).errors.join("\n"), /import package\.json/);
});
