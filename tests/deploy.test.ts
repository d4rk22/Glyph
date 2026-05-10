import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthReadinessLines,
  buildCustomDomainSetupPlan,
  buildCustomDomainTroubleshootingLines,
  buildCustomDomainVerificationPlan,
  buildCustomDomainVerificationRecoveryLines,
  buildCustomDomainWranglerConfig,
  buildDeployVerificationPlan,
  buildDeployVerificationRecoveryLines,
  buildDirectUploadReadinessLines,
  buildDirectUploadSetupPlan,
  buildDirectUploadSecretPlan,
  buildPostDeployVerificationLines,
  buildPreflightChecklist,
  buildR2CorsRecommendation,
  buildR2CorsSetCommand,
  buildReadinessReport,
  buildRemoteMigrationPlan,
  buildScheduledTriggerReadiness,
  buildScheduledTriggerSetupPlan,
  buildScheduledTriggerWranglerConfig,
  buildSecretPutCommand,
  buildTurnkeyRecoveryLines,
  buildTurnkeyFollowUpLines,
  buildTurnkeyExamplesReport,
  buildTurnkeyPlan,
  buildTurnkeyRehearsalReport,
  buildTurnkeyWranglerConfig,
  buildSetupPlan,
  buildDeploySteps,
  checkDeployOrigin,
  checkCustomDomainHealth,
  classifyWranglerFailure,
  DEFAULT_BUCKET_NAME,
  DEFAULT_DRY_RUN_OUTDIR,
  findD1DatabaseId,
  formatTurnkeyExamplesReport,
  formatPreflightChecklist,
  formatReadinessReport,
  formatTurnkeyRehearsalReport,
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
    turnkeySecrets: false,
    turnkeyDomain: false,
    turnkeySchedule: false,
    turnkeyRehearse: false,
    turnkeyExamples: false,
    preflight: false,
    verifyDomain: false,
    verifyDeploy: false,
    applyCors: false,
    readiness: false,
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
    turnkeySecrets: false,
    turnkeyDomain: false,
    turnkeySchedule: false,
    turnkeyRehearse: false,
    turnkeyExamples: false,
    preflight: false,
    verifyDomain: false,
    verifyDeploy: false,
    applyCors: false,
    readiness: false,
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
    turnkeySecrets: false,
    turnkeyDomain: false,
    turnkeySchedule: false,
    turnkeyRehearse: false,
    turnkeyExamples: false,
    preflight: false,
    verifyDomain: false,
    verifyDeploy: false,
    applyCors: false,
    readiness: false,
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
    turnkeySecrets: false,
    turnkeyDomain: false,
    turnkeySchedule: false,
    turnkeyRehearse: false,
    turnkeyExamples: false,
    preflight: false,
    verifyDomain: false,
    verifyDeploy: false,
    applyCors: false,
    readiness: false,
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
  assert.equal(parseArgs(["--turnkey-secrets"]).turnkeySecrets, true);
  assert.equal(parseArgs(["--turnkey-secrets", "--yes", "--apply-cors"]).applyCors, true);
  assert.throws(() => parseArgs(["--turnkey-secrets", "--check"]), /turnkey-secrets by itself/);
  assert.throws(() => parseArgs(["--apply-cors"]), /only with --turnkey-secrets --yes/);
  assert.equal(parseArgs(["--turnkey-domain", "--public-base-url", "https://files.example.com"]).turnkeyDomain, true);
  assert.equal(parseArgs(["--turnkey-domain", "--yes", "--public-base-url", "https://files.example.com"]).yes, true);
  assert.throws(() => parseArgs(["--turnkey-domain", "--check"]), /turnkey-domain by itself/);
  assert.throws(() => parseArgs(["--turnkey-domain", "--apply-cors"]), /turnkey-domain by itself/);
  assert.equal(parseArgs(["--turnkey-schedule"]).turnkeySchedule, true);
  assert.equal(parseArgs(["--turnkey-schedule", "--yes"]).yes, true);
  assert.throws(() => parseArgs(["--turnkey-schedule", "--check"]), /turnkey-schedule by itself/);
  assert.throws(() => parseArgs(["--turnkey-schedule", "--turnkey-domain"]), /turnkey-domain by itself|turnkey-schedule by itself/);
  assert.equal(parseArgs(["--turnkey-rehearse"]).turnkeyRehearse, true);
  assert.equal(parseArgs(["--turnkey-rehearse", "--public-base-url", "https://files.example.com"]).publicBaseUrl, "https://files.example.com");
  assert.throws(() => parseArgs(["--turnkey-rehearse", "--yes"]), /turnkey-rehearse by itself/);
  assert.throws(() => parseArgs(["--turnkey-rehearse", "--readiness"]), /turnkey-rehearse by itself/);
  assert.equal(parseArgs(["--turnkey-examples"]).turnkeyExamples, true);
  assert.equal(parseArgs(["--turnkey-examples", "--public-base-url", "https://files.example.com"]).publicBaseUrl, "https://files.example.com");
  assert.throws(() => parseArgs(["--turnkey-examples", "--yes"]), /turnkey-examples by itself/);
  assert.throws(() => parseArgs(["--turnkey-examples", "--turnkey"]), /turnkey-examples by itself/);
  assert.equal(parseArgs(["--preflight"]).preflight, true);
  assert.equal(parseArgs(["--preflight", "--public-base-url", "https://files.example.com"]).publicBaseUrl, "https://files.example.com");
  assert.throws(() => parseArgs(["--preflight", "--yes"]), /preflight by itself/);
  assert.throws(() => parseArgs(["--preflight", "--turnkey"]), /preflight by itself/);
  assert.equal(parseArgs(["--verify-domain", "--public-base-url", "https://files.example.com"]).verifyDomain, true);
  assert.throws(() => parseArgs(["--verify-domain", "--yes"]), /verify-domain by itself/);
  assert.throws(() => parseArgs(["--verify-domain", "--turnkey-domain", "--public-base-url", "https://files.example.com"]), /turnkey-domain by itself|verify-domain by itself/);
  assert.equal(parseArgs(["--verify-deploy", "--public-base-url", "https://glyph.example.workers.dev"]).verifyDeploy, true);
  assert.equal(parseArgs(["--verify-deploy", "--public-base-url", "https://files.example.com"]).publicBaseUrl, "https://files.example.com");
  assert.throws(() => parseArgs(["--verify-deploy", "--yes"]), /verify-deploy by itself/);
  assert.throws(() => parseArgs(["--verify-deploy", "--verify-domain", "--public-base-url", "https://files.example.com"]), /verify-domain by itself|verify-deploy by itself/);
  assert.equal(parseArgs(["--readiness"]).readiness, true);
  assert.equal(parseArgs(["--", "--readiness"]).readiness, true);
  assert.throws(() => parseArgs(["--readiness", "--yes"]), /read-only report mode/);
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

test("readiness report summarizes deploy state without mutating guidance", () => {
  const report = buildReadinessReport(parseArgs(["--readiness"]), {
    nodeVersion: "v25.0.0",
    isInteractive: false,
    env: {
      CLOUDFLARE_API_TOKEN: "token",
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "super-secret-value"
    },
    packageJsonText: JSON.stringify({ version: "9.9.9", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": true,
      migrations: true,
      "src/index.ts": true
    },
    configText: JSON.stringify({
      name: "glyph",
      main: "src/index.ts",
      vars: { APP_ENV: "production", PUBLIC_BASE_URL: "https://files.example.com" },
      routes: ["files.example.com/*"],
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
    })
  });
  const output = formatReadinessReport(report);

  assert.match(output, /Glyph deploy readiness report/);
  assert.match(output, /\[ready\] Package version: Glyph 9\.9\.9/);
  assert.match(output, /\[manual\] Turnkey rehearsal: Run `pnpm run deploy:glyph -- --turnkey-rehearse`/);
  assert.match(output, /\[ready\] Cloudflare auth: CLOUDFLARE_API_TOKEN is set/);
  assert.match(output, /\[ready\] D1 binding: DB binds database glyph/);
  assert.match(output, /\[ready\] D1 database_id: non-placeholder/);
  assert.match(output, /\[ready\] R2 binding: FILES binds bucket glyph-files/);
  assert.match(output, /\[ready\] Scheduled triggers: Configured cron trigger/);
  assert.match(output, /\[ready\] Guided scheduled-trigger setup: Configured cron trigger/);
  assert.match(output, /scheduled maintenance still needs its \/admin opt-in/);
  assert.match(output, /turnkey-domain/);
  assert.match(output, /verify-domain/);
  assert.match(output, /verify-deploy/);
  assert.match(output, /Custom-domain verification/);
  assert.match(output, /\[manual\] Remote migrations: Readiness mode does not list or apply remote migrations/);
  assert.match(output, /\[manual\] R2 CORS recommendation: Allow browser PUT requests from https:\/\/files\.example\.com/);
  assert.match(output, /turnkey-secrets/);
  assert.match(output, /\[ready\] Worker-mediated fallback/);
  assert.match(output, /pnpm wrangler secret put R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(output, /super-secret-value/);
  assert.match(output, /No secret storage, no CORS application, no remote migrations, no deploy/);
  assert.match(output, /no local custom-domain config writes/);
});

test("readiness report flags placeholder D1 IDs and non-interactive auth blockers", () => {
  const output = formatReadinessReport(buildReadinessReport(parseArgs(["--readiness"]), {
    nodeVersion: "v25.0.0",
    isInteractive: false,
    env: {},
    packageJsonText: JSON.stringify({ version: "1.2.3", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": true,
      migrations: true,
      "src/index.ts": true
    },
    configText: validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000")
  }));

  assert.match(output, /\[blocked\] Cloudflare auth: CLOUDFLARE_API_TOKEN is required/);
  assert.match(output, /\[blocked\] D1 database_id: placeholder detected/);
  assert.match(output, /pnpm wrangler d1 list --json/);
  assert.match(output, /\[blocked\] Resource discovery: Resource discovery is blocked/);
  assert.match(output, /\[needs attention\] Required R2 secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY not detected/);
});

test("readiness report handles missing Wrangler config as a report item", () => {
  const output = formatReadinessReport(buildReadinessReport(parseArgs(["--readiness"]), {
    nodeVersion: "v25.0.0",
    isInteractive: true,
    env: {},
    packageJsonText: JSON.stringify({ version: "1.2.3", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": false,
      migrations: true,
      "src/index.ts": true
    },
    configText: null
  }));

  assert.match(output, /\[blocked\] Project files: Missing required path\(s\): wrangler\.jsonc/);
  assert.match(output, /\[blocked\] wrangler\.jsonc: missing/);
  assert.match(output, /\[manual\] Cloudflare auth: No CLOUDFLARE_API_TOKEN detected/);
});

test("turnkey rehearsal report summarizes the full operator path without mutation", () => {
  const output = formatTurnkeyRehearsalReport(buildTurnkeyRehearsalReport(parseArgs(["--turnkey-rehearse", "--public-base-url", "https://files.example.com"]), {
    nodeVersion: "v25.0.0",
    isInteractive: false,
    env: {
      CLOUDFLARE_API_TOKEN: "token"
    },
    packageJsonText: JSON.stringify({ version: "9.9.9", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": true,
      migrations: true,
      "src/index.ts": true
    },
    configText: validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000")
  }));

  assert.match(output, /Glyph turnkey deploy rehearsal report/);
  assert.match(output, /Read-only rehearsal/);
  assert.match(output, /\[ready\] Package version: Glyph 9\.9\.9/);
  assert.match(output, /\[ready\] Cloudflare auth: CLOUDFLARE_API_TOKEN is set/);
  assert.match(output, /D1\/R2 discovery/);
  assert.match(output, /placeholder database_id is configured/);
  assert.match(output, /--reuse-resources --d1-database-id <real-id>/);
  assert.match(output, /Remote D1 migration gate/);
  assert.match(output, /Worker deploy gate/);
  assert.match(output, /turnkey-secrets/);
  assert.match(output, /R2 CORS follow-up/);
  assert.match(output, /verify-domain --public-base-url https:\/\/files\.example\.com/);
  assert.match(output, /verify-deploy --public-base-url https:\/\/files\.example\.com/);
  assert.match(output, /Passkeys are origin-bound/);
  assert.match(output, /turnkey-schedule/);
  assert.match(output, /Recommended command order/);
  assert.match(output, /Partial setup recovery/);
  assert.match(output, /No D1\/R2 creation, no local config writes/);
  assert.doesNotMatch(output, /secret-value/);
});

test("turnkey examples report prints recovery transcripts without mutation or secret values", () => {
  const output = formatTurnkeyExamplesReport(buildTurnkeyExamplesReport(parseArgs(["--turnkey-examples", "--public-base-url", "https://files.example.com"]), {
    configText: validWranglerConfig
  }));

  assert.match(output, /Glyph turnkey deploy examples/);
  assert.match(output, /Fresh checkout to first deploy/);
  assert.match(output, /\$ pnpm install --frozen-lockfile/);
  assert.match(output, /\$ pnpm run deploy:glyph -- --turnkey-rehearse/);
  assert.match(output, /\$ pnpm run deploy:glyph -- --turnkey --yes/);
  assert.match(output, /Non-interactive Cloudflare auth recovery/);
  assert.match(output, /CLOUDFLARE_API_TOKEN=<scoped-cloudflare-api-token>/);
  assert.match(output, /Existing D1\/R2 resource reuse and placeholder recovery/);
  assert.match(output, /--reuse-resources --d1-database-id <real-d1-database-id>/);
  assert.match(output, /Remote migration and deploy gates/);
  assert.match(output, /\$ pnpm run deploy:glyph -- --check/);
  assert.match(output, /Worker-mediated fallback/);
  assert.match(output, /pnpm wrangler secret put R2_SECRET_ACCESS_KEY/);
  assert.match(output, /Custom domain and passkey origin follow-up/);
  assert.match(output, /turnkey-domain --public-base-url https:\/\/files\.example\.com/);
  assert.match(output, /turnkey-schedule/);
  assert.match(output, /verify-deploy --public-base-url https:\/\/files\.example\.com/);
  assert.match(output, /never deploys Workers/);
  assert.doesNotMatch(output, /actual-secret|sk_live|AKIA[0-9A-Z]+/);
});

test("preflight checklist summarizes deploy gates as markdown without mutation or secret values", () => {
  const output = formatPreflightChecklist(buildPreflightChecklist(parseArgs(["--preflight", "--public-base-url", "https://files.example.com"]), {
    nodeVersion: "v25.0.0",
    isInteractive: false,
    env: {
      CLOUDFLARE_API_TOKEN: "super-secret-token",
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "actual-secret-value"
    },
    packageJsonText: JSON.stringify({ version: "9.9.9", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": true,
      migrations: true,
      "src/index.ts": true
    },
    configText: JSON.stringify({
      name: "glyph",
      main: "src/index.ts",
      vars: { APP_ENV: "production", PUBLIC_BASE_URL: "https://files.example.com" },
      routes: ["files.example.com/*"],
      triggers: { crons: ["0 3 * * *"] },
      d1_databases: [
        {
          binding: "DB",
          database_name: "glyph",
          database_id: "real-database-id",
          migrations_dir: "migrations"
        }
      ],
      r2_buckets: [{ binding: "FILES", bucket_name: "glyph-files" }]
    })
  }));

  assert.match(output, /^# Glyph Deploy Preflight Checklist/);
  assert.match(output, /- \[ \] \[ready\] Local prerequisites and package version: Node v25\.0\.0, Glyph 9\.9\.9/);
  assert.match(output, /Cloudflare auth\/token readiness/);
  assert.match(output, /D1\/R2 binding and resource readiness/);
  assert.match(output, /Placeholder D1 database ID state/);
  assert.match(output, /Remote migration review\/apply gate/);
  assert.match(output, /Worker-mediated upload fallback status/);
  assert.match(output, /Direct\/multipart secret and R2 CORS readiness/);
  assert.match(output, /Custom-domain\/public origin alignment/);
  assert.match(output, /Scheduled-trigger\/admin opt-in readiness/);
  assert.match(output, /Post-deploy \/health, \/admin, and \/ verification/);
  assert.match(output, /Next: `pnpm run deploy:glyph -- --check`/);
  assert.match(output, /Next: `pnpm run deploy:glyph -- --verify-deploy --public-base-url https:\/\/files\.example\.com`/);
  assert.match(output, /operator-owned Cloudflare tasks/);
  assert.match(output, /does not deploy Workers/);
  assert.doesNotMatch(output, /super-secret-token|actual-secret-value/);
});

test("preflight checklist flags blocked auth and placeholder D1 recovery", () => {
  const output = formatPreflightChecklist(buildPreflightChecklist(parseArgs(["--preflight"]), {
    nodeVersion: "v25.0.0",
    isInteractive: false,
    env: {},
    packageJsonText: JSON.stringify({ version: "1.2.3", packageManager: "pnpm@11.0.8" }),
    projectFiles: {
      "package.json": true,
      "pnpm-lock.yaml": true,
      "wrangler.jsonc": true,
      migrations: true,
      "src/index.ts": true
    },
    configText: validWranglerConfig.replace("real-database-id", "00000000-0000-0000-0000-000000000000")
  }));

  assert.match(output, /\[blocked\] Cloudflare auth\/token readiness/);
  assert.match(output, /Next: `export CLOUDFLARE_API_TOKEN=<scoped-cloudflare-api-token>`/);
  assert.match(output, /\[blocked\] Placeholder D1 database ID state/);
  assert.match(output, /--reuse-resources --d1-database-id <real-d1-database-id>/);
  assert.match(output, /\[needs attention\] Direct\/multipart secret and R2 CORS readiness/);
  assert.match(output, /No PUBLIC_BASE_URL or --public-base-url supplied/);
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
  assert.match(plan.map((item) => item.detail).join("\n"), /--turnkey-rehearse/);
  assert.match(plan.map((item) => item.detail).join("\n"), /--turnkey-schedule/);
  assert.match(plan.map((item) => item.detail).join("\n"), /--verify-domain/);
  assert.match(plan.map((item) => item.detail).join("\n"), /--verify-deploy/);
  assert.match(plan.map((item) => item.label).join("\n"), /Verify custom-domain attachment/);
  assert.match(plan.map((item) => item.label).join("\n"), /Verify deployed Glyph origin/);
  assert.match(plan.map((item) => item.label).join("\n"), /Rehearse end-to-end deploy/);
  assert.match(plan.map((item) => item.label).join("\n"), /Configure scheduled trigger readiness/);
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

test("scheduled-trigger setup plans local cron config without Cloudflare mutation", () => {
  const plan = buildScheduledTriggerSetupPlan(parseArgs(["--turnkey-schedule"]), validWranglerConfig);
  const output = plan.items.map((item) => `${item.label}: ${item.detail}`).join("\n");

  assert.equal(plan.readiness.status, "missing");
  assert.deepEqual(plan.suggestedCrons, ["0 3 * * *"]);
  assert.match(output, /No Wrangler cron trigger is configured/);
  assert.match(output, /read-only scheduled update checks/);
  assert.match(output, /Scheduled maintenance can enforce/);
  assert.match(output, /triggers\.crons value \(0 3 \* \* \*\)/);
  assert.match(output, /does not enable admin settings/);
  assert.match(output, /never creates Cloudflare scheduled triggers through the API/);

  const update = buildScheduledTriggerWranglerConfig(validWranglerConfig, parseArgs(["--turnkey-schedule", "--yes"]));
  assert.equal(update.changed, true);
  assert.match(update.configText, /"triggers"/);
  assert.match(update.configText, /"0 3 \* \* \*"/);
});

test("scheduled-trigger setup reports configured and inconsistent cron state", () => {
  const configuredConfig = JSON.stringify({
    ...JSON.parse(validWranglerConfig),
    triggers: { crons: ["0 */6 * * *"] }
  });
  const configuredPlan = buildScheduledTriggerSetupPlan(parseArgs(["--turnkey-schedule"]), configuredConfig);
  const configuredOutput = configuredPlan.items.map((item) => item.detail).join("\n");

  assert.equal(buildScheduledTriggerReadiness(configuredConfig).status, "configured");
  assert.equal(configuredPlan.configUpdate.changed, false);
  assert.deepEqual(configuredPlan.suggestedCrons, ["0 */6 * * *"]);
  assert.match(configuredOutput, /Configured cron trigger/);
  assert.match(configuredOutput, /no local config write is needed/);

  const inconsistentConfig = JSON.stringify({
    ...JSON.parse(validWranglerConfig),
    triggers: { crons: "" }
  });
  const inconsistentPlan = buildScheduledTriggerSetupPlan(parseArgs(["--turnkey-schedule"]), inconsistentConfig);
  const inconsistentOutput = inconsistentPlan.items.map((item) => item.detail).join("\n");

  assert.equal(buildScheduledTriggerReadiness(inconsistentConfig).status, "inconsistent");
  assert.match(inconsistentOutput, /needs attention/);
  assert.match(inconsistentOutput, /must be an array/);
  assert.deepEqual(inconsistentPlan.configUpdate.crons, ["0 3 * * *"]);

  const unparseablePlan = buildScheduledTriggerSetupPlan(parseArgs(["--turnkey-schedule"]), "{");
  assert.equal(unparseablePlan.configUpdate.changed, false);
  assert.match(unparseablePlan.configUpdate.error ?? "", /could not be parsed/);
  assert.match(unparseablePlan.items.map((item) => item.detail).join("\n"), /fix it before writing/);
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

test("custom-domain setup plan validates origin route hints and manual follow-up", () => {
  const config = JSON.stringify({
    name: "glyph",
    main: "src/index.ts",
    vars: { APP_ENV: "production" },
    routes: ["old.example.com/*"],
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
  const plan = buildCustomDomainSetupPlan(
    parseArgs(["--turnkey-domain", "--public-base-url", "https://files.example.com"]),
    config
  );
  const output = plan.items.map((item) => `${item.label}: ${item.detail}`).join("\n");

  assert.equal(plan.origin, "https://files.example.com");
  assert.equal(plan.routePattern, "files.example.com/*");
  assert.deepEqual(plan.routeHosts, ["old.example.com"]);
  assert.deepEqual(plan.matchingRoutes, []);
  assert.match(output, /origin-only https URL/);
  assert.match(output, /No configured route host currently matches files\.example\.com/);
  assert.match(output, /zone for files\.example\.com/);
  assert.match(output, /certificate readiness/);
  assert.match(output, /Passkeys are origin-bound/);
  assert.match(output, /Allow browser PUT requests from https:\/\/files\.example\.com/);
  assert.match(output, /--verify-domain/);
  assert.match(output, /Troubleshoot custom-domain readiness/);
  assert.match(output, /Passkey origin/);
  assert.match(output, /Worker-mediated uploads remain available/);
  assert.match(output, /never creates DNS records/);
});

test("custom-domain verification plan reports route health passkey CORS and recovery guidance", () => {
  const config = JSON.stringify({
    name: "glyph",
    main: "src/index.ts",
    vars: { APP_ENV: "production", PUBLIC_BASE_URL: "https://files.example.com" },
    routes: ["files.example.com/*"],
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
  const plan = buildCustomDomainVerificationPlan(
    parseArgs(["--verify-domain"]),
    config,
    {
      status: "ready",
      ok: true,
      detail: "https://files.example.com/health returned ok for Glyph.",
      recovery: null
    }
  );
  const output = plan.items.map((item) => `${item.status} ${item.label}: ${item.detail}`).join("\n");

  assert.equal(plan.origin, "https://files.example.com");
  assert.deepEqual(plan.routeHosts, ["files.example.com"]);
  assert.deepEqual(plan.matchingRoutes, ["files.example.com"]);
  assert.match(output, /ready Compare Wrangler route hints/);
  assert.match(output, /ready Check custom-domain health/);
  assert.match(output, /Expected admin URL: https:\/\/files\.example\.com\/admin/);
  assert.match(output, /Passkeys are origin-bound/);
  assert.match(output, /Allow browser PUT requests from https:\/\/files\.example\.com/);
  assert.match(output, /R2 CORS: direct and multipart uploads require AllowedOrigins/);
  assert.match(output, /Passkey origin: passkeys registered on workers\.dev/);
  assert.match(output, /read-only/);

  const mismatchPlan = buildCustomDomainVerificationPlan(
    parseArgs(["--verify-domain", "--public-base-url", "https://files.example.com"]),
    config.replace("files.example.com/*", "old.example.com/*"),
    {
      status: "blocked",
      ok: false,
      detail: "https://files.example.com/health could not be reached: fetch failed",
      recovery: "Confirm DNS is propagated, HTTPS certificate is active, the custom domain is attached to the Worker, and the Worker is deployed."
    }
  );
  const mismatchOutput = mismatchPlan.items.map((item) => `${item.status} ${item.label}: ${item.detail}`).join("\n");
  assert.deepEqual(mismatchPlan.matchingRoutes, []);
  assert.match(mismatchOutput, /needs attention Compare Wrangler route hints/);
  assert.match(mismatchOutput, /Route mismatch/);
  assert.match(mismatchOutput, /HTTPS certificate is active/);
  assert.match(mismatchOutput, /Health blocked/);
});

test("post-deploy verification plan checks health admin upload and recovery guidance", async () => {
  const config = JSON.stringify({
    name: "glyph",
    main: "src/index.ts",
    vars: { APP_ENV: "production", PUBLIC_BASE_URL: "https://files.example.com" },
    routes: ["files.example.com/*"],
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
  const checks = await checkDeployOrigin("https://files.example.com", async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/health") {
      return new Response(JSON.stringify({ ok: true, app: "glyph" }), { status: 200 });
    }
    if (path === "/admin") {
      return new Response("<title>Glyph Admin Login</title><h1>Use passkey</h1><p>Sign in with the passkey registered for this Glyph instance.</p>", { status: 200 });
    }
    if (path === "/") {
      return new Response('<p>Private file drop</p><h1>Glyph</h1><input name="file"><button>Upload</button>', { status: 200 });
    }
    return new Response("missing", { status: 404 });
  });
  const plan = buildDeployVerificationPlan(parseArgs(["--verify-deploy"]), config, checks);
  const output = plan.items.map((item) => `${item.status} ${item.label}: ${item.detail}`).join("\n");

  assert.equal(plan.origin, "https://files.example.com");
  assert.equal(plan.originKind, "custom-domain");
  assert.deepEqual(plan.matchingRoutes, ["files.example.com"]);
  assert.match(output, /ready Check health endpoint/);
  assert.match(output, /ready Check admin surface/);
  assert.match(output, /ready Check public upload surface/);
  assert.match(output, /Expected URLs and passkey origin/);
  assert.match(output, /Allow browser PUT requests from https:\/\/files\.example\.com/);
  assert.match(output, /Passkey origin: passkeys are origin-bound/);
  assert.match(output, /never uploads files/);

  const workersPlan = buildDeployVerificationPlan(
    parseArgs(["--verify-deploy", "--public-base-url", "https://glyph.example.workers.dev"]),
    validWranglerConfig,
    checks
  );
  assert.equal(workersPlan.originKind, "workers.dev");
  assert.match(workersPlan.items.map((item) => item.detail).join("\n"), /workers\.dev origin detected/);
});

test("post-deploy verification detects non-Glyph responses without mutating", async () => {
  const checks = await checkDeployOrigin("https://files.example.com", async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/health") {
      return new Response(JSON.stringify({ ok: true, app: "other" }), { status: 200 });
    }
    if (path === "/admin") {
      return new Response("<h1>Not Glyph</h1>", { status: 200 });
    }
    return new Response("<h1>Elsewhere</h1>", { status: 200 });
  });
  const plan = buildDeployVerificationPlan(
    parseArgs(["--verify-deploy", "--public-base-url", "https://files.example.com"]),
    validWranglerConfig,
    checks
  );
  const output = plan.items.map((item) => `${item.status} ${item.label}: ${item.detail}`).join("\n");
  const recovery = buildDeployVerificationRecoveryLines({
    validationError: null,
    origin: "https://files.example.com",
    host: "files.example.com",
    routeHosts: ["old.example.com"],
    matchingRoutes: [],
    checks,
    cors: buildR2CorsRecommendation(validWranglerConfig, { publicBaseUrl: "https://files.example.com" })
  }).join("\n");

  assert.match(output, /needs attention Check health endpoint/);
  assert.match(output, /needs attention Check admin surface/);
  assert.match(output, /needs attention Check public upload surface/);
  assert.match(recovery, /Route mismatch/);
  assert.match(recovery, /Health mismatch/);
  assert.match(recovery, /Admin mismatch/);
  assert.match(recovery, /Upload page mismatch/);
  assert.match(recovery, /never uploads files/);
});

test("custom-domain verification recovery lines cover common operator issues", () => {
  const lines = buildCustomDomainVerificationRecoveryLines({
    validationError: "vars.PUBLIC_BASE_URL must use https:// for deployed custom-domain passkeys and short links.",
    origin: null,
    host: null,
    routeHosts: [],
    matchingRoutes: [],
    health: {
      recovery: "Run the verification command from a networked terminal after manually attaching the custom domain."
    }
  }).join("\n");

  assert.match(lines, /Invalid origin/);
  assert.match(lines, /origin-only https URL/);
  assert.match(lines, /No origin/);
  assert.match(lines, /networked terminal/);
  assert.match(lines, /Safety boundary/);
});

test("custom-domain troubleshooting covers origin route health passkey and CORS issues", () => {
  const lines = buildCustomDomainTroubleshootingLines({
    validationError: null,
    origin: "https://files.example.com",
    host: "files.example.com",
    configuredPublicBaseUrl: "https://old.example.com",
    suppliedPublicBaseUrl: "https://files.example.com",
    routeHosts: ["old.example.com"],
    matchingRoutes: [],
    health: {
      status: "needs attention",
      ok: false,
      detail: "https://files.example.com/health responded, but the body did not look like Glyph health JSON.",
      recovery: "Confirm the custom domain is attached to this Glyph Worker, not another Worker or origin."
    }
  }).join("\n");

  assert.match(lines, /PUBLIC_BASE_URL mismatch/);
  assert.match(lines, /Route mismatch/);
  assert.match(lines, /Health mismatch/);
  assert.match(lines, /another Worker/);
  assert.match(lines, /Passkey origin/);
  assert.match(lines, /AllowedOrigins to include exactly https:\/\/files\.example\.com/);
  assert.match(lines, /Safety boundary/);
});

test("custom-domain health check maps success and failure results", async () => {
  const ok = await checkCustomDomainHealth(
    "https://files.example.com",
    async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, app: "glyph" })
    })
  );
  assert.equal(ok.status, "ready");
  assert.equal(ok.ok, true);

  const wrongWorker = await checkCustomDomainHealth(
    "https://files.example.com",
    async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, app: "other" })
    })
  );
  assert.equal(wrongWorker.status, "needs attention");
  assert.match(wrongWorker.recovery ?? "", /attached to this Glyph Worker/);

  const httpError = await checkCustomDomainHealth(
    "https://files.example.com",
    async () => ({
      ok: false,
      status: 525,
      text: async () => "ssl handshake failed"
    })
  );
  assert.equal(httpError.status, "blocked");
  assert.match(httpError.detail, /HTTP 525/);
  assert.match(httpError.recovery, /certificate is issued and active/);

  const fetchError = await checkCustomDomainHealth(
    "https://files.example.com",
    async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
    { timeoutMs: 1 }
  );
  assert.equal(fetchError.status, "blocked");
  assert.match(fetchError.recovery, /DNS is propagated/);

  const tlsError = await checkCustomDomainHealth(
    "https://files.example.com",
    async () => {
      throw new Error("TLS certificate expired");
    },
    { timeoutMs: 1 }
  );
  assert.equal(tlsError.status, "blocked");
  assert.match(tlsError.recovery, /HTTPS certificate/);
});

test("custom-domain config suggestion is gated and local-only", () => {
  const updated = buildCustomDomainWranglerConfig(
    validWranglerConfig,
    parseArgs(["--turnkey-domain", "--yes", "--public-base-url", "https://files.example.com"])
  );
  const parsed = JSON.parse(updated.configText);

  assert.equal(updated.changed, true);
  assert.equal(updated.error, null);
  assert.equal(parsed.vars.PUBLIC_BASE_URL, "https://files.example.com");
  assert.deepEqual(parsed.routes, [{ pattern: "files.example.com/*", custom_domain: true }]);
  assert.equal(validateWranglerConfig(updated.configText, { requireDeployReady: true }).errors.length, 0);

  const alreadyAligned = buildCustomDomainWranglerConfig(updated.configText, parseArgs(["--turnkey-domain", "--yes"]));
  assert.equal(alreadyAligned.changed, false);

  const invalid = buildCustomDomainWranglerConfig(validWranglerConfig, parseArgs(["--turnkey-domain"]));
  assert.equal(invalid.changed, false);
  assert.match(invalid.error ?? "", /PUBLIC_BASE_URL/);
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

test("direct upload setup plan gates secrets and CORS behind confirmation", () => {
  assert.deepEqual(
    buildR2CorsSetCommand("glyph-files", "/tmp/cors.json", { force: true }),
    ["pnpm", "wrangler", "r2", "bucket", "cors", "set", "glyph-files", "--file", "/tmp/cors.json", "--force"]
  );

  const configWithOrigin = validWranglerConfig.replace('"APP_ENV":"production"', '"APP_ENV":"production","PUBLIC_BASE_URL":"https://files.example.com"');
  const plan = buildDirectUploadSetupPlan(parseArgs(["--turnkey-secrets"]), configWithOrigin, {
    R2_ACCOUNT_ID: "account-id",
    R2_ACCESS_KEY_ID: "access-key-id",
    R2_SECRET_ACCESS_KEY: "do-not-print"
  });
  const details = plan.items.map((item) => item.detail).join("\n");
  const commands = plan.items.map((item) => item.command?.join(" ") ?? "").join("\n");

  assert.equal(plan.items.filter((item) => item.mutates).length, 3);
  assert.match(commands, /pnpm wrangler secret put R2_ACCOUNT_ID/);
  assert.match(commands, /pnpm wrangler secret put R2_ACCESS_KEY_ID/);
  assert.match(commands, /pnpm wrangler secret put R2_SECRET_ACCESS_KEY/);
  assert.match(commands, /pnpm wrangler secret put R2_BUCKET_NAME/);
  assert.match(details, /never prints or stores the secret value/);
  assert.match(details, /Worker-mediated uploads remain the safe fallback/);
  assert.match(plan.cors.corsJson ?? "", /"AllowedOrigins": \[\n      "https:\/\/files\.example\.com"\n    \]/);
  assert.equal(plan.items.some((item) => item.label === "Apply reviewed R2 CORS" && item.mutates), false);
  assert.doesNotMatch(`${details}\n${commands}`, /do-not-print/);

  const applyPlan = buildDirectUploadSetupPlan(parseArgs(["--turnkey-secrets", "--yes", "--apply-cors"]), configWithOrigin, {});
  const corsItem = applyPlan.items.find((item) => item.label === "Apply reviewed R2 CORS");
  assert.equal(corsItem?.mutates, true);
  assert.match(corsItem?.command?.join(" ") ?? "", /wrangler r2 bucket cors set glyph-files --file <generated-cors-json-file> --force/);
});

test("direct upload setup plan keeps CORS manual without a public origin", () => {
  const plan = buildDirectUploadSetupPlan(parseArgs(["--turnkey-secrets"]), validWranglerConfig, {});
  const output = plan.items.map((item) => `${item.label}: ${item.detail}`).join("\n");

  assert.equal(plan.cors.corsJson, null);
  assert.match(output, /CORS cannot be applied until PUBLIC_BASE_URL or --public-base-url/);
  assert.match(output, /Worker-mediated uploads remain the safe fallback/);
  assert.equal(plan.items.some((item) => item.label === "Apply reviewed R2 CORS" && item.mutates), false);
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
