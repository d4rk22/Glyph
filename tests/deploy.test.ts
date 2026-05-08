import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeploySteps,
  DEFAULT_DRY_RUN_OUTDIR,
  nodeMajorVersion,
  parseArgs,
  summarizeDeploymentTarget,
  validateWranglerConfig
} from "../scripts/deploy.mjs";

const validWranglerConfig = JSON.stringify({
  name: "glyph",
  main: "src/index.ts",
  vars: { APP_ENV: "production" },
  d1_databases: [
    {
      binding: "DB",
      database_name: "glyph",
      database_id: "real-database-id",
      migrations_dir: "migrations"
    }
  ],
  r2_buckets: [{ binding: "FILES", bucket_name: "glyph-files" }]
});

test("deploy argument parser defaults to a safe check mode", () => {
  assert.deepEqual(parseArgs([]), {
    yes: false,
    check: false,
    skipInstall: false,
    database: "glyph",
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.deepEqual(parseArgs(["--yes", "--skip-install", "--database", "prod-db", "--outdir=/tmp/out"]), {
    yes: true,
    check: false,
    skipInstall: true,
    database: "prod-db",
    outdir: "/tmp/out",
    help: false
  });

  assert.throws(() => parseArgs(["--check", "--yes"]), /Use either --check or --yes/);
  assert.throws(() => parseArgs(["--database"]), /requires a value/);
});

test("deploy steps check by default and only mutate remotely with --yes", () => {
  const checkSteps = buildDeploySteps(parseArgs(["--skip-install"]));
  assert.deepEqual(
    checkSteps.map((step) => step.command),
    [
      ["pnpm", "run", "typecheck"],
      ["pnpm", "test"],
      ["pnpm", "wrangler", "d1", "migrations", "list", "glyph", "--remote"],
      ["pnpm", "wrangler", "deploy", "--dry-run", "--outdir", DEFAULT_DRY_RUN_OUTDIR]
    ]
  );

  const deploySteps = buildDeploySteps(parseArgs(["--yes", "--skip-install", "--database=prod"]));
  assert.deepEqual(deploySteps.at(-2)?.command, ["pnpm", "wrangler", "deploy", "--dry-run", "--outdir", DEFAULT_DRY_RUN_OUTDIR]);
  assert.deepEqual(deploySteps.at(-1)?.command, ["pnpm", "wrangler", "deploy"]);
  assert.deepEqual(deploySteps[2].command, ["pnpm", "wrangler", "d1", "migrations", "apply", "prod", "--remote"]);
});

test("wrangler config validation checks required Glyph bindings", () => {
  const valid = validateWranglerConfig(validWranglerConfig, { requireDeployReady: true });
  assert.deepEqual(valid.errors, []);

  const placeholder = validateWranglerConfig(
    validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000"),
    { requireDeployReady: true }
  );
  assert.match(placeholder.errors.join("\n"), /placeholder D1 database_id/);

  const missingBindings = validateWranglerConfig(JSON.stringify({ name: "glyph", main: "src/index.ts" }));
  assert.match(missingBindings.errors.join("\n"), /D1 binding named DB/);
  assert.match(missingBindings.errors.join("\n"), /R2 binding named FILES/);
  assert.match(missingBindings.errors.join("\n"), /vars.APP_ENV/);
});

test("wrangler config validation checks custom-domain readiness", () => {
  const customDomainConfig = JSON.stringify({
    name: "glyph",
    main: "src/index.ts",
    vars: { APP_ENV: "production", PUBLIC_BASE_URL: "https://files.example.com" },
    routes: [{ pattern: "files.example.com/*", custom_domain: true }],
    d1_databases: [
      {
        binding: "DB",
        database_name: "glyph",
        database_id: "real-database-id",
        migrations_dir: "migrations"
      }
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: "glyph-files" }]
  });
  const valid = validateWranglerConfig(customDomainConfig, { requireDeployReady: true });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.warnings, []);

  const pathBase = validateWranglerConfig(customDomainConfig.replace("https://files.example.com", "https://files.example.com/glyph"));
  assert.match(pathBase.errors.join("\n"), /origin only/);

  const insecureBase = validateWranglerConfig(customDomainConfig.replace("https://files.example.com", "http://files.example.com"));
  assert.match(insecureBase.errors.join("\n"), /must use https/);

  const mismatchedRoute = validateWranglerConfig(customDomainConfig.replace("files.example.com/*", "share.example.com/*"));
  assert.match(mismatchedRoute.warnings.join("\n"), /does not match configured Wrangler route/);

  const missingBase = validateWranglerConfig(customDomainConfig.replace('"PUBLIC_BASE_URL":"https://files.example.com"', '"OTHER":"value"'));
  assert.match(missingBase.warnings.join("\n"), /PUBLIC_BASE_URL is not set/);
});

test("deployment target summary reports public base URL and route hosts", () => {
  const summary = summarizeDeploymentTarget(
    JSON.stringify({
      name: "glyph",
      vars: { PUBLIC_BASE_URL: "https://files.example.com" },
      routes: ["files.example.com/*"]
    })
  );

  assert.deepEqual(summary, [
    "Worker name: glyph",
    "Public base URL: https://files.example.com",
    "Wrangler route hosts: files.example.com"
  ]);

  assert.deepEqual(summarizeDeploymentTarget("{ nope"), ["Deployment target: wrangler.jsonc could not be parsed."]);
});

test("node version parser supports v-prefixed versions", () => {
  assert.equal(nodeMajorVersion("v25.2.1"), 25);
  assert.equal(nodeMajorVersion("22.0.0"), 22);
  assert.equal(nodeMajorVersion("not-a-version"), 0);
});
