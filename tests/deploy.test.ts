import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSetupPlan,
  buildDeploySteps,
  DEFAULT_BUCKET_NAME,
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
    setup: false,
    skipInstall: false,
    database: "glyph",
    bucket: DEFAULT_BUCKET_NAME,
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.deepEqual(parseArgs(["--yes", "--skip-install", "--database", "prod-db", "--outdir=/tmp/out"]), {
    yes: true,
    check: false,
    setup: false,
    skipInstall: true,
    database: "prod-db",
    bucket: DEFAULT_BUCKET_NAME,
    outdir: "/tmp/out",
    help: false
  });

  assert.deepEqual(parseArgs(["--setup", "--bucket", "prod-files"]), {
    yes: false,
    check: false,
    setup: true,
    skipInstall: false,
    database: "glyph",
    bucket: "prod-files",
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.throws(() => parseArgs(["--check", "--yes"]), /Use either --check or --yes/);
  assert.throws(() => parseArgs(["--setup", "--check"]), /Use --setup by itself/);
  assert.throws(() => parseArgs(["--database"]), /requires a value/);
  assert.throws(() => parseArgs(["--bucket="]), /R2 bucket name cannot be empty/);
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

test("setup plan is non-mutating by default and scopes create commands to --setup --yes", () => {
  const plan = buildSetupPlan(
    parseArgs(["--setup", "--database", "glyph-prod", "--bucket", "glyph-prod-files"]),
    validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000")
  );

  assert.deepEqual(
    plan.filter((item) => item.mutates).map((item) => item.command),
    [
      ["pnpm", "wrangler", "d1", "create", "glyph-prod"],
      ["pnpm", "wrangler", "r2", "bucket", "create", "glyph-prod-files"]
    ]
  );
  assert.match(plan.map((item) => item.detail).join("\n"), /copy the returned database_id/);
  assert.match(plan.map((item) => item.detail).join("\n"), /Do not commit secrets/);
  assert.match(plan.map((item) => item.detail).join("\n"), /No Wrangler cron trigger is configured/);
  assert.match(plan.map((item) => item.detail).join("\n"), /does not create triggers automatically/);
  assert.deepEqual(plan.at(-1)?.command, ["pnpm", "run", "deploy:glyph", "--", "--check", "--database", "glyph-prod"]);
  assert.equal(plan.at(-1)?.mutates, false);
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

test("wrangler config validation reports scheduled update check readiness", () => {
  const noTriggerSummary = summarizeDeploymentTarget(validWranglerConfig);
  assert.match(noTriggerSummary.join("\n"), /Scheduled update check trigger\(s\): none configured/);
  assert.match(noTriggerSummary.join("\n"), /valid update source and read-only scheduled checks enabled in \/admin/);
  assert.match(noTriggerSummary.join("\n"), /Scheduled maintenance also requires scheduled maintenance enabled in \/admin/);

  const scheduledConfig = JSON.stringify({
    name: "glyph",
    main: "src/index.ts",
    vars: { APP_ENV: "production" },
    triggers: { crons: ["0 */6 * * *"] },
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
  const valid = validateWranglerConfig(scheduledConfig, { requireDeployReady: true });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.warnings, []);
  assert.match(summarizeDeploymentTarget(scheduledConfig).join("\n"), /Scheduled update check trigger\(s\): 0 \*\/6 \* \* \*/);

  const plan = buildSetupPlan(parseArgs(["--setup"]), scheduledConfig);
  assert.match(plan.map((item) => item.detail).join("\n"), /Wrangler cron trigger\(s\) found: 0 \*\/6 \* \* \*/);
  assert.match(plan.map((item) => item.detail).join("\n"), /scheduled maintenance requires scheduled maintenance enabled in \/admin/);
  assert.match(plan.map((item) => item.detail).join("\n"), /does not create triggers automatically/);

  const invalidTrigger = validateWranglerConfig(scheduledConfig.replace('"0 */6 * * *"', "123"));
  assert.match(invalidTrigger.errors.join("\n"), /non-empty cron strings/);

  const emptyTrigger = validateWranglerConfig(scheduledConfig.replace('"0 */6 * * *"', '""'));
  assert.match(emptyTrigger.errors.join("\n"), /non-empty cron strings/);
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
    "Wrangler route hosts: files.example.com",
    "Scheduled update check trigger(s): none configured",
    "Scheduled update checks also require a valid update source and read-only scheduled checks enabled in /admin.",
    "Scheduled maintenance also requires scheduled maintenance enabled in /admin."
  ]);

  assert.deepEqual(summarizeDeploymentTarget("{ nope"), ["Deployment target: wrangler.jsonc could not be parsed."]);
});

test("node version parser supports v-prefixed versions", () => {
  assert.equal(nodeMajorVersion("v25.2.1"), 25);
  assert.equal(nodeMajorVersion("22.0.0"), 22);
  assert.equal(nodeMajorVersion("not-a-version"), 0);
});
