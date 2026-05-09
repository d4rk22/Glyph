#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    skipInstall: false,
    database: DEFAULT_DATABASE_NAME,
    bucket: DEFAULT_BUCKET_NAME,
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
    } else if (arg === "--skip-install") {
      options.skipInstall = true;
    } else if (arg === "--database") {
      options.database = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--database=")) {
      options.database = arg.slice("--database=".length);
    } else if (arg === "--bucket") {
      options.bucket = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--bucket=")) {
      options.bucket = arg.slice("--bucket=".length);
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

  if (options.database.trim().length === 0) {
    throw new Error("Database name cannot be empty.");
  }

  if (options.bucket.trim().length === 0) {
    throw new Error("R2 bucket name cannot be empty.");
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

export function usage() {
  return `Glyph deploy helper

Usage:
  pnpm run deploy:glyph -- --setup
  pnpm run deploy:glyph -- --setup --yes
  pnpm run deploy:glyph -- --check
  pnpm run deploy:glyph -- --yes

Options:
  --setup             Print a guided Cloudflare setup plan. With --yes, create D1/R2 resources.
  --check             Run validation, remote migration check, tests, and dry-run without deploying. Default.
  --yes, -y           Apply remote D1 migrations and deploy after checks pass.
  --skip-install      Skip pnpm install --frozen-lockfile.
  --database <name>   D1 database name or binding to migrate. Default: glyph.
  --bucket <name>     R2 bucket name to create during --setup --yes. Default: glyph-files.
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
`;
}

export function validateProject(rootDir, options) {
  const errors = [];
  const warnings = [];
  const requiredFiles = ["package.json", "pnpm-lock.yaml", "wrangler.jsonc", "migrations", "src/index.ts"];

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

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const effectiveOptions = { ...options, check: !options.yes };
  const validation = validateProject(rootDir, {
    ...effectiveOptions,
    yes: effectiveOptions.setup ? false : effectiveOptions.yes
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
