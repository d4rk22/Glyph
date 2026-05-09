import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthReadinessLines,
  buildDirectUploadReadinessLines,
  buildDirectUploadSecretPlan,
  buildPostDeployVerificationLines,
  buildR2CorsRecommendation,
  buildRemoteMigrationPlan,
  buildSecretPutCommand,
  buildTurnkeyRecoveryLines,
  buildTurnkeyFollowUpLines,
  buildTurnkeyPlan,
  buildTurnkeyWranglerConfig,
  buildSetupPlan,
  buildDeploySteps,
  classifyWranglerFailure,
  DEFAULT_BUCKET_NAME,
  DEFAULT_DRY_RUN_OUTDIR,
  findD1DatabaseId,
  hasR2Bucket,
  nodeMajorVersion,
  parseArgs,
  parseD1DatabaseList,
  parseR2BucketList,
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
    turnkey: false,
    skipInstall: false,
    reuseResources: false,
    database: "glyph",
    databaseId: null,
    bucket: DEFAULT_BUCKET_NAME,
    publicBaseUrl: null,
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.deepEqual(parseArgs(["--yes", "--skip-install", "--database", "prod-db", "--outdir=/tmp/out"]), {
    yes: true,
    check: false,
    setup: false,
    turnkey: false,
    skipInstall: true,
    reuseResources: false,
    database: "prod-db",
    databaseId: null,
    bucket: DEFAULT_BUCKET_NAME,
    publicBaseUrl: null,
    outdir: "/tmp/out",
    help: false
  });

  assert.deepEqual(parseArgs(["--setup", "--bucket", "prod-files"]), {
    yes: false,
    check: false,
    setup: true,
    turnkey: false,
    skipInstall: false,
    reuseResources: false,
    database: "glyph",
    databaseId: null,
    bucket: "prod-files",
    publicBaseUrl: null,
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.deepEqual(parseArgs(["--turnkey", "--reuse-resources", "--d1-database-id", "real-id", "--public-base-url=https://files.example.com"]), {
    yes: false,
    check: false,
    setup: false,
    turnkey: true,
    skipInstall: false,
    reuseResources: true,
    database: "glyph",
    databaseId: "real-id",
    bucket: DEFAULT_BUCKET_NAME,
    publicBaseUrl: "https://files.example.com",
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    help: false
  });

  assert.throws(() => parseArgs(["--check", "--yes"]), /Use either --check or --yes/);
  assert.throws(() => parseArgs(["--setup", "--check"]), /Use --setup by itself/);
  assert.throws(() => parseArgs(["--setup", "--turnkey"]), /either --setup or --turnkey/);
  assert.throws(() => parseArgs(["--database"]), /requires a value/);
  assert.throws(() => parseArgs(["--d1-database-id="]), /D1 database ID cannot be empty/);
  assert.throws(() => parseArgs(["--bucket="]), /R2 bucket name cannot be empty/);
  assert.throws(() => parseArgs(["--public-base-url", "http://files.example.com"]), /must use https/);
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

test("auth readiness reports token and non-interactive guidance", () => {
  assert.match(
    buildAuthReadinessLines({}, { isInteractive: false }).join("\n"),
    /CLOUDFLARE_API_TOKEN is required/
  );
  assert.match(
    buildAuthReadinessLines({}, { isInteractive: true }).join("\n"),
    /wrangler login/
  );
  assert.match(
    buildAuthReadinessLines({ CLOUDFLARE_API_TOKEN: "token" }, { isInteractive: false }).join("\n"),
    /manage Workers, manage D1, manage R2/
  );
});

test("remote migration plan keeps apply behind explicit confirmation", () => {
  assert.match(buildRemoteMigrationPlan(parseArgs(["--check"])).join("\n"), /only lists remote D1 migrations/);
  assert.match(buildRemoteMigrationPlan(parseArgs(["--yes"])).join("\n"), /--yes explicitly permits applying remote D1 migrations/);
  assert.match(buildRemoteMigrationPlan(parseArgs(["--database", "glyph-prod"])).join("\n"), /glyph-prod/);
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

test("turnkey plan is planning-first and reports setup, config, checks, and follow-up", () => {
  const plan = buildTurnkeyPlan(
    parseArgs(["--turnkey", "--database", "glyph-prod", "--bucket", "glyph-prod-files"]),
    validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000")
  );

  assert.match(plan.map((item) => item.label).join("\n"), /Verify local prerequisites/);
  assert.match(plan.map((item) => item.label).join("\n"), /Discover existing Cloudflare resources/);
  assert.deepEqual(
    plan.filter((item) => item.mutates && item.command).map((item) => item.command),
    [
      ["pnpm", "wrangler", "d1", "create", "glyph-prod"],
      ["pnpm", "wrangler", "r2", "bucket", "create", "glyph-prod-files"]
    ]
  );
  assert.match(plan.map((item) => item.detail).join("\n"), /will not deploy until a real ID is supplied or captured/);
  assert.match(plan.map((item) => item.detail).join("\n"), /custom-domain route hints/);
  assert.match(plan.map((item) => item.commands?.map((command) => command.join(" ")).join("\n") ?? "").join("\n"), /wrangler d1 list --json/);
  assert.match(plan.map((item) => item.commands?.map((command) => command.join(" ")).join("\n") ?? "").join("\n"), /wrangler r2 bucket list/);
  assert.match(plan.map((item) => item.label).join("\n"), /Print live URLs/);

  const reusePlan = buildTurnkeyPlan(parseArgs(["--turnkey", "--reuse-resources", "--d1-database-id", "real-id"]), validWranglerConfig);
  assert.equal(reusePlan.some((item) => item.command?.includes("create")), false);
  assert.match(reusePlan.map((item) => item.detail).join("\n"), /Uses existing R2 bucket/);
});

test("turnkey config generation updates bindings only with explicit values", () => {
  const generated = buildTurnkeyWranglerConfig(null, parseArgs(["--turnkey"]));
  assert.equal(generated.hasPlaceholderDatabaseId, true);
  assert.match(generated.configText, /"binding": "DB"/);
  assert.match(generated.configText, /"database_id": "00000000-0000-0000-0000-000000000000"/);
  assert.match(generated.configText, /"bucket_name": "glyph-files"/);

  const updated = buildTurnkeyWranglerConfig(
    validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000"),
    parseArgs([
      "--turnkey",
      "--d1-database-id",
      "abc123",
      "--bucket",
      "private-files",
      "--public-base-url",
      "https://files.example.com"
    ])
  );
  assert.equal(updated.hasPlaceholderDatabaseId, false);
  assert.match(updated.configText, /"database_id": "abc123"/);
  assert.match(updated.configText, /"bucket_name": "private-files"/);
  assert.match(updated.configText, /"PUBLIC_BASE_URL": "https:\/\/files\.example\.com"/);
  assert.equal(validateWranglerConfig(updated.configText, { requireDeployReady: true }).errors.length, 0);
});

test("turnkey follow-up output includes URLs, manual tasks, and partial setup recovery", () => {
  const lines = buildTurnkeyFollowUpLines(
    JSON.stringify({
      vars: { PUBLIC_BASE_URL: "https://files.example.com" }
    }),
    parseArgs(["--turnkey"])
  );

  assert.match(lines.join("\n"), /Public URL: https:\/\/files\.example\.com/);
  assert.match(lines.join("\n"), /Admin URL: https:\/\/files\.example\.com\/admin/);
  assert.match(lines.join("\n"), /R2 CORS/);
  assert.match(lines.join("\n"), /R2_ACCOUNT_ID/);
  assert.match(lines.join("\n"), /pnpm wrangler secret put R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(lines.join("\n"), /secret-access-key/);
  assert.match(lines.join("\n"), /Scheduled Worker triggers/);
  assert.match(lines.join("\n"), /Post-deploy check: verify https:\/\/files\.example\.com\/health/);
  assert.match(lines.join("\n"), /re-run --turnkey --yes with --reuse-resources/);
});

test("direct upload secret plan prints commands without values", () => {
  assert.deepEqual(buildSecretPutCommand("R2_SECRET_ACCESS_KEY"), ["pnpm", "wrangler", "secret", "put", "R2_SECRET_ACCESS_KEY"]);

  const plan = buildDirectUploadSecretPlan({
    R2_ACCOUNT_ID: "account-id",
    R2_SECRET_ACCESS_KEY: "do-not-print"
  });
  assert.deepEqual(
    plan.map((secret) => [secret.name, secret.required, secret.present]),
    [
      ["R2_ACCOUNT_ID", true, true],
      ["R2_ACCESS_KEY_ID", true, false],
      ["R2_SECRET_ACCESS_KEY", true, true],
      ["R2_BUCKET_NAME", false, false]
    ]
  );
  assert.equal(plan.some((secret) => secret.command.includes("do-not-print")), false);
});

test("direct upload readiness reports secret and CORS guidance without storing secrets", () => {
  const missing = buildDirectUploadReadinessLines(validWranglerConfig, {});
  assert.match(missing.join("\n"), /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY not detected/);
  assert.match(missing.join("\n"), /Worker-mediated uploads remain the safe fallback/);
  assert.match(missing.join("\n"), /pnpm wrangler secret put R2_ACCOUNT_ID/);
  assert.match(missing.join("\n"), /pnpm wrangler secret put R2_BUCKET_NAME \(optional\)/);
  assert.match(missing.join("\n"), /does not set secrets, echo secret values, or apply CORS automatically/);
  assert.match(missing.join("\n"), /do not write R2 secret access keys/);

  const configured = buildDirectUploadReadinessLines(
    validWranglerConfig.replace('"APP_ENV":"production"', '"APP_ENV":"production","PUBLIC_BASE_URL":"https://files.example.com"'),
    {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret"
    }
  );
  assert.match(configured.join("\n"), /required R2 S3-compatible environment values are present/);
  assert.match(configured.join("\n"), /https:\/\/files\.example\.com/);
  assert.match(configured.join("\n"), /Suggested CORS JSON/);
  assert.match(configured.join("\n"), /expose ETag/);
  assert.doesNotMatch(configured.join("\n"), /secret-access-key/);
});

test("post deploy verification reports known or operator-provided URLs", () => {
  assert.match(buildPostDeployVerificationLines(validWranglerConfig).join("\n"), /Wrangler prints the deployed workers\.dev/);
  assert.match(
    buildPostDeployVerificationLines(validWranglerConfig.replace('"APP_ENV":"production"', '"APP_ENV":"production","PUBLIC_BASE_URL":"https://files.example.com"')).join("\n"),
    /https:\/\/files\.example\.com\/health/
  );
});

test("R2 CORS recommendation validates origins and keeps CORS manual", () => {
  const missingOrigin = buildR2CorsRecommendation(validWranglerConfig);
  assert.equal(missingOrigin.origin, null);
  assert.equal(missingOrigin.corsJson, null);
  assert.match(missingOrigin.lines.join("\n"), /deployed Glyph origin/);
  assert.match(missingOrigin.lines.join("\n"), /Worker-mediated uploads remain the fallback/);

  const invalidOrigin = buildR2CorsRecommendation(null, { publicBaseUrl: "https://files.example.com/path", bucket: "private-files" });
  assert.equal(invalidOrigin.origin, null);
  assert.match(invalidOrigin.summary, /PUBLIC_BASE_URL is fixed/);
  assert.match(invalidOrigin.lines.join("\n"), /origin only/);

  const recommendation = buildR2CorsRecommendation(
    validWranglerConfig.replace('"APP_ENV":"production"', '"APP_ENV":"production","PUBLIC_BASE_URL":"https://files.example.com"')
  );
  assert.equal(recommendation.origin, "https://files.example.com");
  assert.equal(recommendation.bucketName, "glyph-files");
  assert.match(recommendation.corsJson ?? "", /"AllowedMethods": \[\n      "PUT"\n    \]/);
  assert.match(recommendation.corsJson ?? "", /"ExposeHeaders": \[\n      "ETag"\n    \]/);
  assert.match(recommendation.lines.join("\n"), /does not apply CORS automatically/);
});

test("turnkey discovery parses D1 database list output and finds IDs", () => {
  const jsonOutput = JSON.stringify([
    { uuid: "11111111-1111-1111-1111-111111111111", name: "other" },
    { uuid: "22222222-2222-2222-2222-222222222222", name: "glyph" }
  ]);
  assert.deepEqual(parseD1DatabaseList(jsonOutput), [
    { name: "other", id: "11111111-1111-1111-1111-111111111111" },
    { name: "glyph", id: "22222222-2222-2222-2222-222222222222" }
  ]);
  assert.equal(findD1DatabaseId(jsonOutput, "glyph"), "22222222-2222-2222-2222-222222222222");

  const tableOutput = `
┌──────────┬──────────────────────────────────────┐
│ name     │ uuid                                 │
├──────────┼──────────────────────────────────────┤
│ glyph    │ 33333333-3333-3333-3333-333333333333 │
└──────────┴──────────────────────────────────────┘
`;
  assert.deepEqual(parseD1DatabaseList(tableOutput), [
    { name: "glyph", id: "33333333-3333-3333-3333-333333333333" }
  ]);
});

test("turnkey discovery parses R2 bucket list output", () => {
  assert.deepEqual(parseR2BucketList(JSON.stringify([{ name: "glyph-files" }, { name: "archive-files" }])), [
    "glyph-files",
    "archive-files"
  ]);
  assert.equal(hasR2Bucket("glyph-files\narchive-files\n", "glyph-files"), true);
  assert.equal(hasR2Bucket("archive-files\n", "glyph-files"), false);
});

test("turnkey recovery guidance classifies common Wrangler and setup blockers", () => {
  assert.match(
    classifyWranglerFailure("In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable") ?? "",
    /CLOUDFLARE_API_TOKEN/
  );
  assert.match(classifyWranglerFailure("You are not authenticated. Run wrangler login.") ?? "", /Wrangler authentication/);
  assert.match(classifyWranglerFailure("Bucket already exists") ?? "", /already exist/);
  assert.match(classifyWranglerFailure("Replace the placeholder D1 database_id") ?? "", /database_id/);
  assert.match(classifyWranglerFailure("Forbidden request scope missing") ?? "", /enough access/);

  const recovery = buildTurnkeyRecoveryLines(parseArgs(["--turnkey", "--database", "glyph-prod", "--bucket", "glyph-prod-files"]), {
    d1CreatedWithoutId: true,
    r2AlreadyExists: true
  }).join("\n");
  assert.match(recovery, /wrangler d1 list --json/);
  assert.match(recovery, /glyph-prod/);
  assert.match(recovery, /glyph-prod-files already exists/);
  assert.match(recovery, /CLOUDFLARE_API_TOKEN/);
  assert.match(recovery, /permission or scope errors/);
  assert.match(recovery, /PUBLIC_BASE_URL/);
  assert.match(recovery, /direct and multipart upload modes/);
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
