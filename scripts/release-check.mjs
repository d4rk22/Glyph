#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_RELEASE_DRY_RUN_OUTDIR = "/tmp/glyph-release-dry-run";

export function parseReleaseArgs(argv) {
  const options = {
    skipD1: false,
    outdir: DEFAULT_RELEASE_DRY_RUN_OUTDIR,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-d1") {
      options.skipD1 = true;
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

  if (options.outdir.trim().length === 0) {
    throw new Error("Dry-run output directory cannot be empty.");
  }

  return options;
}

export function readPackageVersion(rootDir) {
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("package.json must define a non-empty version.");
  }

  return packageJson.version;
}

export function validateVersionSource(rootDir) {
  const errors = [];
  const versionModulePath = join(rootDir, "src/version.ts");

  if (!existsSync(versionModulePath)) {
    errors.push("src/version.ts is missing.");
  } else {
    const versionModule = readFileSync(versionModulePath, "utf8");
    if (!versionModule.includes("../package.json")) {
      errors.push("src/version.ts must import package.json as the version source.");
    }
    if (!versionModule.includes("GLYPH_VERSION")) {
      errors.push("src/version.ts must export GLYPH_VERSION.");
    }
  }

  const version = readPackageVersion(rootDir);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    errors.push(`package.json version ${version} should be a semver release version.`);
  }

  return { version, errors };
}

export function buildReleaseCheckSteps(options) {
  const steps = [
    { label: "Typecheck", command: ["./node_modules/.bin/tsc", "--noEmit"] },
    { label: "Run tests", command: ["node", "--test", "--experimental-strip-types", "tests/*.test.ts"] },
    {
      label: "Wrangler deploy dry-run",
      command: ["./node_modules/.bin/wrangler", "deploy", "--dry-run", "--outdir", options.outdir]
    }
  ];

  if (!options.skipD1) {
    steps.push({
      label: "Check local D1 migrations",
      command: ["./node_modules/.bin/wrangler", "d1", "migrations", "apply", "glyph", "--local"]
    });
  }

  return steps;
}

export function usage() {
  return `Glyph release check

Usage:
  pnpm run release:check

Options:
  --skip-d1        Skip the local D1 migration check.
  --outdir <path>  Wrangler dry-run output directory. Default: /tmp/glyph-release-dry-run.
  --help, -h       Show this help.

This command validates version consistency and runs non-publishing release checks.
`;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
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

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseReleaseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const validation = validateVersionSource(rootDir);
  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`Error: ${error}`);
    }
    return 1;
  }

  console.log(`Glyph release check for version ${validation.version}.`);
  console.log("This command does not publish a GitHub release, deploy, apply remote migrations, or mutate Cloudflare resources.");

  for (const step of buildReleaseCheckSteps(options)) {
    runStep(step, rootDir);
  }

  console.log("\nRelease check complete. Review release notes and migration notes before tagging a GitHub release.");
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
