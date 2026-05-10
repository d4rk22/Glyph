#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DATABASE_NAME = "glyph";
export const DEFAULT_BUCKET_NAME = "glyph-files";
export const DEFAULT_DRY_RUN_OUTDIR = "/tmp/glyph-deploy-dry-run";
export const PREFLIGHT_CHECKLIST_FILENAME = "glyph-preflight-checklist.md";
export const PLACEHOLDER_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const DIRECT_UPLOAD_SECRET_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
export const OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES = ["R2_BUCKET_NAME"];
export const DEFAULT_SCHEDULE_CRON = "0 3 * * *";

export function parseArgs(argv) {
  const options = {
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
    cloudflareRehearsal: false,
    verifyDomain: false,
    verifyDeploy: false,
    applyCors: false,
    readiness: false,
    skipInstall: false,
    reuseResources: false,
    database: DEFAULT_DATABASE_NAME,
    databaseId: null,
    bucket: DEFAULT_BUCKET_NAME,
    publicBaseUrl: null,
    outdir: DEFAULT_DRY_RUN_OUTDIR,
    outdirExplicit: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--setup") {
      options.setup = true;
    } else if (arg === "--turnkey") {
      options.turnkey = true;
    } else if (arg === "--turnkey-secrets") {
      options.turnkeySecrets = true;
    } else if (arg === "--turnkey-domain") {
      options.turnkeyDomain = true;
    } else if (arg === "--turnkey-schedule") {
      options.turnkeySchedule = true;
    } else if (arg === "--turnkey-rehearse") {
      options.turnkeyRehearse = true;
    } else if (arg === "--turnkey-examples") {
      options.turnkeyExamples = true;
    } else if (arg === "--preflight") {
      options.preflight = true;
    } else if (arg === "--cloudflare-rehearsal") {
      options.cloudflareRehearsal = true;
    } else if (arg === "--verify-domain") {
      options.verifyDomain = true;
    } else if (arg === "--verify-deploy") {
      options.verifyDeploy = true;
    } else if (arg === "--apply-cors") {
      options.applyCors = true;
    } else if (arg === "--readiness") {
      options.readiness = true;
    } else if (arg === "--skip-install") {
      options.skipInstall = true;
    } else if (arg === "--reuse-resources") {
      options.reuseResources = true;
    } else if (arg === "--database") {
      options.database = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--database=")) {
      options.database = arg.slice("--database=".length);
    } else if (arg === "--d1-database-id" || arg === "--database-id") {
      options.databaseId = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--d1-database-id=")) {
      options.databaseId = arg.slice("--d1-database-id=".length);
    } else if (arg.startsWith("--database-id=")) {
      options.databaseId = arg.slice("--database-id=".length);
    } else if (arg === "--bucket") {
      options.bucket = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--bucket=")) {
      options.bucket = arg.slice("--bucket=".length);
    } else if (arg === "--public-base-url") {
      options.publicBaseUrl = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--public-base-url=")) {
      options.publicBaseUrl = arg.slice("--public-base-url=".length);
    } else if (arg === "--outdir") {
      options.outdir = requireValue(argv, index, arg);
      options.outdirExplicit = true;
      index += 1;
    } else if (arg.startsWith("--outdir=")) {
      options.outdir = arg.slice("--outdir=".length);
      options.outdirExplicit = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.check && options.yes) {
    throw new Error("Use either --check or --yes, not both.");
  }

  if (options.check && options.setup) {
    throw new Error("Use --setup by itself for a setup plan, or --setup --yes to create resources.");
  }

  if (options.setup && options.turnkey) {
    throw new Error("Use either --setup or --turnkey, not both.");
  }

  if (options.turnkeySecrets && (options.check || options.setup || options.turnkey || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy)) {
    throw new Error("Use --turnkey-secrets by itself, or with --yes and optional --apply-cors.");
  }

  if (options.turnkeyDomain && (options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors)) {
    throw new Error("Use --turnkey-domain by itself, or with --yes and optional --public-base-url.");
  }

  if (options.turnkeySchedule && (options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors)) {
    throw new Error("Use --turnkey-schedule by itself, or with --yes to write reviewed local cron trigger config.");
  }

  if (options.turnkeyRehearse && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors || options.readiness)) {
    throw new Error("Use --turnkey-rehearse by itself with optional --public-base-url; it is read-only.");
  }

  if (options.turnkeyExamples && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors || options.readiness)) {
    throw new Error("Use --turnkey-examples by itself with optional --public-base-url; it is read-only.");
  }

  if (options.preflight && (options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors || options.readiness)) {
    throw new Error("Use --preflight by itself with optional --public-base-url; it is a read-only checklist mode.");
  }

  if (options.preflight && options.yes && !options.outdirExplicit) {
    throw new Error("Use --preflight --yes only with --outdir to overwrite an existing local checklist file.");
  }

  if (options.cloudflareRehearsal && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.verifyDomain || options.verifyDeploy || options.applyCors || options.readiness || options.outdirExplicit)) {
    throw new Error("Use --cloudflare-rehearsal by itself with optional --public-base-url; it is a read-only real-account checklist mode.");
  }

  if (options.verifyDomain && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDeploy || options.applyCors)) {
    throw new Error("Use --verify-domain by itself with optional --public-base-url; it is read-only.");
  }

  if (options.verifyDeploy && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.applyCors)) {
    throw new Error("Use --verify-deploy by itself with optional --public-base-url; it is read-only.");
  }

  if (options.applyCors && (!options.turnkeySecrets || !options.yes)) {
    throw new Error("Use --apply-cors only with --turnkey-secrets --yes after reviewing the generated CORS recommendation.");
  }

  if (options.readiness && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.turnkeyDomain || options.turnkeySchedule || options.turnkeyRehearse || options.turnkeyExamples || options.preflight || options.cloudflareRehearsal || options.verifyDomain || options.verifyDeploy || options.applyCors)) {
    throw new Error("Use --readiness by itself; it is a read-only report mode.");
  }

  if (options.database.trim().length === 0) {
    throw new Error("Database name cannot be empty.");
  }

  if (options.databaseId !== null && options.databaseId.trim().length === 0) {
    throw new Error("D1 database ID cannot be empty.");
  }

  if (options.databaseId === PLACEHOLDER_D1_DATABASE_ID) {
    throw new Error("D1 database ID cannot be the placeholder value.");
  }

  if (options.bucket.trim().length === 0) {
    throw new Error("R2 bucket name cannot be empty.");
  }

  if (options.publicBaseUrl !== null && options.publicBaseUrl.trim().length === 0) {
    throw new Error("PUBLIC_BASE_URL cannot be empty.");
  }

  if (options.publicBaseUrl !== null) {
    const publicBaseResult = validatePublicBaseUrl(options.publicBaseUrl);
    if (publicBaseResult.error) {
      throw new Error(publicBaseResult.error);
    }
  }

  if (options.outdir.trim().length === 0) {
    throw new Error("Dry-run output directory cannot be empty.");
  }

  return options;
}

export function validateWranglerConfig(configText, options = {}) {
  const requireDeployReady = options.requireDeployReady ?? false;
  const errors = [];
  const warnings = [];
  let config;

  try {
    config = JSON.parse(stripJsonComments(configText));
  } catch (error) {
    return {
      errors: [`wrangler.jsonc could not be parsed: ${error instanceof Error ? error.message : "invalid JSONC"}`],
      warnings
    };
  }

  if (config.name !== "glyph") {
    warnings.push("wrangler.jsonc worker name is not glyph.");
  }

  if (config.main !== "src/index.ts") {
    errors.push("wrangler.jsonc must point main at src/index.ts.");
  }

  if (!Array.isArray(config.d1_databases) || !config.d1_databases.some((binding) => binding?.binding === "DB")) {
    errors.push("wrangler.jsonc must define a D1 binding named DB.");
  }

  const dbBinding = Array.isArray(config.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : undefined;
  if (dbBinding && dbBinding.database_name !== DEFAULT_DATABASE_NAME) {
    warnings.push(`D1 binding DB points at database ${String(dbBinding.database_name)} instead of ${DEFAULT_DATABASE_NAME}.`);
  }

  if (dbBinding && dbBinding.migrations_dir !== "migrations") {
    errors.push("D1 binding DB must use migrations_dir \"migrations\".");
  }

  if (requireDeployReady && dbBinding?.database_id === PLACEHOLDER_D1_DATABASE_ID) {
    errors.push("Replace the placeholder D1 database_id in wrangler.jsonc before deploying.");
  }

  if (!Array.isArray(config.r2_buckets) || !config.r2_buckets.some((binding) => binding?.binding === "FILES")) {
    errors.push("wrangler.jsonc must define an R2 binding named FILES.");
  }

  if (!config.vars || typeof config.vars.APP_ENV !== "string" || config.vars.APP_ENV.length === 0) {
    errors.push("wrangler.jsonc must define vars.APP_ENV.");
  }

  const publicBaseUrl = config.vars?.PUBLIC_BASE_URL;
  const routeHosts = wranglerRouteHosts(config);
  const cronValidation = validateWranglerCronTriggers(config);
  errors.push(...cronValidation.errors);
  warnings.push(...cronValidation.warnings);

  if (publicBaseUrl !== undefined) {
    if (typeof publicBaseUrl !== "string") {
      errors.push("vars.PUBLIC_BASE_URL must be a string when configured.");
    } else {
      const publicBaseResult = validatePublicBaseUrl(publicBaseUrl);
      if (publicBaseResult.error) {
        errors.push(publicBaseResult.error);
      } else if (publicBaseResult.url) {
        const publicBaseHost = publicBaseResult.url.hostname.toLowerCase();
        if (routeHosts.length === 0) {
          warnings.push("vars.PUBLIC_BASE_URL is set, but wrangler.jsonc does not declare routes; confirm the Worker is attached to that custom domain manually.");
        } else if (!routeHosts.some((routeHost) => routeHostMatches(routeHost, publicBaseHost))) {
          warnings.push(`vars.PUBLIC_BASE_URL host ${publicBaseHost} does not match configured Wrangler route host(s): ${routeHosts.join(", ")}.`);
        }
      }
    }
  } else if (routeHosts.length > 0) {
    warnings.push("wrangler.jsonc has route/custom-domain configuration, but vars.PUBLIC_BASE_URL is not set; generated short links will use the request origin.");
  }

  return { errors, warnings };
}

export function summarizeDeploymentTarget(configText) {
  const config = parseWranglerConfig(configText);
  if (!config) {
    return ["Deployment target: wrangler.jsonc could not be parsed."];
  }

  const lines = [];
  const publicBaseUrl = typeof config.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const routeHosts = wranglerRouteHosts(config);
  const cronTriggers = wranglerCronTriggers(config);

  lines.push(`Worker name: ${typeof config.name === "string" ? config.name : "unknown"}`);
  lines.push(publicBaseUrl ? `Public base URL: ${publicBaseUrl}` : "Public base URL: request origin fallback");
  lines.push(routeHosts.length > 0 ? `Wrangler route hosts: ${routeHosts.join(", ")}` : "Wrangler route hosts: none configured");
  lines.push(
    cronTriggers.length > 0
      ? `Scheduled update check trigger(s): ${cronTriggers.join(", ")}`
      : "Scheduled update check trigger(s): none configured"
  );
  lines.push("Scheduled update checks also require a valid update source and read-only scheduled checks enabled in /admin.");
  lines.push("Scheduled maintenance also requires scheduled maintenance enabled in /admin.");

  return lines;
}

export function buildAuthReadinessLines(env = process.env, options = {}) {
  const hasToken = typeof env.CLOUDFLARE_API_TOKEN === "string" && env.CLOUDFLARE_API_TOKEN.trim().length > 0;
  const isInteractive = options.isInteractive ?? Boolean(process.stdout.isTTY);
  const lines = [];

  if (hasToken) {
    lines.push("Cloudflare auth: CLOUDFLARE_API_TOKEN is set for non-interactive Wrangler commands.");
    lines.push("Token readiness: ensure the token can read account resources, manage Workers, manage D1, manage R2, and apply D1 migrations for the target account.");
  } else if (isInteractive) {
    lines.push("Cloudflare auth: no CLOUDFLARE_API_TOKEN detected; Wrangler can use an interactive `pnpm wrangler login` session.");
    lines.push("Token readiness: CI and other non-interactive shells still need CLOUDFLARE_API_TOKEN with Workers, D1, and R2 access.");
  } else {
    lines.push("Cloudflare auth: CLOUDFLARE_API_TOKEN is required in this non-interactive environment before Wrangler can inspect or mutate Cloudflare resources.");
    lines.push("Token readiness: create a scoped Cloudflare API token for the target account with Workers, D1, and R2 access, then rerun the deploy helper.");
  }

  return lines;
}

export function buildDeploySteps(options) {
  const steps = [];

  if (!options.skipInstall) {
    steps.push({ label: "Install locked dependencies", command: ["pnpm", "install", "--frozen-lockfile"] });
  }

  steps.push(
    { label: "Typecheck", command: ["pnpm", "run", "typecheck"] },
    { label: "Run tests", command: ["pnpm", "test"] },
    {
      label: options.yes ? "Apply remote D1 migrations" : "Check remote D1 migrations",
      command: [
        "pnpm",
        "wrangler",
        "d1",
        "migrations",
        options.yes ? "apply" : "list",
        options.database,
        "--remote"
      ]
    },
    {
      label: "Wrangler deploy dry-run",
      command: ["pnpm", "wrangler", "deploy", "--dry-run", "--outdir", options.outdir]
    }
  );

  if (options.yes) {
    steps.push({ label: "Deploy Worker", command: ["pnpm", "wrangler", "deploy"] });
  }

  return steps;
}

export function missingCommandMessage(commandName) {
  if (commandName === "pnpm") {
    return "pnpm was not found on PATH. Enable Corepack (`corepack enable`) or install pnpm 11, then rerun the same Glyph deploy command.";
  }

  return `${commandName} was not found on PATH. Install it or adjust PATH, then rerun the same Glyph deploy command.`;
}

export function buildRemoteMigrationPlan(options) {
  return [
    `Remote migrations: ${options.yes ? "apply" : "list/check"} D1 migrations for database ${options.database}.`,
    options.yes
      ? "Remote migration gate: --yes explicitly permits applying remote D1 migrations before deploy."
      : "Remote migration gate: dry-run/check mode only lists remote D1 migrations; rerun with --yes only after reviewing migration files.",
    "Recovery: if Wrangler reports missing auth in a non-interactive shell, set CLOUDFLARE_API_TOKEN and rerun the same command."
  ];
}

export function buildSetupPlan(options, configText = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const publicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" ? config.vars.PUBLIC_BASE_URL.trim() : "";
  const cronTriggers = config ? wranglerCronTriggers(config) : [];

  return [
    {
      label: "Create D1 database",
      command: ["pnpm", "wrangler", "d1", "create", options.database],
      mutates: true,
      detail: dbBinding?.database_id === PLACEHOLDER_D1_DATABASE_ID
        ? "After creation, copy the returned database_id into wrangler.jsonc for binding DB."
        : "Skip this command if the D1 database already exists; wrangler.jsonc already has a non-placeholder database_id."
    },
    {
      label: "Create R2 bucket",
      command: ["pnpm", "wrangler", "r2", "bucket", "create", options.bucket],
      mutates: true,
      detail: r2Binding?.bucket_name === options.bucket
        ? "Skip this command if the R2 bucket already exists."
        : `wrangler.jsonc binding FILES currently points at ${String(r2Binding?.bucket_name ?? "no bucket")}; align it with ${options.bucket} before deploy.`
    },
    {
      label: "Confirm Worker bindings",
      mutates: false,
      detail: `wrangler.jsonc should bind D1 as DB, R2 as FILES, APP_ENV, and database ${options.database}.`
    },
    {
      label: "Configure optional public origin",
      mutates: false,
      detail: publicBaseUrl
        ? `PUBLIC_BASE_URL is configured as ${publicBaseUrl}; confirm any route/custom-domain host points at the same origin.`
        : "PUBLIC_BASE_URL is not configured; generated short links will use the request origin."
    },
    {
      label: "Configure direct-upload secrets",
      mutates: false,
      detail: `For direct or multipart uploads, set required secrets with ${buildSecretPutCommand("R2_ACCOUNT_ID").join(" ")}, ${buildSecretPutCommand("R2_ACCESS_KEY_ID").join(" ")}, and ${buildSecretPutCommand("R2_SECRET_ACCESS_KEY").join(" ")}. Optionally set ${OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES[0]} when the presigned-upload bucket name differs from ${options.bucket}. Do not commit secrets.`
    },
    {
      label: "Configure R2 CORS",
      mutates: false,
      detail: buildR2CorsRecommendation(configText, { bucket: options.bucket }).summary
    },
    {
      label: "Configure optional scheduled work",
      mutates: false,
      detail: cronTriggers.length > 0
        ? `Wrangler cron trigger(s) found: ${cronTriggers.join(", ")}. Read-only scheduled update checks still require a valid update source and read-only scheduled checks enabled in /admin; scheduled maintenance requires scheduled maintenance enabled in /admin. Use --turnkey-schedule to review or adjust local cron trigger config. Glyph does not create triggers automatically.`
        : "No Wrangler cron trigger is configured. To use read-only scheduled update checks or scheduled maintenance, run pnpm run deploy:glyph -- --turnkey-schedule to review a local cron trigger suggestion, then enable the desired scheduled behavior in /admin. Glyph does not create triggers automatically."
    },
    {
      label: "Run deploy readiness check",
      command: ["pnpm", "run", "deploy:glyph", "--", "--check", "--database", options.database],
      mutates: false,
      detail: "Run this after wrangler.jsonc has the real D1 database_id and any optional origin settings."
    }
  ];
}

export function buildTurnkeyPlan(options, configText = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const publicBaseUrl = options.publicBaseUrl
    ?? (typeof config?.vars?.PUBLIC_BASE_URL === "string" ? config.vars.PUBLIC_BASE_URL.trim() : "");
  const hasRealDatabaseId = options.databaseId
    || (typeof dbBinding?.database_id === "string" && dbBinding.database_id !== PLACEHOLDER_D1_DATABASE_ID);
  const shouldCreateD1 = !options.reuseResources && !options.databaseId && !hasRealDatabaseId;
  const shouldCreateR2 = !options.reuseResources;

  return [
    {
      label: "Verify local prerequisites",
      mutates: false,
      detail: "Checks Node.js, pnpm, Wrangler, project files, Wrangler authentication, and CLOUDFLARE_API_TOKEN readiness before any deploy action.",
      commands: [
        ["node", "--version"],
        ["pnpm", "--version"],
        ["pnpm", "wrangler", "--version"],
        ["pnpm", "wrangler", "whoami"]
      ]
    },
    {
      label: "Discover existing Cloudflare resources",
      mutates: false,
      detail: `Checks whether D1 database ${options.database} and R2 bucket ${options.bucket} already exist so confirmed turnkey setup can reuse them when safe.`,
      commands: [
        ["pnpm", "wrangler", "d1", "list", "--json"],
        ["pnpm", "wrangler", "r2", "bucket", "list"]
      ]
    },
    {
      label: shouldCreateD1 ? "Create D1 database" : "Reuse D1 database",
      command: shouldCreateD1 ? ["pnpm", "wrangler", "d1", "create", options.database] : undefined,
      mutates: shouldCreateD1,
      detail: shouldCreateD1
        ? "With --yes, Wrangler creates the D1 database and Glyph attempts to capture the returned database_id for local config."
        : "Uses the configured or supplied D1 database_id; no D1 create command is needed."
    },
    {
      label: shouldCreateR2 ? "Create or confirm R2 bucket" : "Reuse R2 bucket",
      command: shouldCreateR2 ? ["pnpm", "wrangler", "r2", "bucket", "create", options.bucket] : undefined,
      mutates: shouldCreateR2,
      detail: shouldCreateR2
        ? "With --yes, Wrangler creates the R2 bucket. If the bucket already exists, re-run with --reuse-resources after confirming ownership."
        : `Uses existing R2 bucket ${options.bucket}; confirm it belongs to the intended Cloudflare account.`
    },
    {
      label: "Update or generate Wrangler config",
      mutates: true,
      detail: hasRealDatabaseId
        ? `With --yes, writes DB/FILES bindings for database ${options.database}, bucket ${options.bucket}, and any supplied PUBLIC_BASE_URL.`
        : "No real D1 database_id is available yet; the helper will not deploy until a real ID is supplied or captured from Wrangler."
    },
    {
      label: "Validate deployment readiness",
      mutates: false,
      detail: publicBaseUrl
        ? `Validates bindings, https PUBLIC_BASE_URL ${publicBaseUrl}, custom-domain route hints, scheduled trigger readiness, remote migration gates, and direct/multipart credential plus R2 CORS guidance.`
        : "Validates bindings, request-origin fallback, custom-domain route hints, scheduled trigger readiness, remote migration gates, and direct/multipart credential plus R2 CORS guidance."
    },
    {
      label: "Rehearse end-to-end deploy",
      mutates: false,
      detail: "Before mutating local config or Cloudflare resources, run pnpm run deploy:glyph -- --turnkey-rehearse to review prerequisites, resource plans, config state, migration and deploy gates, direct/multipart follow-up, custom-domain verification, scheduled-trigger setup, URLs, and recovery steps in one read-only operator report."
    },
    {
      label: "Review turnkey examples",
      mutates: false,
      detail: "Run pnpm run deploy:glyph -- --turnkey-examples for read-only command transcripts covering fresh checkout, missing auth, resource reuse, placeholder D1 IDs, migrations, direct/multipart follow-up, custom domains, scheduled triggers, and post-deploy verification."
    },
    {
      label: "Export deploy preflight checklist",
      mutates: false,
      detail: "Run pnpm run deploy:glyph -- --preflight to print a concise markdown checklist with readiness status, recommended next commands, and operator-owned Cloudflare tasks before deploying."
    },
    {
      label: "Verify deployed Glyph origin",
      mutates: false,
      detail: "After an intentional deploy, run pnpm run deploy:glyph -- --verify-deploy --public-base-url https://files.example.com or the workers.dev origin printed by Wrangler to check /health, /admin, /, passkey origin guidance, R2 CORS alignment, and recovery steps without uploading files or mutating anything."
    },
    {
      label: "Configure direct/multipart upload readiness",
      mutates: false,
      detail: "After the basic deployment path is ready, run pnpm run deploy:glyph -- --turnkey-secrets to plan interactive Wrangler secret setup and reviewed R2 CORS application. Confirmed secret/CORS setup is separate from Worker deploy and remote migrations."
    },
    {
      label: "Configure custom-domain readiness",
      mutates: false,
      detail: "For a custom domain, run pnpm run deploy:glyph -- --turnkey-domain --public-base-url https://files.example.com to review local PUBLIC_BASE_URL, route hints, passkey origin notes, R2 CORS alignment, and manual Cloudflare follow-up."
    },
    {
      label: "Verify custom-domain attachment",
      mutates: false,
      detail: "After manually attaching DNS/custom-domain routing in Cloudflare, run pnpm run deploy:glyph -- --verify-domain --public-base-url https://files.example.com to check route hints, /health, /admin, passkey origin guidance, and R2 CORS alignment without mutating anything."
    },
    {
      label: "Configure scheduled trigger readiness",
      mutates: false,
      detail: "For optional read-only update notices or storage/R2 maintenance, run pnpm run deploy:glyph -- --turnkey-schedule to review local Wrangler cron trigger config. Confirmed schedule setup is separate from admin opt-in settings, remote migrations, and deploy."
    },
    {
      label: "Run checks, migrations, dry-run, and deploy",
      mutates: true,
      detail: "With --yes and deploy-ready config, runs install, typecheck, tests, remote D1 migrations, Wrangler dry-run, and Wrangler deploy."
    },
    {
      label: "Print live URLs and follow-up tasks",
      mutates: false,
      detail: "Reports the public/admin URL when known, plus manual Cloudflare tasks that remain operator-owned."
    }
  ];
}

export function parseD1DatabaseList(output) {
  const json = parseJsonOutput(output);
  if (json) {
    const rows = Array.isArray(json) ? json : Array.isArray(json.result) ? json.result : [];
    return rows
      .map((row) => ({
        name: String(row?.name ?? row?.database_name ?? ""),
        id: String(row?.uuid ?? row?.id ?? row?.database_id ?? "")
      }))
      .filter((row) => row.name.length > 0 && row.id.length > 0);
  }

  const rows = [];
  for (const line of output.split(/\r?\n/u)) {
    const id = extractD1DatabaseId(line);
    if (!id) {
      continue;
    }
    const beforeId = line.slice(0, line.indexOf(id));
    const parts = beforeId
      .replace(/[│|]/gu, " ")
      .trim()
      .split(/\s{2,}|\t/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const name = parts.at(-1);
    if (name && !/^name$/iu.test(name)) {
      rows.push({ name, id });
    }
  }

  return rows;
}

export function parseR2BucketList(output) {
  const json = parseJsonOutput(output);
  if (json) {
    const rows = Array.isArray(json) ? json : Array.isArray(json.result) ? json.result : [];
    return rows
      .map((row) => typeof row === "string" ? row : String(row?.name ?? row?.bucket_name ?? ""))
      .filter((name) => name.length > 0);
  }

  return output
    .split(/\r?\n/u)
    .map((line) => line.replace(/[│|]/gu, " ").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(name|bucket|buckets|created|jurisdiction|location|─|-|\+|\s)+$/iu.test(line))
    .map((line) => line.split(/\s{2,}|\t/u)[0]?.trim() ?? "")
    .filter((name) => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(name));
}

export function findD1DatabaseId(output, databaseName) {
  return parseD1DatabaseList(output).find((database) => database.name === databaseName)?.id ?? null;
}

export function hasR2Bucket(output, bucketName) {
  return parseR2BucketList(output).includes(bucketName);
}

export function classifyWranglerFailure(output) {
  if (/CLOUDFLARE_API_TOKEN|non-interactive environment/iu.test(output)) {
    return "Wrangler needs CLOUDFLARE_API_TOKEN in non-interactive environments. Set a scoped token for the intended Cloudflare account with Workers, D1, and R2 access, or run from an interactive shell where Wrangler is logged in.";
  }

  if (/not logged in|not authenticated|wrangler login|not authorized|authentication/iu.test(output)) {
    return "Wrangler authentication is missing or does not have access to the requested account. Run pnpm wrangler login, or set CLOUDFLARE_API_TOKEN with D1, R2, and Workers permissions.";
  }

  if (/already exists|already in use|name.*taken/iu.test(output)) {
    return "The requested Cloudflare resource appears to already exist. Re-run --turnkey without --yes to review readiness, then use --turnkey --yes --reuse-resources with the real --d1-database-id when needed.";
  }

  if (/database_id|placeholder/iu.test(output)) {
    return "The D1 database exists but wrangler.jsonc still needs the real database_id. Run pnpm wrangler d1 list --json, copy the ID for the Glyph database, then re-run --turnkey --yes --reuse-resources --d1-database-id <real-id>.";
  }

  if (/permission|scope|forbidden|unauthorized|code:\s*10000|authentication error/iu.test(output)) {
    return "Wrangler reached Cloudflare but the token/session may not have enough access. Confirm the token targets the intended account and includes Workers, D1, R2, and D1 migration permissions.";
  }

  return null;
}

export function buildTurnkeyRecoveryLines(options, context = {}) {
  const lines = [];

  if (context.reason) {
    lines.push(`Recovery: ${context.reason}`);
  }

  if (context.d1CreatedWithoutId) {
    lines.push(`Recovery: run pnpm wrangler d1 list --json, find database ${options.database}, then re-run --turnkey --yes --reuse-resources --d1-database-id <real-id>.`);
  }

  if (context.r2AlreadyExists) {
    lines.push(`Recovery: R2 bucket ${options.bucket} already exists. Confirm it belongs to the intended account, then re-run with --reuse-resources.`);
  }

  lines.push("Recovery: if Wrangler auth fails in CI or another non-interactive shell, set CLOUDFLARE_API_TOKEN before rerunning turnkey.");
  lines.push("Recovery: if Cloudflare reports permission or scope errors, confirm the token can read account resources, manage Workers, manage D1, manage R2, and apply D1 migrations.");
  lines.push("Recovery: if PUBLIC_BASE_URL is rejected, use an origin-only https URL such as https://files.example.com.");
  lines.push("Recovery: direct and multipart upload modes also need R2 S3 credentials and bucket CORS; Worker-mediated uploads remain the fallback until those are configured.");

  return [...new Set(lines)];
}

export function buildSecretPutCommand(secretName) {
  return ["pnpm", "wrangler", "secret", "put", secretName];
}

export function buildR2CorsSetCommand(bucketName, filePath, options = {}) {
  const command = ["pnpm", "wrangler", "r2", "bucket", "cors", "set", bucketName, "--file", filePath];
  if (options.force) {
    command.push("--force");
  }
  return command;
}

export function buildDirectUploadSecretPlan(env = process.env) {
  return [...DIRECT_UPLOAD_SECRET_NAMES, ...OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES].map((name) => ({
    name,
    required: DIRECT_UPLOAD_SECRET_NAMES.includes(name),
    present: typeof env[name] === "string" && env[name].trim().length > 0,
    command: buildSecretPutCommand(name)
  }));
}

export function buildR2CorsRecommendation(configText = null, options = {}) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const originValue = options.publicBaseUrl
    ?? (typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
      ? config.vars.PUBLIC_BASE_URL.trim()
      : null);
  const bucketName = options.bucket
    ?? (Array.isArray(config?.r2_buckets)
      ? config.r2_buckets.find((binding) => binding?.binding === "FILES")?.bucket_name
      : null)
    ?? DEFAULT_BUCKET_NAME;

  if (!originValue) {
    return {
      origin: null,
      bucketName,
      corsJson: null,
      summary: "Once the deployed Glyph origin is known, allow browser PUT requests from it and expose ETag for multipart uploads.",
      lines: [
        `R2 CORS recommendation: bucket ${bucketName} needs the deployed Glyph origin before CORS can be configured.`,
        "Set PUBLIC_BASE_URL to the final https:// origin, or use the workers.dev/custom-domain origin printed by Wrangler deploy.",
        "Worker-mediated uploads remain the fallback until direct/multipart secrets and R2 CORS are ready."
      ]
    };
  }

  const validation = validatePublicBaseUrl(originValue);
  if (validation.error || !validation.url) {
    return {
      origin: null,
      bucketName,
      corsJson: null,
      summary: `R2 CORS cannot be recommended until PUBLIC_BASE_URL is fixed: ${validation.error}`,
      lines: [
        `R2 CORS blocked: ${validation.error}`,
        "Use an origin-only https URL such as https://files.example.com.",
        "Worker-mediated uploads remain the fallback until direct/multipart secrets and R2 CORS are ready."
      ]
    };
  }

  const origin = validation.url.origin;
  const corsRules = [
    {
      AllowedOrigins: [origin],
      AllowedMethods: ["PUT"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600
    }
  ];
  const corsJson = JSON.stringify(corsRules, null, 2);

  return {
    origin,
    bucketName,
    corsJson,
    summary: `Allow browser PUT requests from ${origin} to R2 bucket ${bucketName} and expose ETag for multipart uploads.`,
    lines: [
      `R2 CORS recommendation: apply this rule to bucket ${bucketName} before enabling direct or multipart uploads.`,
      `Allowed origin: ${origin}`,
      "Allowed methods: PUT",
      "Allowed headers: *",
      "Expose headers: ETag",
      "Suggested CORS JSON:",
      corsJson,
      "Apply CORS in the Cloudflare dashboard/API, or re-run --turnkey-secrets --yes --apply-cors after reviewing it; the deploy helper does not apply CORS automatically.",
      "Worker-mediated uploads remain the fallback until direct/multipart secrets and R2 CORS are ready."
    ]
  };
}

export function buildDirectUploadReadinessLines(configText = null, env = process.env) {
  const secretPlan = buildDirectUploadSecretPlan(env);
  const missingRequired = secretPlan.filter((secret) => secret.required && !secret.present);
  const presentRequired = secretPlan.filter((secret) => secret.required && secret.present);
  const optionalBucketSecret = secretPlan.find((secret) => secret.name === "R2_BUCKET_NAME");
  const cors = buildR2CorsRecommendation(configText);
  const lines = [];

  if (missingRequired.length === 0) {
    lines.push("Direct/multipart secrets: required R2 S3-compatible environment values are present in this shell; verify matching Wrangler secrets exist for the deployed Worker.");
  } else {
    lines.push(`Direct/multipart secrets: ${missingRequired.map((secret) => secret.name).join(", ")} not detected in this shell. Worker-mediated uploads remain the safe fallback until matching Wrangler secrets are set.`);
  }

  if (presentRequired.length > 0 && missingRequired.length > 0) {
    lines.push(`Direct/multipart secrets: ${presentRequired.map((secret) => secret.name).join(", ")} detected locally, but direct/multipart mode is blocked until every required secret is present in the deployed Worker.`);
  }

  if (optionalBucketSecret?.present) {
    lines.push("Optional direct/multipart secret: R2_BUCKET_NAME is present locally; verify it matches the FILES bucket or the intended presigned-upload bucket.");
  } else {
    lines.push(`Optional direct/multipart secret: R2_BUCKET_NAME is not detected; Glyph will use the R2 binding bucket name unless a deployed secret overrides it.`);
  }

  lines.push("Recommended Wrangler secret commands (values are entered interactively and are not printed):");
  for (const secret of secretPlan) {
    const suffix = secret.required ? "required" : "optional";
    lines.push(`- ${secret.command.join(" ")} (${suffix})`);
  }

  lines.push(`R2 CORS readiness: ${cors.summary}`);
  lines.push(...cors.lines);
  lines.push("Secret safety: use Wrangler secrets or the Cloudflare dashboard; do not write R2 secret access keys into source-controlled files.");
  lines.push("Safety gate: this helper only prints secret and CORS guidance; it does not set secrets, echo secret values, or apply CORS automatically.");

  return lines;
}

export function buildDirectUploadSetupPlan(options, configText = null, env = process.env) {
  const secretPlan = buildDirectUploadSecretPlan(env);
  const requiredSecrets = secretPlan.filter((secret) => secret.required);
  const optionalSecrets = secretPlan.filter((secret) => !secret.required);
  const cors = buildR2CorsRecommendation(configText, {
    bucket: options.bucket,
    publicBaseUrl: options.publicBaseUrl
  });
  const items = [
    {
      label: "Review direct/multipart secret requirements",
      mutates: false,
      detail: `Required deployed Wrangler secrets: ${DIRECT_UPLOAD_SECRET_NAMES.join(", ")}. Optional deployed secret: ${OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES.join(", ")}. Values are entered through Wrangler or Cloudflare and must not be committed.`
    },
    ...requiredSecrets.map((secret) => ({
      label: `Set required Wrangler secret ${secret.name}`,
      command: secret.command,
      mutates: true,
      detail: `${secret.present ? "A local environment hint is present, but the deployed Worker still needs the Wrangler secret." : "No local environment hint was detected; Wrangler will prompt for the value interactively."} The command never prints or stores the secret value in source-controlled files.`
    })),
    ...optionalSecrets.map((secret) => ({
      label: `Optionally set Wrangler secret ${secret.name}`,
      command: secret.command,
      mutates: false,
      detail: `${secret.name} is optional when the presigned-upload bucket matches the FILES binding bucket. Run this manually only if the deployed secret should override the binding bucket.`
    })),
    {
      label: "Review R2 CORS recommendation",
      mutates: false,
      detail: cors.summary
    },
    {
      label: options.applyCors ? "Apply reviewed R2 CORS" : "Prepare R2 CORS application",
      command: cors.corsJson
        ? buildR2CorsSetCommand(cors.bucketName, "<generated-cors-json-file>", { force: options.applyCors })
        : undefined,
      mutates: Boolean(options.applyCors && cors.corsJson),
      detail: cors.corsJson
        ? options.applyCors
          ? `With --yes --apply-cors, Glyph writes the reviewed CORS JSON to a temporary file and runs Wrangler against bucket ${cors.bucketName}.`
          : `Review the generated CORS JSON, then re-run with --turnkey-secrets --yes --apply-cors to apply it with Wrangler or apply it manually in Cloudflare.`
        : "CORS cannot be applied until PUBLIC_BASE_URL or --public-base-url provides the final origin."
    },
    {
      label: "Worker-mediated upload fallback",
      mutates: false,
      detail: "Worker-mediated uploads remain the safe fallback until required Wrangler secrets and R2 CORS are confirmed ready."
    },
    {
      label: "Safety boundary",
      mutates: false,
      detail: "This workflow never stores secret values, echoes secret values, deploys Workers, applies remote migrations, creates DNS/custom domains, creates scheduled triggers, publishes releases, executes updates, or mutates unrelated Cloudflare resources."
    }
  ];

  return { items, cors, secretPlan };
}

export function buildCustomDomainSetupPlan(options, configText = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl;
  const validation = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: "PUBLIC_BASE_URL or --public-base-url is required for guided custom-domain setup." };
  const origin = validation.url?.origin ?? null;
  const host = validation.url?.hostname.toLowerCase() ?? null;
  const routePattern = host ? `${host}/*` : null;
  const routeHosts = config ? wranglerRouteHosts(config) : [];
  const workerName = typeof config?.name === "string" && config.name.length > 0 ? config.name : "glyph";
  const matchingRoutes = host ? routeHosts.filter((routeHostValue) => routeHostMatches(routeHostValue, host)) : [];
  const cors = buildR2CorsRecommendation(configText, {
    bucket: options.bucket,
    publicBaseUrl: origin
  });
  const configUpdate = buildCustomDomainWranglerConfig(configText, options);
  const troubleshooting = buildCustomDomainTroubleshootingLines({
    validationError: validation.error,
    origin,
    host,
    configuredPublicBaseUrl,
    suppliedPublicBaseUrl: options.publicBaseUrl,
    routeHosts,
    matchingRoutes,
    health: {
      status: "manual",
      ok: false,
      detail: origin ? `Health check should be verified at ${origin}/health after Cloudflare attachment.` : "Health check waits for the final origin.",
      recovery: origin ? "After DNS/custom-domain attachment and certificate readiness, run --verify-domain from a networked terminal." : null
    },
    cors
  });
  const items = [
    {
      label: "Validate custom-domain origin",
      mutates: false,
      detail: validation.error
        ? validation.error
        : `${origin} is an origin-only https URL suitable for generated links and passkey/WebAuthn registration.`
    },
    {
      label: "Inspect Wrangler route configuration",
      mutates: false,
      detail: routeHosts.length > 0
        ? `Configured route/custom-domain host(s): ${routeHosts.join(", ")}. ${matchingRoutes.length > 0 ? `At least one host matches ${host}.` : host ? `No configured route host currently matches ${host}.` : ""}`
        : "No Wrangler route/custom-domain host is configured yet; attach the Worker manually in Cloudflare or review the local route suggestion."
    },
    {
      label: "Review local Wrangler config suggestion",
      command: routePattern ? ["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--yes", "--public-base-url", origin] : undefined,
      mutates: Boolean(routePattern),
      detail: routePattern
        ? `With --yes, Glyph writes vars.PUBLIC_BASE_URL=${origin} and ensures a reviewed Wrangler route pattern ${routePattern} with custom_domain=true. It does not create DNS records, certificates, zones, or Cloudflare custom domains.`
        : "No local config suggestion can be generated until a final https origin is supplied."
    },
    {
      label: "Manual Cloudflare custom-domain steps",
      mutates: false,
      detail: host
        ? `In Cloudflare, confirm the zone for ${host}, create or verify DNS for ${host}, attach Worker ${workerName} to ${routePattern}, wait for certificate readiness, then verify ${origin}/health and ${origin}/admin.`
        : "Choose the final hostname, confirm its Cloudflare zone, create DNS, attach the Worker route/custom domain, and wait for certificate readiness."
    },
    {
      label: "Verify attached custom domain",
      command: origin ? ["pnpm", "run", "deploy:glyph", "--", "--verify-domain", "--public-base-url", origin] : undefined,
      mutates: false,
      detail: origin
        ? `After manual DNS/custom-domain attachment and certificate readiness, run pnpm run deploy:glyph -- --verify-domain --public-base-url ${origin} to check ${origin}/health, route hints, ${origin}/admin, passkey origin guidance, and R2 CORS alignment.`
        : "After the final origin is known and attached manually in Cloudflare, run --verify-domain to check health and configuration alignment."
    },
    {
      label: "Passkey origin guidance",
      mutates: false,
      detail: origin
        ? `Passkeys are origin-bound. Bootstrap or re-register the admin passkey from ${origin}/admin after the custom domain is live.`
        : "Passkeys are origin-bound; bootstrap or re-register admin passkeys only on the final deployed origin."
    },
    {
      label: "Align R2 CORS with custom-domain origin",
      mutates: false,
      detail: cors.summary
    },
    {
      label: "Troubleshoot custom-domain readiness",
      mutates: false,
      detail: troubleshooting.join(" ")
    },
    {
      label: "Worker-mediated upload fallback",
      mutates: false,
      detail: "Worker-mediated uploads remain available even before custom-domain R2 CORS is configured for direct/multipart browser uploads."
    },
    {
      label: "Safety boundary",
      mutates: false,
      detail: "This workflow never creates DNS records, zones, certificates, custom domains, scheduled triggers, GitHub releases, deploys Workers, applies remote migrations, stores secrets, executes updates, or mutates Cloudflare resources."
    }
  ];

  return {
    items,
    origin,
    host,
    routePattern,
    routeHosts,
    matchingRoutes,
    cors,
    troubleshooting,
    configUpdate,
    validationError: validation.error
  };
}

export function buildCustomDomainVerificationPlan(options, configText = null, healthResult = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl;
  const validation = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: "PUBLIC_BASE_URL or --public-base-url is required for custom-domain verification." };
  const origin = validation.url?.origin ?? null;
  const host = validation.url?.hostname.toLowerCase() ?? null;
  const routeHosts = config ? wranglerRouteHosts(config) : [];
  const matchingRoutes = host ? routeHosts.filter((routeHostValue) => routeHostMatches(routeHostValue, host)) : [];
  const health = healthResult ?? {
    status: origin ? "manual" : "blocked",
    ok: false,
    detail: origin
      ? `Health check not run yet. Expected endpoint: ${origin}/health.`
      : "Health check cannot run until a valid custom-domain origin is supplied.",
    recovery: origin
      ? "Run the verification command from a networked terminal after manually attaching the custom domain."
      : "Set vars.PUBLIC_BASE_URL or pass --public-base-url with an origin-only https URL."
  };
  const cors = buildR2CorsRecommendation(configText, {
    bucket: options.bucket,
    publicBaseUrl: origin
  });
  const troubleshooting = buildCustomDomainTroubleshootingLines({
    validationError: validation.error,
    origin,
    host,
    configuredPublicBaseUrl,
    suppliedPublicBaseUrl: options.publicBaseUrl,
    routeHosts,
    matchingRoutes,
    health,
    cors
  });
  const items = [
    {
      label: "Validate custom-domain origin",
      status: validation.error ? "blocked" : "ready",
      detail: validation.error
        ? validation.error
        : `${origin} is an origin-only https URL.`
    },
    {
      label: "Compare Wrangler route hints",
      status: matchingRoutes.length > 0 ? "ready" : routeHosts.length > 0 ? "needs attention" : "manual",
      detail: routeHosts.length > 0
        ? `Configured route/custom-domain host(s): ${routeHosts.join(", ")}. ${matchingRoutes.length > 0 ? `Matching host(s): ${matchingRoutes.join(", ")}.` : host ? `No configured route host currently matches ${host}.` : ""}`
        : "No local Wrangler route/custom-domain hints are configured; verify attachment in Cloudflare."
    },
    {
      label: "Check custom-domain health",
      status: health.status,
      detail: health.detail
    },
    {
      label: "Admin URL and passkey origin",
      status: origin ? "manual" : "blocked",
      detail: origin
        ? `Expected admin URL: ${origin}/admin. Passkeys are origin-bound; bootstrap or re-register the admin passkey from that exact origin.`
        : "Admin URL cannot be reported until the final origin is known. Passkeys are origin-bound."
    },
    {
      label: "R2 CORS alignment",
      status: cors.origin ? "manual" : "needs attention",
      detail: cors.summary
    },
    {
      label: "Recovery guidance",
      status: "manual",
      detail: troubleshooting.join(" ")
    },
    {
      label: "Safety boundary",
      status: "ready",
      detail: "This workflow is read-only. It never creates DNS records, zones, certificates, custom domains, scheduled triggers, GitHub releases, deploys Workers, applies remote migrations, stores secrets, executes updates, applies R2 CORS, or mutates Cloudflare resources."
    }
  ];

  return {
    items,
    origin,
    host,
    routeHosts,
    matchingRoutes,
    health,
    cors,
    troubleshooting,
    validationError: validation.error
  };
}

export function buildCustomDomainVerificationRecoveryLines(context) {
  return buildCustomDomainTroubleshootingLines(context);
}

function defaultDeployCheckResult(origin) {
  const blocked = {
    status: "blocked",
    ok: false,
    detail: "Check cannot run until a valid deployed Glyph origin is supplied.",
    recovery: "Pass --public-base-url with the workers.dev or custom-domain origin printed by Wrangler deploy, or set vars.PUBLIC_BASE_URL."
  };

  return {
    health: origin ? {
      status: "manual",
      ok: false,
      detail: `Health check not run yet. Expected endpoint: ${origin}/health.`,
      recovery: "Run --verify-deploy from a networked terminal after deploying intentionally."
    } : blocked,
    admin: origin ? {
      status: "manual",
      ok: false,
      detail: `Admin check not run yet. Expected endpoint: ${origin}/admin.`,
      recovery: "Open /admin on the deployed origin to confirm passkey bootstrap or login."
    } : blocked,
    upload: origin ? {
      status: "manual",
      ok: false,
      detail: `Upload page check not run yet. Expected endpoint: ${origin}/.`,
      recovery: "Open / on the deployed origin to confirm the public upload form without uploading a file."
    } : blocked
  };
}

function deployedOriginKind(host) {
  if (!host) {
    return "unknown";
  }
  return host.endsWith(".workers.dev") ? "workers.dev" : "custom-domain";
}

export function buildDeployVerificationRecoveryLines(context) {
  const lines = [];
  const routeHosts = Array.isArray(context.routeHosts) ? context.routeHosts : [];
  const matchingRoutes = Array.isArray(context.matchingRoutes) ? context.matchingRoutes : [];
  const configuredResult = context.configuredPublicBaseUrl ? validatePublicBaseUrl(context.configuredPublicBaseUrl) : { url: null, error: null };
  const configuredOrigin = configuredResult.url?.origin ?? null;
  const originKind = deployedOriginKind(context.host);

  if (context.validationError) {
    lines.push(`Invalid origin: ${context.validationError} Use an origin-only https URL such as https://files.example.com or the workers.dev origin printed by Wrangler deploy.`);
  }
  if (context.configuredPublicBaseUrl && configuredResult.error) {
    lines.push(`Configured PUBLIC_BASE_URL is invalid: ${configuredResult.error} Fix wrangler.jsonc before relying on generated links or passkeys.`);
  }
  if (context.origin && configuredOrigin && configuredOrigin !== context.origin) {
    lines.push(`PUBLIC_BASE_URL mismatch: wrangler.jsonc is ${configuredOrigin}, but this check is using ${context.origin}. Align generated links, reachable origin, passkey origin, and R2 CORS origin before relying on the deployment.`);
  }
  if (!context.origin) {
    lines.push("No deployed origin: pass --public-base-url with the workers.dev or custom-domain origin printed by Wrangler deploy, or configure vars.PUBLIC_BASE_URL.");
  }
  if (context.origin && originKind === "custom-domain" && routeHosts.length === 0) {
    lines.push("Custom-domain route hints are missing locally; verify the Worker route/custom-domain attachment manually in Cloudflare.");
  }
  if (context.origin && originKind === "custom-domain" && routeHosts.length > 0 && matchingRoutes.length === 0) {
    lines.push(`Route mismatch: align PUBLIC_BASE_URL host ${context.host} with Wrangler route/custom-domain host(s): ${routeHosts.join(", ")}.`);
  }
  if (context.origin && originKind === "custom-domain" && matchingRoutes.length > 0) {
    lines.push(`Route hints: at least one local Wrangler route/custom-domain hint matches ${context.host}.`);
  }
  if (context.origin && originKind === "workers.dev") {
    lines.push("workers.dev origin: Wrangler route hints are optional; use the exact workers.dev origin printed by deploy for links and passkeys unless a custom domain is configured.");
  }

  for (const [label, result] of [["Health", context.checks?.health], ["Admin", context.checks?.admin], ["Upload page", context.checks?.upload]]) {
    if (!result) {
      continue;
    }
    if (result.recovery) {
      lines.push(result.recovery);
    }
    if (result.status === "blocked") {
      lines.push(`${label} blocked: ${result.detail} Confirm the Worker is deployed, the route points at this Glyph Worker, and HTTPS is healthy.`);
    } else if (result.status === "needs attention") {
      lines.push(`${label} mismatch: ${result.detail} This may be the wrong route, non-Glyph content, stale deployment, or a custom-domain DNS/certificate issue.`);
    } else if (result.status === "ready") {
      lines.push(`${label} ready: ${result.detail}`);
    }
  }

  if (context.origin) {
    lines.push(`Expected URLs: public upload ${context.origin}/, health ${context.origin}/health, admin ${context.origin}/admin.`);
    lines.push(`Passkey origin: passkeys are origin-bound; bootstrap or sign in from exactly ${context.origin}/admin.`);
    lines.push(`R2 CORS: direct and multipart uploads require AllowedOrigins to include exactly ${context.origin} and ExposeHeaders to include ETag.`);
  }
  lines.push("Safety boundary: deploy verification is read-only and never uploads files, creates admin users, executes passkey flows, deploys Workers, applies migrations, sets secrets, applies R2 CORS, creates DNS/custom domains/scheduled triggers, publishes releases, executes updates, or mutates Cloudflare resources.");
  return [...new Set(lines)];
}

export function buildDeployVerificationPlan(options, configText = null, checkResult = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl;
  const validation = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: "A deployed origin is required for post-deploy verification." };
  const origin = validation.url?.origin ?? null;
  const host = validation.url?.hostname.toLowerCase() ?? null;
  const originKind = deployedOriginKind(host);
  const routeHosts = config ? wranglerRouteHosts(config) : [];
  const matchingRoutes = host ? routeHosts.filter((routeHostValue) => routeHostMatches(routeHostValue, host)) : [];
  const checks = checkResult ?? defaultDeployCheckResult(origin);
  const cors = buildR2CorsRecommendation(configText, {
    bucket: options.bucket,
    publicBaseUrl: origin
  });
  const recovery = buildDeployVerificationRecoveryLines({
    validationError: validation.error,
    origin,
    host,
    configuredPublicBaseUrl,
    suppliedPublicBaseUrl: options.publicBaseUrl,
    routeHosts,
    matchingRoutes,
    checks,
    cors
  });
  const routeDetail = originKind === "workers.dev"
    ? "workers.dev origin detected; route hints are optional, but the origin should match the URL printed by Wrangler deploy."
    : routeHosts.length > 0
      ? `Configured route/custom-domain host(s): ${routeHosts.join(", ")}. ${matchingRoutes.length > 0 ? `Matching host(s): ${matchingRoutes.join(", ")}.` : host ? `No configured route host currently matches ${host}.` : ""}`
      : "No local Wrangler route/custom-domain hints are configured; verify attachment in Cloudflare if this is a custom domain.";

  const items = [
    {
      label: "Validate deployed origin",
      status: validation.error ? "blocked" : "ready",
      detail: validation.error
        ? validation.error
        : `${origin} is an origin-only https ${originKind} origin.`
    },
    {
      label: "Compare deployment route hints",
      status: originKind === "workers.dev" ? "manual" : matchingRoutes.length > 0 ? "ready" : routeHosts.length > 0 ? "needs attention" : "manual",
      detail: routeDetail
    },
    {
      label: "Check health endpoint",
      status: checks.health.status,
      detail: checks.health.detail
    },
    {
      label: "Check admin surface",
      status: checks.admin.status,
      detail: checks.admin.detail
    },
    {
      label: "Check public upload surface",
      status: checks.upload.status,
      detail: checks.upload.detail
    },
    {
      label: "Expected URLs and passkey origin",
      status: origin ? "manual" : "blocked",
      detail: origin
        ? `Public upload: ${origin}/. Health: ${origin}/health. Admin: ${origin}/admin. Passkeys are origin-bound to this exact origin.`
        : "Expected URLs cannot be reported until a deployed origin is supplied."
    },
    {
      label: "R2 CORS alignment",
      status: cors.origin ? "manual" : "needs attention",
      detail: cors.summary
    },
    {
      label: "Recovery guidance",
      status: "manual",
      detail: recovery.join(" ")
    },
    {
      label: "Safety boundary",
      status: "ready",
      detail: "This workflow is read-only. It never uploads files, creates admin users, executes passkey flows, deploys Workers, applies remote migrations, sets secrets, applies R2 CORS, creates DNS records, creates custom domains, creates scheduled triggers, publishes releases, executes updates, or mutates Cloudflare resources."
    }
  ];

  return {
    items,
    origin,
    host,
    originKind,
    routeHosts,
    matchingRoutes,
    checks,
    cors,
    recovery,
    validationError: validation.error
  };
}

async function fetchDeployCheckText(origin, path, fetchImpl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}${path}`, {
      headers: { Accept: path === "/health" ? "application/json" : "text/html" },
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text, error: null };
  } catch (error) {
    return { response: null, text: "", error };
  } finally {
    clearTimeout(timeout);
  }
}

function deployFetchFailure(origin, path, error, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const message = error instanceof Error ? error.message : String(error);
  const aborted = error instanceof Error && error.name === "AbortError";
  const certificateLike = /cert|certificate|tls|ssl|handshake|525|526/iu.test(message);
  const dnsLike = /dns|enotfound|getaddrinfo|name not resolved|eai_again/iu.test(message);
  return {
    status: "blocked",
    ok: false,
    detail: aborted ? `${origin}${path} timed out after ${timeoutMs}ms.` : `${origin}${path} could not be reached: ${message}`,
    recovery: aborted
      ? "Confirm Worker deployment and route attachment, then retry from a network with access to the origin."
      : certificateLike
        ? "Confirm HTTPS certificate readiness before relying on the deployed origin."
        : dnsLike
          ? "Confirm DNS is propagated and the Worker route/custom-domain attachment is complete."
          : "Confirm the Worker is deployed, the route points at Glyph, and HTTPS is healthy."
  };
}

export async function checkDeployOrigin(origin, fetchImpl = globalThis.fetch, options = {}) {
  if (!origin) {
    return defaultDeployCheckResult(null);
  }

  if (typeof fetchImpl !== "function") {
    return {
      health: {
        status: "manual",
        ok: false,
        detail: `Fetch is not available in this runtime. Manually open ${origin}/health.`,
        recovery: "Run --verify-deploy from a Node.js runtime with fetch support or check the URL manually."
      },
      admin: {
        status: "manual",
        ok: false,
        detail: `Fetch is not available in this runtime. Manually open ${origin}/admin.`,
        recovery: "Run --verify-deploy from a Node.js runtime with fetch support or check the URL manually."
      },
      upload: {
        status: "manual",
        ok: false,
        detail: `Fetch is not available in this runtime. Manually open ${origin}/.`,
        recovery: "Run --verify-deploy from a Node.js runtime with fetch support or check the URL manually."
      }
    };
  }

  const [healthFetch, adminFetch, uploadFetch] = await Promise.all([
    fetchDeployCheckText(origin, "/health", fetchImpl, options),
    fetchDeployCheckText(origin, "/admin", fetchImpl, options),
    fetchDeployCheckText(origin, "/", fetchImpl, options)
  ]);

  const health = (() => {
    if (healthFetch.error) {
      return deployFetchFailure(origin, "/health", healthFetch.error, options);
    }
    if (!healthFetch.response?.ok) {
      return {
        status: "blocked",
        ok: false,
        detail: `${origin}/health returned HTTP ${healthFetch.response?.status ?? "unknown"}.`,
        recovery: "Confirm the Worker is deployed and the route points at this Glyph Worker."
      };
    }
    let payload = null;
    try {
      payload = JSON.parse(healthFetch.text);
    } catch {
      payload = null;
    }
    if (payload?.ok === true && payload?.app === "glyph") {
      return {
        status: "ready",
        ok: true,
        detail: `${origin}/health returned ok for Glyph.`,
        recovery: null
      };
    }
    return {
      status: "needs attention",
      ok: false,
      detail: `${origin}/health responded, but the body did not look like Glyph health JSON.`,
      recovery: "Confirm the route points at this Glyph Worker, not another Worker or origin."
    };
  })();

  const admin = (() => {
    if (adminFetch.error) {
      return deployFetchFailure(origin, "/admin", adminFetch.error, options);
    }
    if (!adminFetch.response?.ok) {
      return {
        status: "blocked",
        ok: false,
        detail: `${origin}/admin returned HTTP ${adminFetch.response?.status ?? "unknown"}.`,
        recovery: "Confirm the Worker is deployed, D1 is reachable, and the admin route is served by Glyph."
      };
    }
    if (/Glyph Admin (Setup|Login)|Create passkey|Use passkey|Register the first admin passkey|Sign in with the passkey/iu.test(adminFetch.text)) {
      return {
        status: "ready",
        ok: true,
        detail: `${origin}/admin showed the expected unauthenticated passkey bootstrap/login surface.`,
        recovery: null
      };
    }
    return {
      status: "needs attention",
      ok: false,
      detail: `${origin}/admin responded, but the body did not look like Glyph's unauthenticated admin surface.`,
      recovery: "Confirm this is the Glyph Worker and that the check is not receiving a cached, authenticated, or non-Glyph response."
    };
  })();

  const upload = (() => {
    if (uploadFetch.error) {
      return deployFetchFailure(origin, "/", uploadFetch.error, options);
    }
    if (!uploadFetch.response?.ok) {
      return {
        status: "blocked",
        ok: false,
        detail: `${origin}/ returned HTTP ${uploadFetch.response?.status ?? "unknown"}.`,
        recovery: "Confirm the Worker is deployed and the root route is served by Glyph."
      };
    }
    if (/Private file drop|Upload a file and get a short|<h1>Glyph<\/h1>|name="file"/iu.test(uploadFetch.text)) {
      return {
        status: "ready",
        ok: true,
        detail: `${origin}/ showed the public Glyph upload surface without uploading a file.`,
        recovery: null
      };
    }
    return {
      status: "needs attention",
      ok: false,
      detail: `${origin}/ responded, but the body did not look like Glyph's public upload page.`,
      recovery: "Confirm this is the Glyph Worker and the route is not pointing at another service."
    };
  })();

  return { health, admin, upload };
}

export function buildScheduledTriggerReadiness(configText = null) {
  if (!configText) {
    return {
      status: "missing",
      crons: [],
      errors: [],
      warnings: [],
      detail: "No wrangler.jsonc was found; add a reviewed triggers.crons entry before deploying scheduled features."
    };
  }

  const config = parseWranglerConfig(configText);
  if (!config) {
    return {
      status: "inconsistent",
      crons: [],
      errors: ["wrangler.jsonc could not be parsed."],
      warnings: [],
      detail: "wrangler.jsonc could not be parsed, so scheduled trigger readiness cannot be checked."
    };
  }

  const validation = validateWranglerCronTriggers(config);
  const crons = wranglerCronTriggers(config);
  if (validation.errors.length > 0 || validation.warnings.length > 0) {
    return {
      status: "inconsistent",
      crons,
      errors: validation.errors,
      warnings: validation.warnings,
      detail: [...validation.errors, ...validation.warnings].join(" ")
    };
  }

  if (crons.length === 0) {
    return {
      status: "missing",
      crons,
      errors: [],
      warnings: [],
      detail: "No Wrangler cron trigger is configured; scheduled features stay inert until an operator adds one and deploys intentionally."
    };
  }

  return {
    status: "configured",
    crons,
    errors: [],
    warnings: [],
    detail: `Configured cron trigger(s): ${crons.join(", ")}.`
  };
}

export function buildScheduledTriggerWranglerConfig(configText, options = {}) {
  const config = configText ? parseWranglerConfig(configText) : null;
  if (configText && !config) {
    return {
      configText: normalizeConfigText(configText),
      changed: false,
      cron: DEFAULT_SCHEDULE_CRON,
      crons: [],
      error: "wrangler.jsonc could not be parsed; fix it before writing scheduled-trigger config."
    };
  }

  const next = config && typeof config === "object" ? structuredClone(config) : {};
  const cron = DEFAULT_SCHEDULE_CRON;
  const configuredCrons = Array.isArray(config?.triggers?.crons)
    ? config.triggers.crons.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : [];
  if (configuredCrons.length > 0) {
    return {
      configText: normalizeConfigText(configText),
      changed: false,
      cron,
      crons: [...new Set(configuredCrons)],
      error: null
    };
  }

  next.$schema ??= "node_modules/wrangler/config-schema.json";
  next.name = typeof next.name === "string" && next.name.length > 0 ? next.name : "glyph";
  next.main = typeof next.main === "string" && next.main.length > 0 ? next.main : "src/index.ts";
  next.triggers = next.triggers && typeof next.triggers === "object" && !Array.isArray(next.triggers)
    ? next.triggers
    : {};

  const existingCrons = Array.isArray(next.triggers.crons)
    ? next.triggers.crons.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : [];
  const nextCrons = existingCrons.length > 0 ? [...new Set(existingCrons)] : [cron];
  next.triggers.crons = nextCrons;

  const output = `${JSON.stringify(next, null, 2)}\n`;
  return {
    configText: output,
    changed: normalizeConfigText(configText) !== normalizeConfigText(output),
    cron,
    crons: nextCrons,
    error: null
  };
}

export function buildScheduledTriggerSetupPlan(options, configText = null) {
  const readiness = buildScheduledTriggerReadiness(configText);
  const configUpdate = buildScheduledTriggerWranglerConfig(configText, options);
  const suggestedCrons = configUpdate.crons.length > 0 ? configUpdate.crons : [DEFAULT_SCHEDULE_CRON];
  const items = [
    {
      label: "Inspect Wrangler cron trigger configuration",
      mutates: false,
      detail: readiness.status === "configured"
        ? `${readiness.detail} Glyph uses the same deployed Scheduled Worker trigger for read-only update checks and storage/R2 maintenance.`
        : readiness.status === "inconsistent"
          ? `Scheduled trigger configuration needs attention: ${readiness.detail}`
          : readiness.detail
    },
    {
      label: "Understand read-only scheduled update checks",
      mutates: false,
      detail: "Read-only scheduled update checks only fetch public GitHub release metadata and persist the latest check result in D1. They also require a valid update source and the read-only scheduled update-check setting enabled in /admin."
    },
    {
      label: "Understand scheduled storage/R2 maintenance",
      mutates: false,
      detail: "Scheduled maintenance can enforce the configured storage cap, expire oldest active uploads, and retry R2 cleanup for expired/deleted uploads. It also requires scheduled maintenance enabled in /admin."
    },
    {
      label: "Review local Wrangler cron suggestion",
      command: configUpdate.error ? undefined : ["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule", "--yes"],
      mutates: Boolean(!configUpdate.error && configUpdate.changed),
      detail: configUpdate.error
        ? configUpdate.error
        : configUpdate.changed
          ? `With --yes, Glyph writes a reviewed local triggers.crons value (${suggestedCrons.join(", ")}). This configures the Worker schedule for the next intentional deploy, but it does not enable admin settings or create Cloudflare triggers directly.`
          : `wrangler.jsonc already has usable triggers.crons (${suggestedCrons.join(", ")}); no local config write is needed.`
    },
    {
      label: "Deploy and enable admin settings intentionally",
      mutates: false,
      detail: "After reviewing local config, deploy intentionally. Then enable read-only scheduled update checks and/or scheduled maintenance from the protected /admin settings; the cron trigger alone does not turn either feature on."
    },
    {
      label: "Safety boundary",
      mutates: false,
      detail: "This workflow only plans or writes local Wrangler cron config with explicit confirmation. It never creates Cloudflare scheduled triggers through the API, deploys Workers, applies remote migrations, stores secrets, executes updates, creates DNS records, creates custom domains, applies R2 CORS, publishes releases, or mutates Cloudflare resources."
    }
  ];

  return {
    items,
    readiness,
    configUpdate,
    suggestedCrons
  };
}

export function buildCustomDomainTroubleshootingLines(context) {
  const lines = [];
  const routeHosts = Array.isArray(context.routeHosts) ? context.routeHosts : [];
  const matchingRoutes = Array.isArray(context.matchingRoutes) ? context.matchingRoutes : [];
  const configuredResult = context.configuredPublicBaseUrl ? validatePublicBaseUrl(context.configuredPublicBaseUrl) : { url: null, error: null };
  const configuredOrigin = configuredResult.url?.origin ?? null;

  if (context.validationError) {
    lines.push(`Invalid origin: ${context.validationError} Use an origin-only https URL such as https://files.example.com.`);
  }
  if (context.configuredPublicBaseUrl && configuredResult.error) {
    lines.push(`Configured PUBLIC_BASE_URL is invalid: ${configuredResult.error} Fix wrangler.jsonc before relying on generated links or passkeys.`);
  }
  if (context.origin && configuredOrigin && configuredOrigin !== context.origin) {
    lines.push(`PUBLIC_BASE_URL mismatch: wrangler.jsonc is ${configuredOrigin}, but this check is using ${context.origin}. Align the configured value, reachable origin, passkey origin, and R2 CORS origin before switching traffic.`);
  }
  if (context.suppliedPublicBaseUrl && context.configuredPublicBaseUrl && context.origin && configuredOrigin && configuredOrigin === context.origin) {
    lines.push(`PUBLIC_BASE_URL alignment: supplied origin and wrangler.jsonc both resolve to ${context.origin}.`);
  }
  if (!context.origin) {
    lines.push("No origin: set vars.PUBLIC_BASE_URL in wrangler.jsonc or pass --public-base-url.");
  }
  if (context.origin && routeHosts.length === 0) {
    lines.push("Missing route hints: add a reviewed Wrangler route/custom-domain hint or verify the Worker attachment manually in Cloudflare.");
  }
  if (context.origin && routeHosts.length > 0 && matchingRoutes.length === 0) {
    lines.push(`Route mismatch: align PUBLIC_BASE_URL host ${context.host} with Wrangler route/custom-domain host(s): ${routeHosts.join(", ")}.`);
  }
  if (context.origin && routeHosts.length > 0 && matchingRoutes.length > 0) {
    lines.push(`Route hints: at least one local Wrangler route/custom-domain hint matches ${context.host}.`);
  }
  if (context.health?.recovery) {
    lines.push(context.health.recovery);
  }
  if (context.health?.status === "blocked") {
    lines.push(`Health blocked: ${context.health.detail} Check DNS propagation, Cloudflare custom-domain attachment, certificate readiness, Worker deployment, and whether the route points at this Glyph Worker.`);
  } else if (context.health?.status === "needs attention") {
    lines.push(`Health mismatch: ${context.health.detail} The domain may be routed to another Worker, an origin server, or a stale deployment.`);
  } else if (context.health?.status === "ready") {
    lines.push("Health ready: /health responded as Glyph from the configured custom-domain origin.");
  }
  if (context.origin) {
    lines.push(`Verify the reachable origin is exactly ${context.origin}; generated links and passkeys should use the same origin.`);
    lines.push(`Passkey origin: passkeys registered on workers.dev or another hostname will not authenticate on ${context.origin}; bootstrap or re-register from ${context.origin}/admin after the domain is live.`);
    lines.push(`R2 CORS: direct and multipart uploads require AllowedOrigins to include exactly ${context.origin} and ExposeHeaders to include ETag; update CORS after moving from workers.dev or another custom domain.`);
  }
  lines.push("Safety boundary: troubleshooting is read-only and never creates DNS records, zones, certificates, custom domains, routes, scheduled triggers, deployments, migrations, secrets, updates, R2 CORS rules, or Cloudflare resources.");
  return [...new Set(lines)];
}

export async function checkCustomDomainHealth(origin, fetchImpl = globalThis.fetch, options = {}) {
  if (!origin) {
    return {
      status: "blocked",
      ok: false,
      detail: "Health check cannot run until a valid custom-domain origin is supplied.",
      recovery: "Set vars.PUBLIC_BASE_URL or pass --public-base-url with an origin-only https URL."
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      status: "manual",
      ok: false,
      detail: `Fetch is not available in this runtime. Manually open ${origin}/health.`,
      recovery: "Run the verification command from a Node.js runtime with fetch support or check the URL manually."
    };
  }

  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const recovery = response.status === 525 || response.status === 526
        ? "Confirm the Cloudflare custom-domain certificate is issued and active, then retry after HTTPS is healthy."
        : response.status === 404
          ? "Confirm the custom-domain route points at the Glyph Worker and that /health is served by the deployed Worker."
          : "Confirm DNS/custom-domain attachment points to the Glyph Worker and that the Worker is deployed.";
      return {
        status: "blocked",
        ok: false,
        detail: `${origin}/health returned HTTP ${response.status}.`,
        recovery
      };
    }

    if (payload?.ok === true && payload?.app === "glyph") {
      return {
        status: "ready",
        ok: true,
        detail: `${origin}/health returned ok for Glyph.`,
        recovery: null
      };
    }

    return {
      status: "needs attention",
      ok: false,
      detail: `${origin}/health responded, but the body did not look like Glyph health JSON.`,
      recovery: "Confirm the custom domain is attached to this Glyph Worker, not another Worker or origin."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    const certificateLike = /cert|certificate|tls|ssl|handshake|525|526/iu.test(message);
    const dnsLike = /dns|enotfound|getaddrinfo|name not resolved|eai_again/iu.test(message);
    return {
      status: "blocked",
      ok: false,
      detail: aborted ? `${origin}/health timed out after ${timeoutMs}ms.` : `${origin}/health could not be reached: ${message}`,
      recovery: aborted
        ? "Confirm DNS/custom-domain attachment and Worker deployment, then retry from a network with access to the domain."
        : certificateLike
          ? "Confirm the HTTPS certificate is issued and active for the custom domain, then retry after TLS is healthy."
          : dnsLike
            ? "Confirm DNS is propagated and the custom domain is attached to the Worker in Cloudflare."
            : "Confirm DNS is propagated, HTTPS certificate is active, the custom domain is attached to the Worker, and the Worker is deployed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readinessItem(status, label, detail) {
  return { status, label, detail };
}

function safePackageVersion(packageJsonText) {
  if (!packageJsonText) {
    return { version: null, packageManager: null, error: "package.json is missing." };
  }

  try {
    const packageJson = JSON.parse(packageJsonText);
    return {
      version: typeof packageJson.version === "string" && packageJson.version.length > 0 ? packageJson.version : null,
      packageManager: typeof packageJson.packageManager === "string" ? packageJson.packageManager : null,
      error: null
    };
  } catch (error) {
    return {
      version: null,
      packageManager: null,
      error: `package.json could not be parsed: ${error instanceof Error ? error.message : "invalid JSON"}`
    };
  }
}

function missingReadinessFiles(projectFiles = {}) {
  return ["package.json", "pnpm-lock.yaml", "wrangler.jsonc", "migrations", "src/index.ts"]
    .filter((file) => projectFiles[file] !== true);
}

function readinessAuthStatus(env, isInteractive) {
  const hasToken = typeof env.CLOUDFLARE_API_TOKEN === "string" && env.CLOUDFLARE_API_TOKEN.trim().length > 0;
  if (hasToken) {
    return {
      status: "ready",
      detail: "CLOUDFLARE_API_TOKEN is set; verify it has Workers, D1, R2, and D1 migration permissions for the intended account."
    };
  }

  if (isInteractive) {
    return {
      status: "manual",
      detail: "No CLOUDFLARE_API_TOKEN detected; an interactive `pnpm wrangler login` session can be used locally."
    };
  }

  return {
    status: "blocked",
    detail: "CLOUDFLARE_API_TOKEN is required before non-interactive Wrangler checks can inspect Cloudflare resources."
  };
}

function readinessDiscoveryDetail(options, authStatus) {
  const commands = `pnpm wrangler d1 list --json and pnpm wrangler r2 bucket list for D1 ${options.database} and R2 bucket ${options.bucket}`;
  if (authStatus.status === "ready") {
    return {
      status: "ready",
      detail: `Cloudflare auth appears available, so discovery can run with ${commands}. This report does not run those commands.`
    };
  }

  if (authStatus.status === "manual") {
    return {
      status: "manual",
      detail: `Run ${commands} after confirming interactive Wrangler login. This report does not run those commands.`
    };
  }

  return {
    status: "blocked",
    detail: `Resource discovery is blocked until Cloudflare auth is available. Expected checks: ${commands}.`
  };
}

export function collectReadinessContext(rootDir, env = process.env) {
  const packageJsonPath = join(rootDir, "package.json");
  const wranglerPath = join(rootDir, "wrangler.jsonc");
  const projectFiles = {
    "package.json": existsSync(packageJsonPath),
    "pnpm-lock.yaml": existsSync(join(rootDir, "pnpm-lock.yaml")),
    "wrangler.jsonc": existsSync(wranglerPath),
    migrations: existsSync(join(rootDir, "migrations")),
    "src/index.ts": existsSync(join(rootDir, "src/index.ts"))
  };

  return {
    env,
    isInteractive: Boolean(process.stdout.isTTY),
    nodeVersion: process.version,
    projectFiles,
    packageJsonText: projectFiles["package.json"] ? readFileSync(packageJsonPath, "utf8") : null,
    configText: projectFiles["wrangler.jsonc"] ? readFileSync(wranglerPath, "utf8") : null
  };
}

export function buildReadinessReport(options, context = {}) {
  const env = context.env ?? process.env;
  const isInteractive = context.isInteractive ?? Boolean(process.stdout.isTTY);
  const nodeVersion = context.nodeVersion ?? process.version;
  const projectFiles = context.projectFiles ?? {};
  const packageInfo = safePackageVersion(context.packageJsonText ?? null);
  const configText = context.configText ?? null;
  const config = configText ? parseWranglerConfig(configText) : null;
  const auth = readinessAuthStatus(env, isInteractive);
  const directSecretPlan = buildDirectUploadSecretPlan(env);
  const missingDirectSecrets = directSecretPlan.filter((secret) => secret.required && !secret.present);
  const optionalBucketSecret = directSecretPlan.find((secret) => secret.name === "R2_BUCKET_NAME");
  const cors = buildR2CorsRecommendation(configText, { bucket: options.bucket, publicBaseUrl: options.publicBaseUrl });
  const sections = [];

  const localItems = [];
  const nodeMajor = nodeMajorVersion(nodeVersion);
  localItems.push(
    readinessItem(
      nodeMajor >= 22 ? "ready" : "blocked",
      "Node.js",
      nodeMajor >= 22 ? `${nodeVersion} satisfies the Node.js 22+ requirement.` : `${nodeVersion} is below the Node.js 22+ requirement.`
    )
  );

  if (packageInfo.error) {
    localItems.push(readinessItem("blocked", "Package version", packageInfo.error));
  } else {
    localItems.push(
      readinessItem(
        packageInfo.version ? "ready" : "needs attention",
        "Package version",
        packageInfo.version ? `Glyph ${packageInfo.version} from package.json.` : "package.json does not declare a version."
      )
    );
    localItems.push(
      readinessItem(
        packageInfo.packageManager?.startsWith("pnpm@") ? "ready" : "needs attention",
        "Package manager",
        packageInfo.packageManager?.startsWith("pnpm@")
          ? `${packageInfo.packageManager} is declared.`
          : "package.json should declare pnpm in packageManager."
      )
    );
  }

  const missingFiles = missingReadinessFiles(projectFiles);
  localItems.push(
    readinessItem(
      missingFiles.length === 0 ? "ready" : "blocked",
      "Project files",
      missingFiles.length === 0
        ? "package.json, pnpm-lock.yaml, wrangler.jsonc, migrations, and src/index.ts are present."
        : `Missing required path(s): ${missingFiles.join(", ")}.`
    )
  );
  localItems.push(readinessItem("manual", "pnpm availability", "Run `pnpm --version`; turnkey confirmed mode checks this before mutating anything."));
  localItems.push(readinessItem("manual", "Wrangler availability", "Run `pnpm wrangler --version`; turnkey confirmed mode checks this before Cloudflare operations."));
  localItems.push(readinessItem("manual", "Turnkey rehearsal", "Run `pnpm run deploy:glyph -- --turnkey-rehearse` for one end-to-end read-only operator report before mutating local config or Cloudflare resources."));
  localItems.push(readinessItem("manual", "Turnkey examples", "Run `pnpm run deploy:glyph -- --turnkey-examples` for read-only command transcripts and recovery examples."));
  localItems.push(readinessItem("manual", "Preflight checklist", "Run `pnpm run deploy:glyph -- --preflight` for a concise markdown deploy checklist with recommended next commands and operator-owned Cloudflare tasks."));
  sections.push({ title: "Local prerequisites", items: localItems });

  sections.push({
    title: "Cloudflare auth readiness",
    items: [
      readinessItem(auth.status, "Cloudflare auth", auth.detail),
      readinessItem(
        auth.status === "blocked" ? "blocked" : "manual",
        "Auth mode",
        auth.status === "ready"
          ? "Non-interactive checks can use CLOUDFLARE_API_TOKEN; interactive Wrangler login is still acceptable for local operator workflows."
          : "CI, Codex, and other non-interactive shells need CLOUDFLARE_API_TOKEN; local terminals may use `pnpm wrangler login`."
      )
    ]
  });

  const configItems = [];
  if (!configText) {
    configItems.push(readinessItem("blocked", "wrangler.jsonc", "missing; run turnkey setup or create the config before deployment."));
  } else if (!config) {
    configItems.push(readinessItem("blocked", "wrangler.jsonc", "could not be parsed."));
  } else {
    const validation = validateWranglerConfig(configText, { requireDeployReady: true });
    const dbBinding = Array.isArray(config.d1_databases)
      ? config.d1_databases.find((binding) => binding?.binding === "DB")
      : null;
    const r2Binding = Array.isArray(config.r2_buckets)
      ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
      : null;
    const publicBaseUrl = typeof config.vars?.PUBLIC_BASE_URL === "string" ? config.vars.PUBLIC_BASE_URL.trim() : "";
    const publicBaseResult = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: null };
    const publicBaseOrigin = publicBaseResult.url?.origin ?? null;
    const publicBaseHost = publicBaseResult.url?.hostname.toLowerCase() ?? null;
    const routeHosts = wranglerRouteHosts(config);
    const matchingRouteHosts = publicBaseHost ? routeHosts.filter((routeHostValue) => routeHostMatches(routeHostValue, publicBaseHost)) : [];
    const cronTriggers = wranglerCronTriggers(config);
    const scheduleReadiness = buildScheduledTriggerReadiness(configText);

    configItems.push(readinessItem("ready", "wrangler.jsonc", "present and parseable."));
    configItems.push(
      readinessItem(
        dbBinding ? "ready" : "blocked",
        "D1 binding",
        dbBinding ? `DB binds database ${String(dbBinding.database_name ?? "unknown")}.` : "Missing D1 binding named DB."
      )
    );
    if (dbBinding) {
      const databaseId = typeof dbBinding.database_id === "string" ? dbBinding.database_id.trim() : "";
      configItems.push(
        readinessItem(
          databaseId.length > 0 && databaseId !== PLACEHOLDER_D1_DATABASE_ID ? "ready" : "blocked",
          "D1 database_id",
          databaseId === PLACEHOLDER_D1_DATABASE_ID
            ? "placeholder detected; copy the real database_id from `pnpm wrangler d1 list --json` or rerun turnkey with --d1-database-id."
            : databaseId.length > 0
              ? "non-placeholder database_id is configured."
              : "database_id is missing."
        )
      );
    }
    configItems.push(
      readinessItem(
        r2Binding ? "ready" : "blocked",
        "R2 binding",
        r2Binding ? `FILES binds bucket ${String(r2Binding.bucket_name ?? "unknown")}.` : "Missing R2 binding named FILES."
      )
    );
    configItems.push(
      readinessItem(
        typeof config.vars?.APP_ENV === "string" && config.vars.APP_ENV.length > 0 ? "ready" : "blocked",
        "APP_ENV",
        typeof config.vars?.APP_ENV === "string" && config.vars.APP_ENV.length > 0
          ? `APP_ENV=${config.vars.APP_ENV}.`
          : "vars.APP_ENV is required."
      )
    );
    if (publicBaseUrl) {
      configItems.push(
        readinessItem(
          publicBaseResult.error ? "blocked" : "ready",
          "PUBLIC_BASE_URL",
          publicBaseResult.error ?? `${publicBaseUrl} is an origin-only https URL.`
        )
      );
    } else {
      configItems.push(readinessItem("optional", "PUBLIC_BASE_URL", "not set; generated links use the request origin until a custom domain is configured."));
    }
    configItems.push(
      readinessItem(
        routeHosts.length > 0 ? "ready" : "optional",
        "Custom-domain routes",
        routeHosts.length > 0 ? `Configured route host(s): ${routeHosts.join(", ")}.` : "none configured; attach custom domains manually when needed."
      )
    );
    configItems.push(
      readinessItem(
        "manual",
        "Guided custom-domain setup",
        "Run `pnpm run deploy:glyph -- --turnkey-domain --public-base-url https://files.example.com` to review PUBLIC_BASE_URL, Wrangler route hints, passkey origin guidance, R2 CORS alignment, and manual Cloudflare follow-up."
      )
    );
    configItems.push(
      readinessItem(
        "manual",
        "Custom-domain verification",
        "After manual DNS/custom-domain attachment, run `pnpm run deploy:glyph -- --verify-domain --public-base-url https://files.example.com` to validate the final origin, compare route hints, check /health, report /admin, and confirm R2 CORS alignment."
      )
    );
    configItems.push(
      readinessItem(
        "manual",
        "Custom-domain troubleshooting",
        buildCustomDomainTroubleshootingLines({
          validationError: publicBaseResult.error,
          origin: publicBaseOrigin,
          host: publicBaseHost,
          configuredPublicBaseUrl: publicBaseUrl || null,
          suppliedPublicBaseUrl: options.publicBaseUrl,
          routeHosts,
          matchingRoutes: matchingRouteHosts,
          health: {
            status: "manual",
            ok: false,
            detail: publicBaseUrl ? "Readiness mode does not fetch /health." : "No custom-domain origin is configured yet.",
            recovery: "Run --verify-domain after manual Cloudflare attachment to check DNS, HTTPS, Worker health, passkey origin, and R2 CORS alignment."
          },
          cors
        }).join(" ")
      )
    );
    configItems.push(
      readinessItem(
        cronTriggers.length > 0 ? "ready" : "optional",
        "Scheduled triggers",
        cronTriggers.length > 0 ? `Configured cron trigger(s): ${cronTriggers.join(", ")}.` : "none configured; scheduled update checks and maintenance stay inert until an operator adds a trigger."
      )
    );
    configItems.push(
      readinessItem(
        scheduleReadiness.status === "configured" ? "ready" : scheduleReadiness.status === "inconsistent" ? "needs attention" : "manual",
        "Guided scheduled-trigger setup",
        scheduleReadiness.status === "configured"
          ? `${scheduleReadiness.detail} Read-only update checks still need a valid update source plus the /admin opt-in; scheduled maintenance still needs its /admin opt-in.`
          : "Run `pnpm run deploy:glyph -- --turnkey-schedule` to review a local Wrangler cron suggestion for optional read-only update checks and storage/R2 maintenance. Use `--yes` only after reviewing local config changes."
      )
    );
    for (const error of validation.errors) {
      configItems.push(readinessItem("blocked", "Config validation", error));
    }
    for (const warning of validation.warnings) {
      configItems.push(readinessItem("needs attention", "Config warning", warning));
    }
  }
  sections.push({ title: "Wrangler config readiness", items: configItems });

  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const discovery = readinessDiscoveryDetail(options, auth);
  sections.push({
    title: "D1/R2 setup readiness",
    items: [
      readinessItem(dbBinding ? "ready" : "needs attention", "Configured D1 database", dbBinding ? String(dbBinding.database_name ?? options.database) : `expected ${options.database}.`),
      readinessItem(r2Binding ? "ready" : "needs attention", "Configured R2 bucket", r2Binding ? String(r2Binding.bucket_name ?? options.bucket) : `expected ${options.bucket}.`),
      readinessItem(discovery.status, "Resource discovery", discovery.detail)
    ]
  });

  sections.push({
    title: "Remote migration readiness",
    items: [
      readinessItem("manual", "Remote migrations", `Readiness mode does not list or apply remote migrations. Use --check to list migrations for D1 database ${options.database}.`),
      readinessItem("manual", "Apply gate", "Remote D1 migrations are applied only by the explicitly confirmed deploy path, such as `pnpm run deploy:glyph -- --yes` or `--turnkey --yes`.")
    ]
  });

  sections.push({
    title: "Direct/multipart upload readiness",
    items: [
      readinessItem(
        missingDirectSecrets.length === 0 ? "ready" : "needs attention",
        "Required R2 secrets",
        missingDirectSecrets.length === 0
          ? "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are present in this shell; verify matching Wrangler secrets exist for the deployed Worker."
          : `${missingDirectSecrets.map((secret) => secret.name).join(", ")} not detected; direct/multipart uploads stay blocked until matching Wrangler secrets are set.`
      ),
      readinessItem(
        optionalBucketSecret?.present ? "ready" : "optional",
        "Optional R2 bucket secret",
        optionalBucketSecret?.present ? "R2_BUCKET_NAME is present in this shell." : "R2_BUCKET_NAME can be omitted when the presigned-upload bucket matches the FILES binding bucket."
      ),
      readinessItem(
        "manual",
        "Secret commands",
        [...DIRECT_UPLOAD_SECRET_NAMES, ...OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES]
          .map((name) => buildSecretPutCommand(name).join(" "))
          .join("; ")
      ),
      readinessItem(
        cors.origin ? "manual" : "needs attention",
        "R2 CORS recommendation",
        cors.summary
      ),
      readinessItem(
        "manual",
        "Guided direct/multipart setup",
        "Run `pnpm run deploy:glyph -- --turnkey-secrets` to review interactive Wrangler secret prompts and optional reviewed R2 CORS application. Use `--yes` only when ready to set secrets; add `--apply-cors` only after reviewing the generated CORS rule."
      ),
      readinessItem("ready", "Worker-mediated fallback", "Worker-mediated uploads remain available until direct/multipart secrets and R2 CORS are ready.")
    ]
  });

  const postDeployReadinessItems = buildPostDeployVerificationLines(configText).map((line) => readinessItem("manual", "Health/admin check", line));
  postDeployReadinessItems.push(
    readinessItem(
      "manual",
      "Post-deploy verification",
      "After an intentional deploy, run `pnpm run deploy:glyph -- --verify-deploy --public-base-url https://files.example.com` or the workers.dev origin printed by Wrangler to check /health, /admin, /, passkey origin guidance, and R2 CORS alignment without uploading files or mutating anything."
    )
  );
  sections.push({
    title: "Post-deploy readiness",
    items: postDeployReadinessItems
  });

  sections.push({
    title: "Safety boundary",
    items: [
      readinessItem(
        "ready",
        "Read-only report",
        "No secret storage, no CORS application, no remote migrations, no deploy, no DNS/custom-domain/scheduled-trigger creation, no release publishing, no update execution, no local custom-domain config writes, and no Cloudflare mutations."
      )
    ]
  });

  return { title: "Glyph deploy readiness report", sections };
}

function commandText(parts) {
  return `\`${parts.join(" ")}\``;
}

function commandLine(parts) {
  return parts.join(" ");
}

function exampleItem(label, detail, commands = []) {
  return { label, detail, commands };
}

function rehearsalItem(label, detail, evidence = "", commands = []) {
  return { label, detail, evidence, commands };
}

export function buildCloudflareRehearsalChecklist(options, context = {}) {
  const configText = context.configText ?? null;
  const config = configText ? parseWranglerConfig(configText) : null;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl ?? "https://files.example.com";
  const publicBaseResult = validatePublicBaseUrl(publicBaseUrl);
  const origin = publicBaseResult.url?.origin ?? "https://files.example.com";
  const database = options.database || DEFAULT_DATABASE_NAME;
  const bucket = options.bucket || DEFAULT_BUCKET_NAME;

  return {
    title: "Glyph Real Cloudflare Deploy Rehearsal Checklist",
    intro: "Read-only operator checklist: no commands are executed, no files are written, no secret values should be recorded, and no Cloudflare resources are changed by this helper.",
    sections: [
      {
        title: "Prepare The Account And Checkout",
        items: [
          rehearsalItem(
            "Confirm local tools and clean checkout",
            "Install from the committed lockfile and run the read-only reports before any confirmed Cloudflare action.",
            "Record Node, pnpm, Wrangler versions, current git commit, and whether the working tree was clean. Do not record token values.",
            [
              ["pnpm", "install", "--frozen-lockfile"],
              ["git", "status", "--short"],
              ["pnpm", "run", "deploy:glyph", "--", "--readiness"],
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey-rehearse"],
              ["pnpm", "run", "deploy:glyph", "--", "--preflight"]
            ]
          ),
          rehearsalItem(
            "Confirm Cloudflare authentication",
            "Use Wrangler login in an interactive terminal or CLOUDFLARE_API_TOKEN in non-interactive environments.",
            "Record auth method and target account identity only. Never paste API tokens, secret values, or private account details into committed notes.",
            [["pnpm", "wrangler", "whoami"]]
          )
        ]
      },
      {
        title: "Provision Or Reuse Core Resources",
        items: [
          rehearsalItem(
            "Create or reuse D1 and R2",
            `Confirm D1 database ${database} and R2 bucket ${bucket} exist in the intended account before deploy.`,
            "Record whether each resource was created or reused, the D1 database ID, and bucket name. Do not record Cloudflare account IDs if they are private.",
            [
              ["pnpm", "wrangler", "d1", "list", "--json"],
              ["pnpm", "wrangler", "r2", "bucket", "list"],
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes", "--reuse-resources", "--d1-database-id", "<real-d1-database-id>"]
            ]
          ),
          rehearsalItem(
            "Capture and verify Wrangler config",
            "Replace the placeholder D1 database_id with the real ID and verify DB, FILES, APP_ENV, and optional PUBLIC_BASE_URL.",
            "Record config fields by name and whether placeholders remain. Do not commit temporary real-resource changes unless the deployment repo intentionally owns them.",
            [
              ["pnpm", "run", "deploy:glyph", "--", "--readiness"],
              ["pnpm", "run", "deploy:glyph", "--", "--check"]
            ]
          )
        ]
      },
      {
        title: "Migrate, Deploy, And Verify",
        items: [
          rehearsalItem(
            "Remote migrations review and apply gate",
            "List/check remote migrations first, then apply only through the confirmed deploy path after reviewing migration files.",
            "Record migration command outcome and any migration IDs or filenames. Do not paste private database contents.",
            [
              ["pnpm", "run", "deploy:glyph", "--", "--check"],
              ["pnpm", "run", "deploy:glyph", "--", "--yes"]
            ]
          ),
          rehearsalItem(
            "Capture deployed origin",
            "Record the workers.dev or custom-domain origin printed by Wrangler after Worker deploy, then verify public, health, and admin surfaces.",
            "Record public URL, /health result, /admin bootstrap/login surface, and / upload surface status.",
            [
              ["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", origin]
            ]
          ),
          rehearsalItem(
            "Bootstrap first admin passkey",
            "Open /admin on the final origin and bootstrap the first passkey if no admin exists.",
            "Record that bootstrap completed and which origin was used. Do not record passkey data, credential IDs, challenges, cookies, or session tokens.",
            []
          ),
          rehearsalItem(
            "Run optional upload/download smoke test",
            "Upload a harmless test file, open the short link, then delete it from admin and verify the short link becomes unavailable.",
            "Record filename placeholder, file size, upload mode, short-link status, delete status, and not-found status. Do not upload sensitive files or record private R2 object keys.",
            []
          )
        ]
      },
      {
        title: "Optional Production Follow-Up",
        items: [
          rehearsalItem(
            "Prepare direct or multipart uploads",
            "Set R2 S3-compatible Wrangler secrets and apply reviewed R2 CORS only if direct or multipart upload modes will be used.",
            "Record which secret names were set and whether CORS includes the final origin and ETag exposure. Never record secret values.",
            [
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--public-base-url", origin],
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--yes", "--public-base-url", origin],
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--yes", "--apply-cors", "--public-base-url", origin]
            ]
          ),
          rehearsalItem(
            "Attach and verify custom domain",
            "If using a custom domain, attach DNS/custom-domain routing manually in Cloudflare and verify the final origin.",
            "Record route host, certificate readiness, /health result, passkey origin decision, and R2 CORS origin alignment.",
            [
              ["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--public-base-url", origin],
              ["pnpm", "run", "deploy:glyph", "--", "--verify-domain", "--public-base-url", origin]
            ]
          ),
          rehearsalItem(
            "Activate optional scheduled work",
            "Configure Wrangler cron triggers through reviewed local config/deploy, then enable read-only update checks or scheduled maintenance in /admin as needed.",
            "Record cron expression, deployed trigger status, and which /admin opt-ins were enabled.",
            [["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule"]]
          )
        ]
      },
      {
        title: "Rollback And Recovery Notes",
        items: [
          rehearsalItem(
            "Record rollback path",
            "Keep the previous release tag, current deployed version, migration state, and Wrangler deploy output handy before changing production.",
            "Record release tag, commit SHA, migration status, and known manual reversal steps. Do not record secrets, cookies, passkey material, or private file details.",
            [
              ["git", "rev-parse", "--short", "HEAD"],
              ["pnpm", "run", "release:check"],
              ["pnpm", "run", "update:glyph"]
            ]
          ),
          rehearsalItem(
            "Keep evidence local and sanitized",
            "Use local deployment notes or issue summaries that avoid real API tokens, secret values, passkey data, cookies, private domains when sensitive, R2 object keys, and private file contents.",
            "Record only sanitized status, command outcomes, URLs that are safe to share, and follow-up items.",
            []
          )
        ]
      }
    ]
  };
}

export function formatCloudflareRehearsalChecklist(checklist) {
  const lines = [
    `# ${markdownInline(checklist.title)}`,
    "",
    markdownInline(checklist.intro),
    ""
  ];

  for (const section of checklist.sections) {
    lines.push(`## ${markdownInline(section.title)}`);
    lines.push("");
    for (const item of section.items) {
      lines.push(`- [ ] ${markdownInline(item.label)}: ${markdownInline(item.detail)}`);
      if (item.evidence) {
        lines.push(`  Evidence to capture: ${markdownInline(item.evidence)}`);
      }
      for (const command of item.commands) {
        lines.push(`  Command: ${markdownCommand(command)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildTurnkeyExamplesReport(options, context = {}) {
  const configText = context.configText ?? null;
  const config = configText ? parseWranglerConfig(configText) : null;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl ?? "https://files.example.com";
  const publicBaseResult = validatePublicBaseUrl(publicBaseUrl);
  const origin = publicBaseResult.url?.origin ?? "https://files.example.com";
  const database = options.database || DEFAULT_DATABASE_NAME;
  const bucket = options.bucket || DEFAULT_BUCKET_NAME;

  const sections = [
    {
      title: "Fresh checkout to first deploy",
      items: [
        exampleItem(
          "Install and inspect",
          "Start with locked dependencies and read-only reports so the operator sees prerequisites, auth, D1/R2 plans, config state, migration gates, and follow-up before mutation.",
          [
            ["pnpm", "install", "--frozen-lockfile"],
            ["pnpm", "run", "deploy:glyph", "--", "--readiness"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-rehearse"],
            ["pnpm", "run", "deploy:glyph", "--", "--preflight"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey"]
          ]
        ),
        exampleItem(
          "Confirm deploy path",
          "Only the explicit confirmed command can create/reuse D1/R2 resources, write reviewed local bindings, apply remote migrations, and deploy. Review the plan first.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes"],
            ["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", origin]
          ]
        )
      ]
    },
    {
      title: "Non-interactive Cloudflare auth recovery",
      items: [
        exampleItem(
          "Missing token",
          "CI, Codex, and other non-interactive shells need CLOUDFLARE_API_TOKEN before Wrangler can inspect D1/R2 or deploy. Use a scoped token value outside source control; the helper does not print or store it.",
          [
            ["export", "CLOUDFLARE_API_TOKEN=<scoped-cloudflare-api-token>"],
            ["pnpm", "run", "deploy:glyph", "--", "--readiness"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey"]
          ]
        )
      ]
    },
    {
      title: "Existing D1/R2 resource reuse and placeholder recovery",
      items: [
        exampleItem(
          "Discover existing resources",
          "When D1/R2 already exist, confirm they belong to the intended account and reuse them instead of recreating resources.",
          [
            ["pnpm", "wrangler", "d1", "list", "--json"],
            ["pnpm", "wrangler", "r2", "bucket", "list"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes", "--reuse-resources", "--d1-database-id", "<real-d1-database-id>"]
          ]
        ),
        exampleItem(
          "Recover placeholder D1 ID",
          "If wrangler.jsonc still has the placeholder database_id, copy the real ID from Wrangler output and rerun the confirmed turnkey command with --reuse-resources.",
          [
            ["pnpm", "wrangler", "d1", "list", "--json"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes", "--reuse-resources", "--d1-database-id", "<real-d1-database-id>"]
          ]
        )
      ]
    },
    {
      title: "Remote migration and deploy gates",
      items: [
        exampleItem(
          "Review before applying",
          "Remote D1 migrations stay behind an explicit gate. Check first, then apply only through the confirmed deploy path after reviewing migration files.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--check"],
            ["pnpm", "run", "deploy:glyph", "--", "--yes"]
          ]
        )
      ]
    },
    {
      title: "Worker-mediated fallback and direct/multipart follow-up",
      items: [
        exampleItem(
          "Keep the fallback",
          "Worker-mediated uploads keep working before direct/multipart secrets and R2 CORS are ready.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets"]
          ]
        ),
        exampleItem(
          "Set secrets and CORS intentionally",
          "Wrangler prompts for secret values interactively and Glyph never echoes them. Apply R2 CORS only after reviewing the generated origin-specific rule.",
          [
            ["pnpm", "wrangler", "secret", "put", "R2_ACCOUNT_ID"],
            ["pnpm", "wrangler", "secret", "put", "R2_ACCESS_KEY_ID"],
            ["pnpm", "wrangler", "secret", "put", "R2_SECRET_ACCESS_KEY"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--yes"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--yes", "--apply-cors", "--public-base-url", origin]
          ]
        )
      ]
    },
    {
      title: "Custom domain and passkey origin follow-up",
      items: [
        exampleItem(
          "Plan local domain hints",
          "The helper validates the origin and can write reviewed local PUBLIC_BASE_URL and route hints with --yes, but DNS, certificates, and custom-domain attachment remain operator-owned.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--public-base-url", origin],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--yes", "--public-base-url", origin],
            ["pnpm", "run", "deploy:glyph", "--", "--verify-domain", "--public-base-url", origin]
          ]
        ),
        exampleItem(
          "Passkey origin",
          `Bootstrap or re-register admin passkeys from ${origin}/admin after switching to the final origin; passkeys are origin-bound.`,
          [
            ["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", origin]
          ]
        )
      ]
    },
    {
      title: "Optional scheduled-trigger setup",
      items: [
        exampleItem(
          "Plan scheduled work",
          "A Wrangler cron trigger only schedules the Worker. Read-only update checks and storage/R2 maintenance still require protected /admin opt-ins after deploy.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule"],
            ["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule", "--yes"]
          ]
        )
      ]
    },
    {
      title: "Post-deploy verification",
      items: [
        exampleItem(
          "Verify deployed origin",
          "Use the workers.dev URL printed by Wrangler deploy or the final custom-domain origin. The check fetches /health, /admin, and / without uploading files or executing passkey flows.",
          [
            ["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", origin]
          ]
        )
      ]
    },
    {
      title: "Safety boundary",
      items: [
        exampleItem(
          "Examples are read-only",
          "This report never deploys Workers, applies remote migrations, sets secrets, applies R2 CORS, creates DNS records, zones, certificates, custom domains, scheduled triggers, publishes releases, executes updates, uploads files, creates admin users, executes passkey flows, or mutates Cloudflare resources.",
          []
        )
      ]
    }
  ];

  return {
    title: "Glyph turnkey deploy examples",
    database,
    bucket,
    origin,
    originValidationError: publicBaseResult.error,
    sections
  };
}

export function formatTurnkeyExamplesReport(report) {
  const lines = [
    report.title,
    "Read-only examples: these are command transcripts and recovery paths only; no commands are executed.",
    `Example D1 database: ${report.database}`,
    `Example R2 bucket: ${report.bucket}`,
    report.originValidationError ? `Example origin warning: ${report.originValidationError}` : `Example public origin: ${report.origin}`,
    ""
  ];

  for (const section of report.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      lines.push(`- ${item.label}: ${item.detail}`);
      for (const command of item.commands) {
        lines.push(`  $ ${commandLine(command)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildTurnkeyRehearsalReport(options, context = {}) {
  const env = context.env ?? process.env;
  const isInteractive = context.isInteractive ?? Boolean(process.stdout.isTTY);
  const nodeVersion = context.nodeVersion ?? process.version;
  const projectFiles = context.projectFiles ?? {};
  const packageInfo = safePackageVersion(context.packageJsonText ?? null);
  const configText = context.configText ?? null;
  const config = configText ? parseWranglerConfig(configText) : null;
  const auth = readinessAuthStatus(env, isInteractive);
  const missingFiles = missingReadinessFiles(projectFiles);
  const nodeMajor = nodeMajorVersion(nodeVersion);
  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const databaseId = typeof dbBinding?.database_id === "string" ? dbBinding.database_id.trim() : "";
  const hasRealDatabaseId = databaseId.length > 0 && databaseId !== PLACEHOLDER_D1_DATABASE_ID;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl;
  const publicBaseValidation = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: null };
  const publicOrigin = publicBaseValidation.url?.origin ?? null;
  const routeHosts = config ? wranglerRouteHosts(config) : [];
  const scheduleReadiness = buildScheduledTriggerReadiness(configText);
  const directSecretPlan = buildDirectUploadSecretPlan(env);
  const missingDirectSecrets = directSecretPlan.filter((secret) => secret.required && !secret.present);
  const cors = buildR2CorsRecommendation(configText, { bucket: options.bucket, publicBaseUrl: options.publicBaseUrl });
  const discovery = readinessDiscoveryDetail(options, auth);
  const configValidation = configText && config ? validateWranglerConfig(configText, { requireDeployReady: true }) : null;
  const sections = [];

  sections.push({
    title: "Local prerequisites and version",
    items: [
      readinessItem(
        nodeMajor >= 22 ? "ready" : "blocked",
        "Node.js",
        nodeMajor >= 22 ? `${nodeVersion} satisfies the Node.js 22+ requirement.` : `${nodeVersion} is below the Node.js 22+ requirement.`
      ),
      readinessItem(
        packageInfo.error ? "blocked" : packageInfo.version ? "ready" : "needs attention",
        "Package version",
        packageInfo.error ?? (packageInfo.version ? `Glyph ${packageInfo.version} from package.json.` : "package.json does not declare a version.")
      ),
      readinessItem(
        missingFiles.length === 0 ? "ready" : "blocked",
        "Project files",
        missingFiles.length === 0
          ? "package.json, pnpm-lock.yaml, wrangler.jsonc, migrations, and src/index.ts are present."
          : `Missing required path(s): ${missingFiles.join(", ")}. Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey"])} to review setup, or create the missing files before deploy.`
      ),
      readinessItem("manual", "Local tool checks", `Confirmed deploy still runs ${commandText(["pnpm", "--version"])}, ${commandText(["pnpm", "wrangler", "--version"])}, typecheck, tests, release check, migration checks, and Wrangler dry-run before deploy.`)
    ]
  });

  sections.push({
    title: "Cloudflare auth and resource plan",
    items: [
      readinessItem(auth.status, "Cloudflare auth", auth.detail),
      readinessItem(discovery.status, "D1/R2 discovery", `${discovery.detail} Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey"])} for a non-mutating plan, then ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes"])} only when ready.`),
      readinessItem(
        dbBinding ? "ready" : "manual",
        "D1 database plan",
        dbBinding
          ? `wrangler.jsonc references D1 database ${String(dbBinding.database_name ?? options.database)}.`
          : `No DB binding is configured yet; confirmed turnkey can create or reuse D1 database ${options.database} after explicit confirmation.`
      ),
      readinessItem(
        r2Binding ? "ready" : "manual",
        "R2 bucket plan",
        r2Binding
          ? `wrangler.jsonc references R2 bucket ${String(r2Binding.bucket_name ?? options.bucket)}.`
          : `No FILES binding is configured yet; confirmed turnkey can create or reuse R2 bucket ${options.bucket} after explicit confirmation.`
      )
    ]
  });

  const configItems = [];
  if (!configText) {
    configItems.push(readinessItem("blocked", "Wrangler config", `wrangler.jsonc is missing. Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey"])} to review generation, then rerun with --yes only after reviewing.`));
  } else if (!config) {
    configItems.push(readinessItem("blocked", "Wrangler config", "wrangler.jsonc could not be parsed; fix JSONC before confirmed deploy."));
  } else {
    configItems.push(readinessItem("ready", "Wrangler config", "wrangler.jsonc is present and parseable."));
    configItems.push(
      readinessItem(
        hasRealDatabaseId ? "ready" : "blocked",
        "D1 database_id",
        hasRealDatabaseId
          ? "non-placeholder database_id is configured."
          : databaseId === PLACEHOLDER_D1_DATABASE_ID
            ? `placeholder database_id is configured. Recovery: run ${commandText(["pnpm", "wrangler", "d1", "list", "--json"])}, then rerun ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes", "--reuse-resources", "--d1-database-id", "<real-id>"])}.`
            : "database_id is missing; confirmed deploy needs a real D1 database_id before Worker deploy."
      )
    );
    for (const error of configValidation?.errors ?? []) {
      configItems.push(readinessItem("blocked", "Config validation", error));
    }
    for (const warning of configValidation?.warnings ?? []) {
      configItems.push(readinessItem("needs attention", "Config warning", warning));
    }
  }
  configItems.push(readinessItem("manual", "Remote D1 migration gate", `Rehearsal does not list or apply remote migrations. Confirmed deploy lists/applies intentionally; dry-run first with ${commandText(["pnpm", "run", "deploy:glyph", "--", "--check"])}.`));
  configItems.push(readinessItem("manual", "Worker deploy gate", `Rehearsal does not run Wrangler deploy. Confirmed deploy requires ${commandText(["pnpm", "run", "deploy:glyph", "--", "--yes"])} or reviewed ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes"])}.`));
  sections.push({ title: "Wrangler config, migrations, and deploy gates", items: configItems });

  sections.push({
    title: "Direct/multipart upload follow-up",
    items: [
      readinessItem(
        missingDirectSecrets.length === 0 ? "ready" : "needs attention",
        "Required R2 secrets",
        missingDirectSecrets.length === 0
          ? "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are present in this shell; verify matching Wrangler secrets exist for the deployed Worker."
          : `${missingDirectSecrets.map((secret) => secret.name).join(", ")} not detected. Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets"])} to plan secret setup without printing values.`
      ),
      readinessItem(cors.origin ? "manual" : "needs attention", "R2 CORS follow-up", `${cors.summary} Worker-mediated uploads remain the fallback until secrets and CORS are confirmed.`),
      readinessItem("manual", "Confirmed secret/CORS path", `${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets", "--yes"])} runs interactive secret prompts only; add --apply-cors only after reviewing the generated CORS rule.`)
    ]
  });

  const domainCommandOrigin = publicOrigin ?? "https://files.example.com";
  sections.push({
    title: "Custom-domain and scheduled-trigger follow-up",
    items: [
      readinessItem(
        publicBaseValidation.error ? "blocked" : publicOrigin ? "manual" : "optional",
        "Custom-domain setup",
        publicBaseValidation.error
          ? `${publicBaseValidation.error} Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--public-base-url", "https://files.example.com"])} after choosing an origin-only HTTPS URL.`
          : publicOrigin
            ? `PUBLIC_BASE_URL target is ${publicOrigin}. Route hint(s): ${routeHosts.length > 0 ? routeHosts.join(", ") : "none configured"}. Next command after manual Cloudflare attachment: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--verify-domain", "--public-base-url", publicOrigin])}.`
            : `No custom-domain origin is configured. Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--public-base-url", domainCommandOrigin])} when ready.`
      ),
      readinessItem("manual", "Passkey origin", publicOrigin ? `Passkeys are origin-bound; bootstrap or re-register admin passkeys from ${publicOrigin}/admin after switching origins.` : "Passkeys are origin-bound; use the final workers.dev or custom-domain /admin origin for bootstrap/sign-in."),
      readinessItem(
        scheduleReadiness.status === "configured" ? "ready" : scheduleReadiness.status === "inconsistent" ? "needs attention" : "manual",
        "Scheduled-trigger setup",
        `${scheduleReadiness.detail} Next command: ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule"])} to review local cron config. Protected /admin opt-ins are still required after deploy.`
      )
    ]
  });

  const postDeployItems = buildPostDeployVerificationLines(configText).map((line) => readinessItem("manual", "Public/admin URLs", line));
  postDeployItems.push(readinessItem("manual", "Verify deployed origin", `${commandText(["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", publicOrigin ?? "https://files.example.com"])} checks /health, /admin, and / without uploading files, creating admin users, executing passkey flows, or mutating Cloudflare resources.`));
  postDeployItems.push(readinessItem("manual", "Turnkey examples", `${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-examples"])} prints copyable command sequences for common deploy and recovery paths without running them.`));
  postDeployItems.push(readinessItem("manual", "Recommended command order", `${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey-rehearse"])} -> ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey"])} -> reviewed ${commandText(["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes"])}; use secrets/domain/schedule helpers for optional follow-up.`));
  postDeployItems.push(readinessItem("manual", "Partial setup recovery", "If setup stops midway, rerun this rehearsal and the non-mutating turnkey plan, then use --reuse-resources plus the real --d1-database-id when a D1 database already exists."));
  sections.push({ title: "Expected URLs and recovery", items: postDeployItems });

  sections.push({
    title: "Safety boundary",
    items: [
      readinessItem(
        "ready",
        "Read-only rehearsal",
        "No D1/R2 creation, no local config writes, no secret prompts or storage, no R2 CORS application, no remote migrations, no Worker deploy, no DNS/custom-domain/scheduled-trigger creation, no release publishing, no update execution, and no Cloudflare mutations."
      )
    ]
  });

  return { title: "Glyph turnkey deploy rehearsal report", sections };
}

export function formatTurnkeyRehearsalReport(report) {
  const lines = [
    report.title,
    "Read-only rehearsal: this report summarizes the full operator path without changing local files or Cloudflare resources.",
    ""
  ];

  for (const section of report.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      lines.push(`- [${item.status}] ${item.label}: ${item.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function markdownInline(value) {
  return String(value ?? "")
    .replaceAll("`", "'")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function markdownCommand(parts) {
  return `\`${parts.map((part) => markdownInline(part)).join(" ")}\``;
}

function preflightItem(status, label, detail, nextCommand = null) {
  return { status, label, detail, nextCommand };
}

export function buildPreflightChecklist(options, context = {}) {
  const env = context.env ?? process.env;
  const isInteractive = context.isInteractive ?? Boolean(process.stdout.isTTY);
  const nodeVersion = context.nodeVersion ?? process.version;
  const projectFiles = context.projectFiles ?? {};
  const packageInfo = safePackageVersion(context.packageJsonText ?? null);
  const configText = context.configText ?? null;
  const config = configText ? parseWranglerConfig(configText) : null;
  const auth = readinessAuthStatus(env, isInteractive);
  const missingFiles = missingReadinessFiles(projectFiles);
  const nodeMajor = nodeMajorVersion(nodeVersion);
  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const databaseId = typeof dbBinding?.database_id === "string" ? dbBinding.database_id.trim() : "";
  const hasRealDatabaseId = databaseId.length > 0 && databaseId !== PLACEHOLDER_D1_DATABASE_ID;
  const configuredPublicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim()
    : null;
  const publicBaseUrl = options.publicBaseUrl ?? configuredPublicBaseUrl;
  const publicBaseValidation = publicBaseUrl ? validatePublicBaseUrl(publicBaseUrl) : { url: null, error: null };
  const publicOrigin = publicBaseValidation.url?.origin ?? null;
  const routeHosts = config ? wranglerRouteHosts(config) : [];
  const publicHost = publicBaseValidation.url?.hostname.toLowerCase() ?? null;
  const matchingRouteHosts = publicHost ? routeHosts.filter((routeHostValue) => routeHostMatches(routeHostValue, publicHost)) : [];
  const directSecretPlan = buildDirectUploadSecretPlan(env);
  const missingDirectSecrets = directSecretPlan.filter((secret) => secret.required && !secret.present);
  const optionalBucketSecret = directSecretPlan.find((secret) => secret.name === "R2_BUCKET_NAME");
  const cors = buildR2CorsRecommendation(configText, { bucket: options.bucket, publicBaseUrl: options.publicBaseUrl });
  const scheduleReadiness = buildScheduledTriggerReadiness(configText);
  const discovery = readinessDiscoveryDetail(options, auth);
  const configValidation = configText && config ? validateWranglerConfig(configText, { requireDeployReady: true }) : null;
  const items = [];

  const localProblems = [];
  if (nodeMajor < 22) {
    localProblems.push(`${nodeVersion} is below Node.js 22+`);
  }
  if (packageInfo.error) {
    localProblems.push(packageInfo.error);
  }
  if (!packageInfo.packageManager?.startsWith("pnpm@")) {
    localProblems.push("packageManager should declare pnpm");
  }
  if (missingFiles.length > 0) {
    localProblems.push(`missing ${missingFiles.join(", ")}`);
  }
  items.push(preflightItem(
    localProblems.length === 0 ? "ready" : "blocked",
    "Local prerequisites and package version",
    localProblems.length === 0
      ? `Node ${markdownInline(nodeVersion)}, Glyph ${markdownInline(packageInfo.version ?? "unknown")}, pnpm lockfile, Wrangler config, migrations, and source files are present.`
      : localProblems.join("; "),
    localProblems.length === 0
      ? ["pnpm", "install", "--frozen-lockfile"]
      : ["pnpm", "run", "deploy:glyph", "--", "--readiness"]
  ));

  items.push(preflightItem(
    auth.status,
    "Cloudflare auth/token readiness",
    auth.status === "ready"
      ? "CLOUDFLARE_API_TOKEN is set in this shell; verify the token has Workers, D1, R2, and migration permissions. The token value is not printed."
      : auth.detail,
    auth.status === "ready"
      ? ["pnpm", "wrangler", "whoami"]
      : auth.status === "manual"
        ? ["pnpm", "wrangler", "login"]
        : ["export", "CLOUDFLARE_API_TOKEN=<scoped-cloudflare-api-token>"]
  ));

  items.push(preflightItem(
    dbBinding && r2Binding ? discovery.status : "needs attention",
    "D1/R2 binding and resource readiness",
    dbBinding && r2Binding
      ? `DB binding references ${markdownInline(dbBinding.database_name ?? options.database)} and FILES binding references ${markdownInline(r2Binding.bucket_name ?? options.bucket)}. ${discovery.detail}`
      : `Expected DB binding for D1 ${markdownInline(options.database)} and FILES binding for R2 bucket ${markdownInline(options.bucket)}.`,
    dbBinding && r2Binding
      ? ["pnpm", "run", "deploy:glyph", "--", "--turnkey"]
      : ["pnpm", "run", "deploy:glyph", "--", "--turnkey"]
  ));

  items.push(preflightItem(
    hasRealDatabaseId ? "ready" : "blocked",
    "Placeholder D1 database ID state",
    hasRealDatabaseId
      ? "A non-placeholder D1 database_id is configured."
      : databaseId === PLACEHOLDER_D1_DATABASE_ID
        ? "wrangler.jsonc still contains the placeholder D1 database_id."
        : "D1 database_id is missing or wrangler.jsonc could not be parsed.",
    hasRealDatabaseId
      ? null
      : ["pnpm", "run", "deploy:glyph", "--", "--turnkey", "--yes", "--reuse-resources", "--d1-database-id", "<real-d1-database-id>"]
  ));

  items.push(preflightItem(
    "manual",
    "Remote migration review/apply gate",
    `Remote D1 migrations are reviewed with --check and applied only by an explicit confirmed deploy path for database ${markdownInline(options.database)}.`,
    ["pnpm", "run", "deploy:glyph", "--", "--check"]
  ));

  items.push(preflightItem(
    "ready",
    "Worker-mediated upload fallback status",
    "Worker-mediated uploads remain available before direct/multipart secrets and R2 CORS are ready.",
    null
  ));

  items.push(preflightItem(
    missingDirectSecrets.length === 0 && cors.origin ? "manual" : "needs attention",
    "Direct/multipart secret and R2 CORS readiness",
    missingDirectSecrets.length === 0
      ? `Required direct/multipart secret names are present in this shell; verify matching Wrangler secrets exist. ${optionalBucketSecret?.present ? "R2_BUCKET_NAME is present." : "R2_BUCKET_NAME is optional when it matches the FILES bucket."} ${cors.summary}`
      : `${missingDirectSecrets.map((secret) => secret.name).join(", ")} not detected in this shell. ${cors.summary}`,
    ["pnpm", "run", "deploy:glyph", "--", "--turnkey-secrets"]
  ));

  items.push(preflightItem(
    publicBaseValidation.error ? "blocked" : publicOrigin ? (matchingRouteHosts.length > 0 ? "ready" : "manual") : "optional",
    "Custom-domain/public origin alignment",
    publicBaseValidation.error
      ? publicBaseValidation.error
      : publicOrigin
        ? `Final origin ${markdownInline(publicOrigin)}; route hint(s): ${routeHosts.length > 0 ? routeHosts.map(markdownInline).join(", ") : "none configured"}. ${matchingRouteHosts.length > 0 ? "At least one route hint matches." : "Cloudflare DNS/custom-domain attachment remains operator-owned."}`
        : "No PUBLIC_BASE_URL or --public-base-url supplied; use the workers.dev URL printed by deploy or configure a final custom-domain origin.",
    ["pnpm", "run", "deploy:glyph", "--", "--turnkey-domain", "--public-base-url", publicOrigin ?? "https://files.example.com"]
  ));

  items.push(preflightItem(
    scheduleReadiness.status === "configured" ? "manual" : scheduleReadiness.status === "inconsistent" ? "needs attention" : "optional",
    "Scheduled-trigger/admin opt-in readiness",
    `${scheduleReadiness.detail} Read-only update checks and storage/R2 maintenance also require protected /admin opt-ins after deploy.`,
    ["pnpm", "run", "deploy:glyph", "--", "--turnkey-schedule"]
  ));

  const postDeployDetail = [
    ...buildPostDeployVerificationLines(configText),
    "Expected checks: /health, /admin, and / without uploading files, creating admins, or executing passkey flows."
  ].join(" ");
  items.push(preflightItem(
    "manual",
    "Post-deploy /health, /admin, and / verification",
    postDeployDetail,
    ["pnpm", "run", "deploy:glyph", "--", "--verify-deploy", "--public-base-url", publicOrigin ?? "https://files.example.com"]
  ));

  if (configValidation?.errors.length) {
    items.push(preflightItem(
      "blocked",
      "Wrangler config validation",
      configValidation.errors.join(" "),
      ["pnpm", "run", "deploy:glyph", "--", "--readiness"]
    ));
  }

  if (configValidation?.warnings.length) {
    items.push(preflightItem(
      "needs attention",
      "Wrangler config warnings",
      configValidation.warnings.join(" "),
      ["pnpm", "run", "deploy:glyph", "--", "--readiness"]
    ));
  }

  const safetyDetail = options.outdirExplicit
    ? "This checklist is read-only with respect to deployment and Cloudflare state. It writes only the requested local markdown artifact. It does not deploy Workers, apply remote migrations, set secrets, apply R2 CORS, create DNS records, create zones, issue certificates, create or attach custom domains, create scheduled triggers through the Cloudflare API, publish releases, execute updates, upload files, create admin users, execute passkey flows, or mutate Cloudflare resources. Operators still own Cloudflare auth, secrets, reviewed R2 CORS, DNS/custom-domain attachment, scheduled trigger activation, remote migration application, deployment, and final origin verification."
    : "This checklist is read-only and writes no files. It does not deploy Workers, apply remote migrations, set secrets, apply R2 CORS, create DNS records, create zones, issue certificates, create or attach custom domains, create scheduled triggers through the Cloudflare API, publish releases, execute updates, upload files, create admin users, execute passkey flows, or mutate Cloudflare resources. Operators still own Cloudflare auth, secrets, reviewed R2 CORS, DNS/custom-domain attachment, scheduled trigger activation, remote migration application, deployment, and final origin verification.";

  items.push(preflightItem(
    "manual",
    "Safety boundary and operator-owned Cloudflare tasks",
    safetyDetail,
    null
  ));

  return {
    title: "Glyph Deploy Preflight Checklist",
    intro: options.outdirExplicit
      ? "Read-only markdown checklist saved as a local deployment-note artifact. No commands are executed, no secret values are printed, and no Cloudflare resources are changed."
      : "Read-only markdown checklist: copy into deployment notes if useful. No commands are executed and no files are written.",
    items
  };
}

export function formatPreflightChecklist(checklist) {
  const lines = [
    `# ${markdownInline(checklist.title)}`,
    "",
    markdownInline(checklist.intro),
    ""
  ];

  for (const item of checklist.items) {
    lines.push(`- [ ] [${markdownInline(item.status)}] ${markdownInline(item.label)}: ${markdownInline(item.detail)}`);
    if (item.nextCommand) {
      lines.push(`  Next: ${markdownCommand(item.nextCommand)}`);
    }
  }

  return lines.join("\n").trimEnd();
}

export function preflightChecklistFilePath(options, rootDir = process.cwd()) {
  const outputDir = resolve(rootDir, options.outdir);
  return join(outputDir, PREFLIGHT_CHECKLIST_FILENAME);
}

export function writePreflightChecklistFile(markdown, options, rootDir = process.cwd()) {
  const outputDir = resolve(rootDir, options.outdir);
  const filePath = join(outputDir, PREFLIGHT_CHECKLIST_FILENAME);

  if (existsSync(filePath) && !options.yes) {
    throw new Error(`${filePath} already exists. Re-run with --preflight --outdir ${options.outdir} --yes only after reviewing the existing checklist.`);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(filePath, `${markdown}\n`);
  return filePath;
}

export function formatReadinessReport(report) {
  const lines = [
    report.title,
    "Read-only mode: this report inspects local configuration and environment hints only.",
    ""
  ];

  for (const section of report.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      lines.push(`- [${item.status}] ${item.label}: ${item.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildTurnkeyWranglerConfig(configText, options) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const next = config && typeof config === "object" ? structuredClone(config) : {};
  const existingDbBinding = Array.isArray(next.d1_databases)
    ? next.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const existingR2Binding = Array.isArray(next.r2_buckets)
    ? next.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const databaseId = options.databaseId
    ?? existingDbBinding?.database_id
    ?? PLACEHOLDER_D1_DATABASE_ID;

  next.$schema ??= "node_modules/wrangler/config-schema.json";
  next.name = typeof next.name === "string" && next.name.length > 0 ? next.name : "glyph";
  next.main = "src/index.ts";
  next.compatibility_date ??= "2026-05-08";
  next.observability ??= { enabled: true };
  next.vars = next.vars && typeof next.vars === "object" && !Array.isArray(next.vars) ? next.vars : {};
  next.vars.APP_ENV = typeof next.vars.APP_ENV === "string" && next.vars.APP_ENV.length > 0
    ? next.vars.APP_ENV
    : "production";

  if (options.publicBaseUrl !== null && options.publicBaseUrl !== undefined) {
    next.vars.PUBLIC_BASE_URL = options.publicBaseUrl;
  }

  const dbBinding = {
    ...(existingDbBinding && typeof existingDbBinding === "object" ? existingDbBinding : {}),
    binding: "DB",
    database_name: options.database,
    database_id: databaseId,
    migrations_dir: "migrations"
  };
  const r2Binding = {
    ...(existingR2Binding && typeof existingR2Binding === "object" ? existingR2Binding : {}),
    binding: "FILES",
    bucket_name: options.bucket
  };

  next.d1_databases = upsertBinding(next.d1_databases, "DB", dbBinding);
  next.r2_buckets = upsertBinding(next.r2_buckets, "FILES", r2Binding);

  const output = `${JSON.stringify(next, null, 2)}\n`;
  return {
    configText: output,
    changed: normalizeConfigText(configText) !== normalizeConfigText(output),
    hasPlaceholderDatabaseId: databaseId === PLACEHOLDER_D1_DATABASE_ID
  };
}

export function buildCustomDomainWranglerConfig(configText, options) {
  const originValue = options.publicBaseUrl
    ?? (typeof parseWranglerConfig(configText ?? "")?.vars?.PUBLIC_BASE_URL === "string"
      ? parseWranglerConfig(configText ?? "")?.vars?.PUBLIC_BASE_URL
      : null);
  const validation = originValue ? validatePublicBaseUrl(originValue) : { url: null, error: "PUBLIC_BASE_URL or --public-base-url is required." };
  if (validation.error || !validation.url) {
    return {
      configText: normalizeConfigText(configText),
      changed: false,
      error: validation.error ?? "PUBLIC_BASE_URL or --public-base-url is required.",
      routePattern: null
    };
  }

  const config = configText ? parseWranglerConfig(configText) : null;
  const next = config && typeof config === "object" ? structuredClone(config) : {};
  const routePattern = `${validation.url.hostname.toLowerCase()}/*`;

  next.$schema ??= "node_modules/wrangler/config-schema.json";
  next.name = typeof next.name === "string" && next.name.length > 0 ? next.name : "glyph";
  next.main = typeof next.main === "string" && next.main.length > 0 ? next.main : "src/index.ts";
  next.vars = next.vars && typeof next.vars === "object" && !Array.isArray(next.vars) ? next.vars : {};
  next.vars.PUBLIC_BASE_URL = validation.url.origin;

  const routeHosts = wranglerRouteHosts(next);
  if (!routeHosts.some((routeHostValue) => routeHostMatches(routeHostValue, validation.url.hostname.toLowerCase()))) {
    const routeEntry = { pattern: routePattern, custom_domain: true };
    if (Array.isArray(next.routes)) {
      next.routes = [...next.routes, routeEntry];
    } else if (next.routes === undefined) {
      next.routes = [routeEntry];
    } else {
      next.routes = [next.routes, routeEntry];
    }
  }

  const output = `${JSON.stringify(next, null, 2)}\n`;
  return {
    configText: output,
    changed: normalizeConfigText(configText) !== normalizeConfigText(output),
    error: null,
    routePattern
  };
}

export function buildTurnkeyFollowUpLines(configText, options) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const publicBaseUrl = options.publicBaseUrl
    ?? (typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
      ? config.vars.PUBLIC_BASE_URL.trim()
      : null);
  const lines = [];

  if (publicBaseUrl) {
    lines.push(`Public URL: ${publicBaseUrl}`);
    lines.push(`Admin URL: ${publicBaseUrl.replace(/\/$/u, "")}/admin`);
  } else {
    lines.push("Public URL: use the workers.dev/custom-domain URL printed by Wrangler deploy.");
    lines.push("Admin URL: open /admin on the deployed origin to bootstrap or sign in.");
  }

  lines.push("Manual follow-up: configure direct/multipart R2 S3 credentials only if those upload modes will be used.");
  lines.push("Manual follow-up: configure R2 CORS for the deployed origin before enabling direct or multipart browser uploads.");
  lines.push("Manual follow-up: configure DNS/custom-domain attachment and passkey registration on the final origin if using a custom domain.");
  lines.push("Manual follow-up: configure Cloudflare Scheduled Worker triggers yourself before enabling read-only update checks or scheduled maintenance in /admin.");
  lines.push("Manual follow-up: for direct or multipart upload modes, verify R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, optional R2_BUCKET_NAME, and bucket CORS before switching modes in /admin.");
  lines.push(...buildDirectUploadReadinessLines(configText));
  lines.push(...buildPostDeployVerificationLines(configText));
  lines.push("Recovery: if setup stops midway, re-run --turnkey without --yes to review current readiness, then re-run --turnkey --yes with --reuse-resources and the real --d1-database-id when needed.");

  return lines;
}

export function buildPostDeployVerificationLines(configText) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const publicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" && config.vars.PUBLIC_BASE_URL.trim().length > 0
    ? config.vars.PUBLIC_BASE_URL.trim().replace(/\/$/u, "")
    : null;

  if (!publicBaseUrl) {
    return [
      "Post-deploy check: after Wrangler prints the deployed workers.dev or custom-domain URL, open /health and /admin on that origin."
    ];
  }

  return [
    `Post-deploy check: verify ${publicBaseUrl}/health returns ok, then open ${publicBaseUrl}/admin to bootstrap or sign in.`
  ];
}

export function usage() {
  return `Glyph deploy helper

Usage:
  pnpm run deploy:glyph -- --setup
  pnpm run deploy:glyph -- --setup --yes
  pnpm run deploy:glyph -- --turnkey
  pnpm run deploy:glyph -- --turnkey-rehearse
  pnpm run deploy:glyph -- --turnkey-examples
  pnpm run deploy:glyph -- --cloudflare-rehearsal
  pnpm run deploy:glyph -- --preflight
  pnpm run deploy:glyph -- --preflight --outdir ./deploy-notes
  pnpm run deploy:glyph -- --turnkey --yes
  pnpm run deploy:glyph -- --turnkey-secrets
  pnpm run deploy:glyph -- --turnkey-secrets --yes
  pnpm run deploy:glyph -- --turnkey-domain --public-base-url https://files.example.com
  pnpm run deploy:glyph -- --turnkey-domain --yes --public-base-url https://files.example.com
  pnpm run deploy:glyph -- --turnkey-schedule
  pnpm run deploy:glyph -- --turnkey-schedule --yes
  pnpm run deploy:glyph -- --verify-deploy --public-base-url https://files.example.com
  pnpm run deploy:glyph -- --verify-domain --public-base-url https://files.example.com
  pnpm run deploy:glyph -- --readiness
  pnpm run deploy:glyph -- --check
  pnpm run deploy:glyph -- --yes

Options:
  --setup             Print a guided Cloudflare setup plan. With --yes, create D1/R2 resources.
  --turnkey           Print or run a fresh-checkout setup, verification, migration, and deploy flow.
  --turnkey-rehearse  Print one end-to-end read-only operator rehearsal report.
  --turnkey-examples  Print read-only deploy transcripts and recovery command examples.
  --cloudflare-rehearsal
                      Print a read-only real Cloudflare account rehearsal checklist and evidence guide.
  --preflight         Print a read-only markdown deploy preflight checklist.
  --turnkey-secrets   Print or run guided direct/multipart Wrangler secret setup and reviewed R2 CORS planning.
  --turnkey-domain    Print or write guided custom-domain PUBLIC_BASE_URL and Wrangler route hints.
  --turnkey-schedule  Print or write guided local Wrangler cron trigger config for optional scheduled work.
  --verify-deploy     Read-only post-deploy check of /health, /admin, /, passkeys, and CORS guidance.
  --verify-domain     Read-only check of a manually attached custom domain, /health, /admin, and CORS guidance.
  --apply-cors        With --turnkey-secrets --yes, apply reviewed R2 CORS using Wrangler.
  --readiness         Print a consolidated read-only deployment readiness report.
  --check             Run validation, remote migration check, tests, and dry-run without deploying. Default.
  --yes, -y           Apply remote D1 migrations and deploy after checks pass.
  --skip-install      Skip pnpm install --frozen-lockfile.
  --reuse-resources   In --turnkey mode, skip D1/R2 create commands and use existing resources.
  --database <name>   D1 database name or binding to migrate. Default: glyph.
  --d1-database-id <id>
                      Real D1 database_id to write into wrangler.jsonc during --turnkey --yes.
  --bucket <name>     R2 bucket name to create during --setup --yes. Default: glyph-files.
  --public-base-url <url>
                      Optional deployed https:// origin to write into wrangler.jsonc during --turnkey --yes.
  --outdir <path>     Wrangler dry-run output directory, or preflight checklist output directory with --preflight.
                      Default dry-run path: /tmp/glyph-deploy-dry-run.
  --help, -h          Show this help.

Custom domain readiness:
  Set vars.PUBLIC_BASE_URL in wrangler.jsonc to the deployed https:// origin when using a custom domain.
  The helper validates the URL shape and warns when it does not line up with Wrangler routes.
  --turnkey-domain is a non-mutating plan by default. --turnkey-domain --yes may write reviewed
  local wrangler.jsonc PUBLIC_BASE_URL and route hints only; it never creates DNS records, zones,
  certificates, custom domains, deploys, applies migrations, stores secrets, or mutates Cloudflare resources.
  --verify-domain is always read-only. It checks the final origin shape, local route hints, /health when
  network access is available, expected /admin URL, passkey origin guidance, and R2 CORS alignment.

Post-deploy verification:
  --verify-deploy is always read-only. It checks the deployed workers.dev or custom-domain origin,
  /health, /admin, and / when network access is available, then reports expected URLs, passkey origin
  guidance, R2 CORS alignment, and recovery steps. It never uploads files, creates admin users,
  executes passkey flows, deploys, applies migrations, sets secrets, applies CORS, or mutates resources.

Scheduled update check readiness:
  Optional read-only scheduled update checks require a Wrangler cron trigger plus a valid update source
  and read-only scheduled checks enabled in /admin. The helper reports cron trigger configuration but
  never creates triggers, deploys updates, applies migrations, checks out code, stores GitHub tokens,
  executes local update helpers, or mutates Cloudflare resources for scheduled checks.
  --turnkey-schedule is a non-mutating plan by default. --turnkey-schedule --yes may write reviewed
  local wrangler.jsonc triggers.crons only; it does not deploy, apply migrations, enable admin settings,
  create Cloudflare scheduled triggers through the API, or mutate Cloudflare resources.

Scheduled maintenance readiness:
  Optional scheduled maintenance uses the same Wrangler cron trigger mechanism plus scheduled
  maintenance enabled in /admin. It can enforce storage policy in Glyph metadata and R2, but the helper
  never creates triggers or mutates Cloudflare resources.

Turnkey safety:
  --turnkey-rehearse is always non-mutating. It summarizes prerequisites, auth, resource discovery or
  creation plans, Wrangler config, remote migration and deploy gates, direct/multipart secret and CORS
  follow-up, custom-domain verification, scheduled-trigger setup, expected URLs, and recovery steps.
  --turnkey-examples is always non-mutating. It prints command transcripts for fresh checkout, auth
  recovery, existing resource reuse, placeholder D1 IDs, migration gates, direct/multipart follow-up,
  custom domains, scheduled triggers, and post-deploy verification without running those commands.
  --cloudflare-rehearsal is always non-mutating. It prints a structured checklist for a real
  Cloudflare account pass, including auth, D1/R2 creation or reuse, D1 ID capture, migrations, deploy,
  URL checks, admin bootstrap, optional upload smoke testing, direct/multipart setup, custom domains,
  scheduled triggers, rollback notes, and sanitized evidence capture. It never writes files, stores
  secrets, creates resources, deploys, applies migrations, uploads files, creates admins, executes
  passkey flows, or mutates Cloudflare resources.
  --preflight is always non-mutating. It prints a concise markdown checklist covering local
  prerequisites, auth, D1/R2 readiness, placeholder D1 IDs, migration gates, Worker-mediated fallback,
  direct/multipart secrets and CORS, custom domains, scheduled triggers, post-deploy verification,
  next commands, and operator-owned Cloudflare tasks without writing files or running checks.
  --preflight --outdir ./deploy-notes writes the same checklist to ./deploy-notes/glyph-preflight-checklist.md.
  It creates only the requested local directory/file. It refuses to overwrite an existing checklist unless
  --yes is also supplied after reviewing the file.
  --turnkey is a non-mutating plan by default. --turnkey --yes may create D1/R2 resources, write local
  wrangler.jsonc binding values, apply remote D1 migrations, and deploy. It never stores secrets, creates
  DNS records, zones, certificates, custom domains, scheduled triggers, or GitHub releases.

Direct/multipart setup safety:
  --turnkey-secrets is a non-mutating plan by default. --turnkey-secrets --yes runs Wrangler secret put
  interactively for required direct/multipart secrets. --apply-cors must be added explicitly to apply the
  reviewed R2 CORS recommendation. This flow never prints or stores secret values, deploys Workers,
  applies remote migrations, creates DNS/custom domains, scheduled triggers, or unrelated Cloudflare
  resources.

Readiness safety:
  --readiness is always non-mutating. It does not store secrets, apply R2 CORS, apply remote migrations,
  deploy, create DNS/custom-domain/scheduled-trigger resources, publish releases, execute updates, or
  mutate Cloudflare resources.
`;
}

export function validateProject(rootDir, options) {
  const errors = [];
  const warnings = [];
  const requiredFiles = options.turnkey
    || options.turnkeyDomain
    || options.turnkeySchedule
    || options.turnkeyRehearse
    || options.preflight
    || options.verifyDomain
    || options.verifyDeploy
    ? ["package.json", "pnpm-lock.yaml", "migrations", "src/index.ts"]
    : ["package.json", "pnpm-lock.yaml", "wrangler.jsonc", "migrations", "src/index.ts"];

  for (const file of requiredFiles) {
    if (!existsSync(join(rootDir, file))) {
      errors.push(`Missing required project path: ${file}`);
    }
  }

  const nodeMajor = nodeMajorVersion(process.version);
  if (nodeMajor < 22) {
    errors.push(`Node.js 22 or newer is required. Current version is ${process.version}.`);
  }

  const packageJsonPath = join(rootDir, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof packageJson.packageManager !== "string" || !packageJson.packageManager.startsWith("pnpm@")) {
      errors.push("package.json must declare pnpm in packageManager.");
    }
  }

  const wranglerPath = join(rootDir, "wrangler.jsonc");
  if (existsSync(wranglerPath) && !options.turnkeySchedule) {
    const result = validateWranglerConfig(readFileSync(wranglerPath, "utf8"), {
      requireDeployReady: options.yes
    });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings };
}

export function nodeMajorVersion(version) {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : 0;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function stripJsonComments(value) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      } else if (char === "\n" || char === "\r") {
        output += char;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }

  return output;
}

function parseWranglerConfig(configText) {
  try {
    return JSON.parse(stripJsonComments(configText));
  } catch {
    return null;
  }
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function validatePublicBaseUrl(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { url: null, error: "vars.PUBLIC_BASE_URL cannot be empty when configured." };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { url: null, error: "vars.PUBLIC_BASE_URL must be a valid absolute URL." };
  }

  if (url.protocol !== "https:") {
    return { url: null, error: "vars.PUBLIC_BASE_URL must use https:// for deployed custom-domain passkeys and short links." };
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return { url: null, error: "vars.PUBLIC_BASE_URL must be an origin only, such as https://files.example.com." };
  }

  return { url, error: null };
}

function wranglerRouteHosts(config) {
  const patterns = [];

  if (typeof config.route === "string") {
    patterns.push(config.route);
  } else if (config.route && typeof config.route.pattern === "string") {
    patterns.push(config.route.pattern);
  }

  if (Array.isArray(config.routes)) {
    for (const route of config.routes) {
      if (typeof route === "string") {
        patterns.push(route);
      } else if (route && typeof route.pattern === "string") {
        patterns.push(route.pattern);
      }
    }
  }

  if (Array.isArray(config.custom_domains)) {
    for (const domain of config.custom_domains) {
      if (typeof domain === "string") {
        patterns.push(domain);
      } else if (domain && typeof domain.pattern === "string") {
        patterns.push(domain.pattern);
      }
    }
  }

  return [...new Set(patterns.map(routeHost).filter(Boolean))];
}

function validateWranglerCronTriggers(config) {
  if (config.triggers === undefined) {
    return { errors: [], warnings: [] };
  }

  if (!config.triggers || typeof config.triggers !== "object" || Array.isArray(config.triggers)) {
    return { errors: ["wrangler.jsonc triggers must be an object when configured."], warnings: [] };
  }

  if (config.triggers.crons === undefined) {
    return { errors: [], warnings: ["wrangler.jsonc triggers is configured without crons; scheduled update checks will not run."] };
  }

  if (!Array.isArray(config.triggers.crons)) {
    return { errors: ["wrangler.jsonc triggers.crons must be an array of cron strings when configured."], warnings: [] };
  }

  const invalid = config.triggers.crons.filter((cron) => typeof cron !== "string" || cron.trim().length === 0);
  if (invalid.length > 0) {
    return { errors: ["wrangler.jsonc triggers.crons must contain only non-empty cron strings."], warnings: [] };
  }

  if (config.triggers.crons.length === 0) {
    return { errors: [], warnings: ["wrangler.jsonc triggers.crons is empty; scheduled update checks will not run."] };
  }

  return { errors: [], warnings: [] };
}

function wranglerCronTriggers(config) {
  return Array.isArray(config.triggers?.crons)
    ? [...new Set(config.triggers.crons.filter((cron) => typeof cron === "string" && cron.trim().length > 0).map((cron) => cron.trim()))]
    : [];
}

function routeHost(pattern) {
  let value = pattern.trim();
  if (value.length === 0) {
    return null;
  }

  if (value.startsWith("*.")) {
    return value.split("/")[0].toLowerCase();
  }

  try {
    const urlValue = value.includes("://") ? value : `https://${value}`;
    return new URL(urlValue.replace(/\/\*.*$/u, "/")).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function routeHostMatches(routeHostValue, publicBaseHost) {
  if (routeHostValue === publicBaseHost) {
    return true;
  }

  if (routeHostValue.startsWith("*.")) {
    return publicBaseHost.endsWith(routeHostValue.slice(1));
  }

  return false;
}

function runStep(step, rootDir) {
  console.log(`\n==> ${step.label}`);
  console.log(`$ ${step.command.join(" ")}`);

  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(missingCommandMessage(step.command[0]));
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function runStepResult(step, rootDir) {
  console.log(`\n==> ${step.label}`);
  console.log(`$ ${step.command.join(" ")}`);

  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    return { status: 1, output, error: result.error };
  }

  return { status: result.status ?? 0, output, error: null };
}

function printSetupPlan(plan) {
  for (const item of plan) {
    console.log(`\n- ${item.label}`);
    console.log(`  ${item.detail}`);
    if (item.command) {
      console.log(`  ${item.mutates ? "Command" : "Suggested"}: ${item.command.join(" ")}`);
    }
  }
}

function printDirectUploadSetupPlan(plan) {
  printSetupPlan(plan.items);
  console.log("\nR2 CORS details:");
  for (const line of plan.cors.lines) {
    console.log(line);
  }
}

function printCustomDomainSetupPlan(plan) {
  printSetupPlan(plan.items);
  console.log("\nCustom-domain details:");
  if (plan.origin) {
    console.log(`Final origin: ${plan.origin}`);
    console.log(`Suggested Wrangler route pattern: ${plan.routePattern}`);
  } else {
    console.log("Final origin: not configured yet");
  }
  console.log(plan.routeHosts.length > 0 ? `Configured route hosts: ${plan.routeHosts.join(", ")}` : "Configured route hosts: none");
  console.log(plan.matchingRoutes.length > 0 ? `Matching route hosts: ${plan.matchingRoutes.join(", ")}` : "Matching route hosts: none");
  console.log("\nR2 CORS alignment:");
  for (const line of plan.cors.lines) {
    console.log(line);
  }
}

function printScheduledTriggerSetupPlan(plan) {
  printSetupPlan(plan.items);
  console.log("\nScheduled-trigger details:");
  console.log(`Readiness: ${plan.readiness.status}`);
  console.log(plan.readiness.crons.length > 0 ? `Configured cron trigger(s): ${plan.readiness.crons.join(", ")}` : "Configured cron trigger(s): none");
  console.log(`Suggested cron trigger(s): ${plan.suggestedCrons.join(", ")}`);
  console.log("Read-only update checks require a valid update source and read-only scheduled checks enabled in /admin.");
  console.log("Scheduled storage/R2 maintenance requires scheduled maintenance enabled in /admin.");
}

function printCustomDomainVerificationPlan(plan) {
  console.log("\nCustom-domain verification details:");
  if (plan.origin) {
    console.log(`Final origin: ${plan.origin}`);
    console.log(`Expected health URL: ${plan.origin}/health`);
    console.log(`Expected admin URL: ${plan.origin}/admin`);
  } else {
    console.log("Final origin: not configured yet");
  }
  console.log(plan.routeHosts.length > 0 ? `Configured route hosts: ${plan.routeHosts.join(", ")}` : "Configured route hosts: none");
  console.log(plan.matchingRoutes.length > 0 ? `Matching route hosts: ${plan.matchingRoutes.join(", ")}` : "Matching route hosts: none");
  console.log(`Health status: ${plan.health.status}`);
  console.log(`Health detail: ${plan.health.detail}`);
  if (plan.health.recovery) {
    console.log(`Health recovery: ${plan.health.recovery}`);
  }
  printSetupPlan(plan.items);
  console.log("\nR2 CORS alignment:");
  for (const line of plan.cors.lines) {
    console.log(line);
  }
}

function printDeployVerificationPlan(plan) {
  console.log("\nPost-deploy verification details:");
  if (plan.origin) {
    console.log(`Final origin: ${plan.origin}`);
    console.log(`Origin kind: ${plan.originKind}`);
    console.log(`Expected upload URL: ${plan.origin}/`);
    console.log(`Expected health URL: ${plan.origin}/health`);
    console.log(`Expected admin URL: ${plan.origin}/admin`);
  } else {
    console.log("Final origin: not configured yet");
  }
  console.log(plan.routeHosts.length > 0 ? `Configured route hosts: ${plan.routeHosts.join(", ")}` : "Configured route hosts: none");
  console.log(plan.matchingRoutes.length > 0 ? `Matching route hosts: ${plan.matchingRoutes.join(", ")}` : "Matching route hosts: none");
  console.log(`Health status: ${plan.checks.health.status}`);
  console.log(`Health detail: ${plan.checks.health.detail}`);
  console.log(`Admin status: ${plan.checks.admin.status}`);
  console.log(`Admin detail: ${plan.checks.admin.detail}`);
  console.log(`Upload status: ${plan.checks.upload.status}`);
  console.log(`Upload detail: ${plan.checks.upload.detail}`);
  printSetupPlan(plan.items);
  console.log("\nR2 CORS alignment:");
  for (const line of plan.cors.lines) {
    console.log(line);
  }
}

function runSetupCommands(plan, rootDir) {
  for (const item of plan) {
    if (item.mutates && item.command) {
      runStep(item, rootDir);
    }
  }
}

function runDirectUploadSetupCommands(plan, rootDir, options) {
  const requiredSecretItems = plan.items.filter((item) => item.mutates && item.command && item.label.startsWith("Set required Wrangler secret"));
  for (const item of requiredSecretItems) {
    runStep(item, rootDir);
  }

  if (!options.applyCors) {
    return;
  }

  if (!plan.cors.corsJson) {
    throw new Error("R2 CORS cannot be applied until PUBLIC_BASE_URL or --public-base-url provides the final deployed origin.");
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "glyph-r2-cors-"));
  const corsPath = join(tmpDir, "cors.json");
  try {
    writeFileSync(corsPath, `${plan.cors.corsJson}\n`);
    runStep(
      {
        label: "Apply reviewed R2 CORS",
        command: buildR2CorsSetCommand(plan.cors.bucketName, corsPath, { force: true })
      },
      rootDir
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runCustomDomainSetup(effectiveOptions, rootDir, wranglerPath) {
  const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const plan = buildCustomDomainSetupPlan(effectiveOptions, configText);

  console.log(effectiveOptions.yes
    ? "Glyph custom-domain setup: explicitly confirmed local Wrangler config update only."
    : "Glyph custom-domain setup plan: no local files, deployments, migrations, DNS, certificates, custom domains, or Cloudflare resources will be changed.");
  if (configText) {
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
  } else {
    console.log("Wrangler config: wrangler.jsonc will be generated only with --turnkey-domain --yes and a valid --public-base-url.");
  }
  printCustomDomainSetupPlan(plan);

  if (!effectiveOptions.yes) {
    console.log("\nCustom-domain setup plan complete. Re-run with --turnkey-domain --yes --public-base-url https://files.example.com only after reviewing the local config suggestion and Cloudflare manual steps.");
    return 0;
  }

  if (plan.validationError || !plan.configUpdate.configText) {
    console.error(`Error: ${plan.validationError ?? plan.configUpdate.error ?? "A valid custom-domain origin is required."}`);
    return 1;
  }

  if (plan.configUpdate.changed) {
    writeFileSync(wranglerPath, plan.configUpdate.configText);
    console.log(`\nUpdated wrangler.jsonc with PUBLIC_BASE_URL ${plan.origin} and reviewed route hint ${plan.routePattern}.`);
  } else {
    console.log("\nwrangler.jsonc already matches the requested custom-domain configuration.");
  }

  console.log("Custom-domain local config update complete. Configure DNS/custom-domain attachment in Cloudflare, verify certificate readiness, align R2 CORS with the final origin, then run deploy readiness checks.");
  return 0;
}

function runScheduledTriggerSetup(effectiveOptions, wranglerPath) {
  const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const plan = buildScheduledTriggerSetupPlan(effectiveOptions, configText);

  console.log(effectiveOptions.yes
    ? "Glyph scheduled-trigger setup: explicitly confirmed local Wrangler cron config update only."
    : "Glyph scheduled-trigger setup plan: no local files, deployments, migrations, scheduled triggers, or Cloudflare resources will be changed.");
  if (configText) {
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
  } else {
    console.log("Wrangler config: wrangler.jsonc will be generated only with --turnkey-schedule --yes and reviewed cron config.");
  }
  printScheduledTriggerSetupPlan(plan);

  if (!effectiveOptions.yes) {
    console.log("\nScheduled-trigger setup plan complete. Re-run with --turnkey-schedule --yes only after reviewing the local Wrangler cron suggestion and admin follow-up steps.");
    return 0;
  }

  if (plan.configUpdate.error) {
    console.error(`Error: ${plan.configUpdate.error}`);
    return 1;
  }

  if (plan.configUpdate.changed) {
    writeFileSync(wranglerPath, plan.configUpdate.configText);
    console.log(`\nUpdated wrangler.jsonc with reviewed triggers.crons: ${plan.configUpdate.crons.join(", ")}.`);
  } else {
    console.log("\nwrangler.jsonc already has usable scheduled-trigger configuration.");
  }

  console.log("Scheduled-trigger local config update complete. Deploy intentionally, then enable read-only update checks and/or scheduled maintenance from the protected /admin settings.");
  return 0;
}

async function runCustomDomainVerification(effectiveOptions, wranglerPath) {
  const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const initialPlan = buildCustomDomainVerificationPlan(effectiveOptions, configText);
  const health = initialPlan.origin && !initialPlan.validationError
    ? await checkCustomDomainHealth(initialPlan.origin)
    : initialPlan.health;
  const plan = buildCustomDomainVerificationPlan(effectiveOptions, configText, health);

  console.log("Glyph custom-domain verification: read-only check; no local files or Cloudflare resources will be changed.");
  if (configText) {
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
  } else {
    console.log("Wrangler config: wrangler.jsonc not found; using supplied --public-base-url only.");
  }
  printCustomDomainVerificationPlan(plan);

  if (plan.validationError) {
    console.log("\nCustom-domain verification finished with a blocked origin configuration. Fix the origin and rerun the same command.");
  } else if (plan.health.ok) {
    console.log("\nCustom-domain verification finished: /health responded as Glyph. Confirm /admin and passkeys on the same origin before relying on the domain.");
  } else {
    console.log("\nCustom-domain verification finished with operator follow-up. Review the recovery guidance above before sharing links from this origin.");
  }

  return 0;
}

async function runDeployVerification(effectiveOptions, wranglerPath) {
  const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const initialPlan = buildDeployVerificationPlan(effectiveOptions, configText);
  const checks = initialPlan.origin && !initialPlan.validationError
    ? await checkDeployOrigin(initialPlan.origin)
    : initialPlan.checks;
  const plan = buildDeployVerificationPlan(effectiveOptions, configText, checks);

  console.log("Glyph post-deploy verification: read-only check; no uploads, passkey actions, local files, deployments, migrations, or Cloudflare resources will be changed.");
  if (configText) {
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
  } else {
    console.log("Wrangler config: wrangler.jsonc not found; using supplied --public-base-url only.");
  }
  printDeployVerificationPlan(plan);

  if (plan.validationError) {
    console.log("\nPost-deploy verification finished with a blocked origin configuration. Pass the deployed workers.dev or custom-domain origin and rerun the same command.");
  } else if (plan.checks.health.ok && plan.checks.admin.ok && plan.checks.upload.ok) {
    console.log("\nPost-deploy verification finished: /health, /admin, and / all look like Glyph. Confirm passkeys and any direct/multipart CORS settings on the same origin before relying on optional features.");
  } else {
    console.log("\nPost-deploy verification finished with operator follow-up. Review the recovery guidance above before sharing links from this origin.");
  }

  return 0;
}

function printTurnkeyPlan(plan) {
  for (const item of plan) {
    console.log(`\n- ${item.label}`);
    console.log(`  ${item.detail}`);
    if (item.command) {
      console.log(`  ${item.mutates ? "Command" : "Suggested"}: ${item.command.join(" ")}`);
    }
    if (item.commands) {
      for (const command of item.commands) {
        console.log(`  Check: ${command.join(" ")}`);
      }
    }
  }
}

function upsertBinding(bindings, bindingName, nextBinding) {
  if (!Array.isArray(bindings)) {
    return [nextBinding];
  }

  let replaced = false;
  const updated = bindings.map((binding) => {
    if (binding?.binding === bindingName) {
      replaced = true;
      return nextBinding;
    }
    return binding;
  });

  return replaced ? updated : [...updated, nextBinding];
}

function normalizeConfigText(value) {
  return typeof value === "string" ? `${value.trim()}\n` : "";
}

function extractD1DatabaseId(output) {
  const match = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu.exec(output);
  return match ? match[0] : null;
}

function runRequiredStep(step, rootDir) {
  const result = runStepResult(step, rootDir);
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(missingCommandMessage(step.command[0]));
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const recovery = classifyWranglerFailure(result.output);
    if (recovery) {
      console.log(`\n${recovery}`);
    }
    throw new Error(`${step.label} failed with exit code ${result.status}.`);
  }
  return result.output;
}

function runDeployStep(step, rootDir) {
  return step.command.includes("wrangler") ? runRequiredStep(step, rootDir) : runStep(step, rootDir);
}

function shouldDeployTurnkey(configText) {
  const validation = validateWranglerConfig(configText, { requireDeployReady: true });
  return validation.errors.length === 0;
}

function runTurnkey(effectiveOptions, rootDir, wranglerPath) {
  const originalConfigText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const plan = buildTurnkeyPlan(effectiveOptions, originalConfigText);

  console.log(effectiveOptions.yes ? "Glyph turnkey deploy: explicitly confirmed setup, checks, migrations, and deploy." : "Glyph turnkey deploy plan: no local files or Cloudflare resources will be changed.");
  if (originalConfigText) {
    for (const line of summarizeDeploymentTarget(originalConfigText)) {
      console.log(line);
    }
  } else {
    console.log("Wrangler config: wrangler.jsonc will be generated only with --turnkey --yes.");
  }
  for (const line of buildAuthReadinessLines(process.env)) {
    console.log(line);
  }
  for (const line of buildRemoteMigrationPlan(effectiveOptions)) {
    console.log(line);
  }
  for (const line of buildDirectUploadReadinessLines(originalConfigText, process.env)) {
    console.log(line);
  }
  printTurnkeyPlan(plan);

  if (!effectiveOptions.yes) {
    console.log("\nTurnkey plan complete. Re-run with --turnkey --yes when ready to create resources, write local config, run migrations, and deploy.");
    return 0;
  }

  runStep({ label: "Check pnpm", command: ["pnpm", "--version"] }, rootDir);
  runStep({ label: "Check Wrangler", command: ["pnpm", "wrangler", "--version"] }, rootDir);
  runRequiredStep({ label: "Check Wrangler authentication", command: ["pnpm", "wrangler", "whoami"] }, rootDir);

  const d1ListOutput = runRequiredStep({ label: "Discover D1 databases", command: ["pnpm", "wrangler", "d1", "list", "--json"] }, rootDir);
  const discoveredDatabaseId = findD1DatabaseId(d1ListOutput, effectiveOptions.database);
  if (discoveredDatabaseId) {
    console.log(`\nFound existing D1 database ${effectiveOptions.database} (${discoveredDatabaseId}); it will be reused.`);
  }

  const r2ListOutput = runRequiredStep({ label: "Discover R2 buckets", command: ["pnpm", "wrangler", "r2", "bucket", "list"] }, rootDir);
  const discoveredR2Bucket = hasR2Bucket(r2ListOutput, effectiveOptions.bucket);
  if (discoveredR2Bucket) {
    console.log(`\nFound existing R2 bucket ${effectiveOptions.bucket}; it will be reused.`);
  }

  let resolvedDatabaseId = effectiveOptions.databaseId ?? discoveredDatabaseId;
  const dbItem = plan.find((item) => item.label === "Create D1 database");
  if (!resolvedDatabaseId && dbItem?.command) {
    const result = runStepResult(dbItem, rootDir);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const recovery = classifyWranglerFailure(result.output);
      if (recovery) {
        console.log(`\n${recovery}`);
      }
      if (!/already exists|already in use/iu.test(result.output)) {
        throw new Error(`${dbItem.label} failed with exit code ${result.status}.`);
      }
    } else {
      resolvedDatabaseId = resolvedDatabaseId ?? extractD1DatabaseId(result.output);
    }
  }

  const r2Item = plan.find((item) => item.label === "Create or confirm R2 bucket");
  if (!discoveredR2Bucket && r2Item?.command) {
    const result = runStepResult(r2Item, rootDir);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const recovery = classifyWranglerFailure(result.output);
      if (recovery) {
        console.log(`\n${recovery}`);
      }
      if (/already exists|already in use/iu.test(result.output)) {
        for (const line of buildTurnkeyRecoveryLines(effectiveOptions, { r2AlreadyExists: true })) {
          console.log(line);
        }
      } else {
        throw new Error(`${r2Item.label} failed with exit code ${result.status}.`);
      }
    }
  }

  const configOptions = { ...effectiveOptions, databaseId: resolvedDatabaseId };
  const configResult = buildTurnkeyWranglerConfig(originalConfigText, configOptions);
  if (configResult.changed) {
    writeFileSync(wranglerPath, configResult.configText);
    console.log("\nUpdated wrangler.jsonc with Glyph binding configuration.");
  } else {
    console.log("\nwrangler.jsonc already matches the requested Glyph binding configuration.");
  }

  const deployReadyText = readFileSync(wranglerPath, "utf8");
  const deployValidation = validateWranglerConfig(deployReadyText, { requireDeployReady: true });
  for (const warning of deployValidation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (!shouldDeployTurnkey(deployReadyText)) {
    for (const error of deployValidation.errors) {
      console.error(`Error: ${error}`);
    }
    console.log("\nTurnkey setup stopped before deploy.");
    for (const line of buildTurnkeyRecoveryLines(effectiveOptions, { d1CreatedWithoutId: !resolvedDatabaseId })) {
      console.log(line);
    }
    return 1;
  }

  for (const step of buildDeploySteps({ ...effectiveOptions, yes: true })) {
    runDeployStep(step, rootDir);
  }

  console.log("\nTurnkey deploy complete.");
  for (const line of buildTurnkeyFollowUpLines(deployReadyText, effectiveOptions)) {
    console.log(line);
  }

  return 0;
}

function runDirectUploadSetup(effectiveOptions, rootDir, wranglerPath) {
  const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
  const plan = buildDirectUploadSetupPlan(effectiveOptions, configText, process.env);

  console.log(effectiveOptions.yes
    ? "Glyph direct/multipart setup: explicitly confirmed interactive Wrangler secret setup."
    : "Glyph direct/multipart setup plan: no secrets, CORS, deployments, migrations, or Cloudflare resources will be changed.");
  if (effectiveOptions.applyCors) {
    console.log("R2 CORS application is explicitly requested with --apply-cors.");
  } else {
    console.log("R2 CORS application is not requested; CORS remains manual/planned.");
  }
  if (configText) {
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
  }
  for (const line of buildAuthReadinessLines(process.env)) {
    console.log(line);
  }
  printDirectUploadSetupPlan(plan);

  if (!effectiveOptions.yes) {
    console.log("\nDirect/multipart setup plan complete. Re-run with --turnkey-secrets --yes to set required Wrangler secrets interactively. Add --apply-cors only after reviewing the CORS recommendation.");
    return 0;
  }

  if (effectiveOptions.applyCors && !plan.cors.corsJson) {
    console.error("Error: --apply-cors requires PUBLIC_BASE_URL or --public-base-url to provide the final deployed origin.");
    return 1;
  }

  if (!process.stdin.isTTY) {
    console.error("Error: --turnkey-secrets --yes requires an interactive terminal so Wrangler can prompt for secret values without printing them.");
    return 1;
  }

  runDirectUploadSetupCommands(plan, rootDir, effectiveOptions);
  console.log("\nDirect/multipart setup complete. Verify secrets and CORS in Cloudflare, then use /admin to switch upload mode when ready. Worker-mediated uploads remain available as fallback.");
  return 0;
}

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (options.readiness) {
    const report = buildReadinessReport(options, collectReadinessContext(rootDir, process.env));
    console.log(formatReadinessReport(report));
    return 0;
  }

  if (options.turnkeyRehearse) {
    const report = buildTurnkeyRehearsalReport(options, collectReadinessContext(rootDir, process.env));
    console.log(formatTurnkeyRehearsalReport(report));
    return 0;
  }

  if (options.turnkeyExamples) {
    const report = buildTurnkeyExamplesReport(options, collectReadinessContext(rootDir, process.env));
    console.log(formatTurnkeyExamplesReport(report));
    return 0;
  }

  if (options.cloudflareRehearsal) {
    const checklist = buildCloudflareRehearsalChecklist(options, collectReadinessContext(rootDir, process.env));
    console.log(formatCloudflareRehearsalChecklist(checklist));
    return 0;
  }

  if (options.preflight) {
    const checklist = buildPreflightChecklist(options, collectReadinessContext(rootDir, process.env));
    const markdown = formatPreflightChecklist(checklist);
    if (options.outdirExplicit) {
      const filePath = writePreflightChecklistFile(markdown, options, rootDir);
      console.log(`Preflight checklist written to ${filePath}`);
    } else {
      console.log(markdown);
    }
    return 0;
  }

  const effectiveOptions = { ...options, check: !options.yes };
  const validation = validateProject(rootDir, {
    ...effectiveOptions,
    yes: effectiveOptions.setup || effectiveOptions.turnkey || effectiveOptions.turnkeySecrets || effectiveOptions.turnkeyDomain || effectiveOptions.turnkeySchedule || effectiveOptions.turnkeyRehearse || effectiveOptions.turnkeyExamples || effectiveOptions.preflight || effectiveOptions.cloudflareRehearsal || effectiveOptions.verifyDomain || effectiveOptions.verifyDeploy ? false : effectiveOptions.yes
  });

  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`Error: ${error}`);
    }
    return 1;
  }

  const wranglerPath = join(rootDir, "wrangler.jsonc");

  if (effectiveOptions.turnkey) {
    return runTurnkey(effectiveOptions, rootDir, wranglerPath);
  }

  if (effectiveOptions.turnkeySecrets) {
    return runDirectUploadSetup(effectiveOptions, rootDir, wranglerPath);
  }

  if (effectiveOptions.turnkeyDomain) {
    return runCustomDomainSetup(effectiveOptions, rootDir, wranglerPath);
  }

  if (effectiveOptions.turnkeySchedule) {
    return runScheduledTriggerSetup(effectiveOptions, wranglerPath);
  }

  if (effectiveOptions.verifyDomain) {
    return runCustomDomainVerification(effectiveOptions, wranglerPath);
  }

  if (effectiveOptions.verifyDeploy) {
    return runDeployVerification(effectiveOptions, wranglerPath);
  }

  if (effectiveOptions.setup) {
    const configText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : null;
    const plan = buildSetupPlan(effectiveOptions, configText);
    console.log(effectiveOptions.yes ? "Glyph setup: creating explicitly requested Cloudflare resources." : "Glyph setup plan: no Cloudflare resources will be changed.");
    if (configText) {
      for (const line of summarizeDeploymentTarget(configText)) {
        console.log(line);
      }
    }
    printSetupPlan(plan);

    if (effectiveOptions.yes) {
      runSetupCommands(plan, rootDir);
      console.log("\nSetup resource creation complete. Copy any returned D1 database_id into wrangler.jsonc, configure secrets/CORS if needed, then run deploy:glyph -- --check.");
    } else {
      console.log("\nSetup plan complete. Re-run with --setup --yes to create the D1 database and R2 bucket.");
    }

    return 0;
  }

  console.log(effectiveOptions.yes ? "Glyph deploy: checks, remote migrations, dry-run, deploy." : "Glyph deploy check: checks, remote migration list, dry-run.");

  if (existsSync(wranglerPath)) {
    const configText = readFileSync(wranglerPath, "utf8");
    for (const line of summarizeDeploymentTarget(configText)) {
      console.log(line);
    }
    for (const line of buildAuthReadinessLines(process.env)) {
      console.log(line);
    }
    for (const line of buildRemoteMigrationPlan(effectiveOptions)) {
      console.log(line);
    }
    for (const line of buildDirectUploadReadinessLines(configText, process.env)) {
      console.log(line);
    }
  }

  for (const step of buildDeploySteps(effectiveOptions)) {
    runDeployStep(step, rootDir);
  }

  if (!effectiveOptions.yes) {
    console.log("\nCheck complete. Re-run with --yes to apply remote migrations and deploy.");
  } else {
    console.log("\nDeploy complete. Open /admin on the deployed origin to bootstrap or sign in.");
    if (existsSync(wranglerPath)) {
      for (const line of buildPostDeployVerificationLines(readFileSync(wranglerPath, "utf8"))) {
        console.log(line);
      }
    }
  }

  return 0;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
  main(process.argv.slice(2), rootDir).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
