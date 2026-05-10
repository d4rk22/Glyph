#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DATABASE_NAME = "glyph";
export const DEFAULT_BUCKET_NAME = "glyph-files";
export const DEFAULT_DRY_RUN_OUTDIR = "/tmp/glyph-deploy-dry-run";
export const PLACEHOLDER_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const DIRECT_UPLOAD_SECRET_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
export const OPTIONAL_DIRECT_UPLOAD_SECRET_NAMES = ["R2_BUCKET_NAME"];

export function parseArgs(argv) {
  const options = {
    yes: false,
    check: false,
    setup: false,
    turnkey: false,
    turnkeySecrets: false,
    applyCors: false,
    readiness: false,
    skipInstall: false,
    reuseResources: false,
    database: DEFAULT_DATABASE_NAME,
    databaseId: null,
    bucket: DEFAULT_BUCKET_NAME,
    publicBaseUrl: null,
    outdir: DEFAULT_DRY_RUN_OUTDIR,
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
      index += 1;
    } else if (arg.startsWith("--outdir=")) {
      options.outdir = arg.slice("--outdir=".length);
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

  if (options.turnkeySecrets && (options.check || options.setup || options.turnkey)) {
    throw new Error("Use --turnkey-secrets by itself, or with --yes and optional --apply-cors.");
  }

  if (options.applyCors && (!options.turnkeySecrets || !options.yes)) {
    throw new Error("Use --apply-cors only with --turnkey-secrets --yes after reviewing the generated CORS recommendation.");
  }

  if (options.readiness && (options.yes || options.check || options.setup || options.turnkey || options.turnkeySecrets || options.applyCors)) {
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
        ? `Wrangler cron trigger(s) found: ${cronTriggers.join(", ")}. Read-only scheduled update checks still require a valid update source and read-only scheduled checks enabled in /admin; scheduled maintenance requires scheduled maintenance enabled in /admin. Glyph does not create triggers automatically.`
        : "No Wrangler cron trigger is configured. To use read-only scheduled update checks or scheduled maintenance, add a Cloudflare Scheduled Worker trigger manually, then enable the desired scheduled behavior in /admin. Glyph does not create triggers automatically."
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
      label: "Configure direct/multipart upload readiness",
      mutates: false,
      detail: "After the basic deployment path is ready, run pnpm run deploy:glyph -- --turnkey-secrets to plan interactive Wrangler secret setup and reviewed R2 CORS application. Confirmed secret/CORS setup is separate from Worker deploy and remote migrations."
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
    const routeHosts = wranglerRouteHosts(config);
    const cronTriggers = wranglerCronTriggers(config);

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
      const publicBaseResult = validatePublicBaseUrl(publicBaseUrl);
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
        cronTriggers.length > 0 ? "ready" : "optional",
        "Scheduled triggers",
        cronTriggers.length > 0 ? `Configured cron trigger(s): ${cronTriggers.join(", ")}.` : "none configured; scheduled update checks and maintenance stay inert until an operator adds a trigger."
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

  sections.push({
    title: "Post-deploy readiness",
    items: buildPostDeployVerificationLines(configText).map((line) => readinessItem("manual", "Health/admin check", line))
  });

  sections.push({
    title: "Safety boundary",
    items: [
      readinessItem(
        "ready",
        "Read-only report",
        "No secret storage, no CORS application, no remote migrations, no deploy, no DNS/custom-domain/scheduled-trigger creation, no release publishing, no update execution, and no Cloudflare mutations."
      )
    ]
  });

  return { title: "Glyph deploy readiness report", sections };
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
  pnpm run deploy:glyph -- --turnkey --yes
  pnpm run deploy:glyph -- --turnkey-secrets
  pnpm run deploy:glyph -- --turnkey-secrets --yes
  pnpm run deploy:glyph -- --readiness
  pnpm run deploy:glyph -- --check
  pnpm run deploy:glyph -- --yes

Options:
  --setup             Print a guided Cloudflare setup plan. With --yes, create D1/R2 resources.
  --turnkey           Print or run a fresh-checkout setup, verification, migration, and deploy flow.
  --turnkey-secrets   Print or run guided direct/multipart Wrangler secret setup and reviewed R2 CORS planning.
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
  --outdir <path>     Wrangler dry-run output directory. Default: /tmp/glyph-deploy-dry-run.
  --help, -h          Show this help.

Custom domain readiness:
  Set vars.PUBLIC_BASE_URL in wrangler.jsonc to the deployed https:// origin when using a custom domain.
  The helper validates the URL shape and warns when it does not line up with Wrangler routes.

Scheduled update check readiness:
  Optional read-only scheduled update checks require a Wrangler cron trigger plus a valid update source
  and read-only scheduled checks enabled in /admin. The helper reports cron trigger configuration but
  never creates triggers, deploys updates, applies migrations, checks out code, stores GitHub tokens,
  executes local update helpers, or mutates Cloudflare resources for scheduled checks.

Scheduled maintenance readiness:
  Optional scheduled maintenance uses the same Wrangler cron trigger mechanism plus scheduled
  maintenance enabled in /admin. It can enforce storage policy in Glyph metadata and R2, but the helper
  never creates triggers or mutates Cloudflare resources.

Turnkey safety:
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
  if (existsSync(wranglerPath)) {
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

  const effectiveOptions = { ...options, check: !options.yes };
  const validation = validateProject(rootDir, {
    ...effectiveOptions,
    yes: effectiveOptions.setup || effectiveOptions.turnkey || effectiveOptions.turnkeySecrets ? false : effectiveOptions.yes
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
