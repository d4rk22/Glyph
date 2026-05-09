#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DATABASE_NAME = "glyph";
export const DEFAULT_BUCKET_NAME = "glyph-files";
export const DEFAULT_DRY_RUN_OUTDIR = "/tmp/glyph-deploy-dry-run";
export const PLACEHOLDER_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function parseArgs(argv) {
  const options = {
    yes: false,
    check: false,
    setup: false,
    turnkey: false,
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
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--setup") {
      options.setup = true;
    } else if (arg === "--turnkey") {
      options.turnkey = true;
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

export function buildSetupPlan(options, configText = null) {
  const config = configText ? parseWranglerConfig(configText) : null;
  const dbBinding = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((binding) => binding?.binding === "DB")
    : null;
  const r2Binding = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.find((binding) => binding?.binding === "FILES")
    : null;
  const publicBaseUrl = typeof config?.vars?.PUBLIC_BASE_URL === "string" ? config.vars.PUBLIC_BASE_URL.trim() : "";
  const routeHosts = config ? wranglerRouteHosts(config) : [];
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
      detail: "For direct or multipart uploads, set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY with Wrangler secrets or dashboard values. Do not commit secrets."
    },
    {
      label: "Configure R2 CORS",
      mutates: false,
      detail: routeHosts.length > 0 || publicBaseUrl
        ? "Allow browser PUT requests from the deployed Glyph origin and expose ETag for multipart uploads."
        : "Once the deployed origin is known, allow browser PUT requests from it and expose ETag for multipart uploads."
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
      detail: "Checks Node.js, pnpm, Wrangler, project files, and Wrangler authentication before any deploy action.",
      commands: [
        ["node", "--version"],
        ["pnpm", "--version"],
        ["pnpm", "wrangler", "--version"],
        ["pnpm", "wrangler", "whoami"]
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
        ? `Validates bindings, https PUBLIC_BASE_URL ${publicBaseUrl}, custom-domain route hints, scheduled trigger readiness, and direct/multipart credential guidance.`
        : "Validates bindings, request-origin fallback, custom-domain route hints, scheduled trigger readiness, and direct/multipart credential guidance."
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
  lines.push("Recovery: if setup stops midway, re-run --turnkey without --yes to review current readiness, then re-run --turnkey --yes with --reuse-resources and the real --d1-database-id when needed.");

  return lines;
}

export function usage() {
  return `Glyph deploy helper

Usage:
  pnpm run deploy:glyph -- --setup
  pnpm run deploy:glyph -- --setup --yes
  pnpm run deploy:glyph -- --turnkey
  pnpm run deploy:glyph -- --turnkey --yes
  pnpm run deploy:glyph -- --check
  pnpm run deploy:glyph -- --yes

Options:
  --setup             Print a guided Cloudflare setup plan. With --yes, create D1/R2 resources.
  --turnkey           Print or run a fresh-checkout setup, verification, migration, and deploy flow.
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
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function parseWranglerConfig(configText) {
  try {
    return JSON.parse(stripJsonComments(configText));
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

function runStepCapture(step, rootDir) {
  console.log(`\n==> ${step.label}`);
  console.log(`$ ${step.command.join(" ")}`);

  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status ?? "unknown"}.`);
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
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

function runSetupCommands(plan, rootDir) {
  for (const item of plan) {
    if (item.mutates && item.command) {
      runStep(item, rootDir);
    }
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
  printTurnkeyPlan(plan);

  if (!effectiveOptions.yes) {
    console.log("\nTurnkey plan complete. Re-run with --turnkey --yes when ready to create resources, write local config, run migrations, and deploy.");
    return 0;
  }

  runStep({ label: "Check pnpm", command: ["pnpm", "--version"] }, rootDir);
  runStep({ label: "Check Wrangler", command: ["pnpm", "wrangler", "--version"] }, rootDir);
  runStep({ label: "Check Wrangler authentication", command: ["pnpm", "wrangler", "whoami"] }, rootDir);

  let resolvedDatabaseId = effectiveOptions.databaseId;
  const dbItem = plan.find((item) => item.label === "Create D1 database");
  if (dbItem?.command) {
    const output = runStepCapture(dbItem, rootDir);
    resolvedDatabaseId = resolvedDatabaseId ?? extractD1DatabaseId(output);
  }

  const r2Item = plan.find((item) => item.label === "Create or confirm R2 bucket");
  if (r2Item?.command) {
    runStep(r2Item, rootDir);
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
    console.log("\nTurnkey setup stopped before deploy. Add the real D1 database_id with --d1-database-id or edit wrangler.jsonc, then re-run --turnkey --yes --reuse-resources.");
    return 1;
  }

  for (const step of buildDeploySteps({ ...effectiveOptions, yes: true })) {
    runStep(step, rootDir);
  }

  console.log("\nTurnkey deploy complete.");
  for (const line of buildTurnkeyFollowUpLines(deployReadyText, effectiveOptions)) {
    console.log(line);
  }

  return 0;
}

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const effectiveOptions = { ...options, check: !options.yes };
  const validation = validateProject(rootDir, {
    ...effectiveOptions,
    yes: effectiveOptions.setup || effectiveOptions.turnkey ? false : effectiveOptions.yes
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
    for (const line of summarizeDeploymentTarget(readFileSync(wranglerPath, "utf8"))) {
      console.log(line);
    }
  }

  for (const step of buildDeploySteps(effectiveOptions)) {
    runStep(step, rootDir);
  }

  if (!effectiveOptions.yes) {
    console.log("\nCheck complete. Re-run with --yes to apply remote migrations and deploy.");
  } else {
    console.log("\nDeploy complete. Open /admin on the deployed origin to bootstrap or sign in.");
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
