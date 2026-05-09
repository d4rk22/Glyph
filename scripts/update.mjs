#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OFFICIAL_UPDATE_SOURCE_URL = "https://github.com/d4rk22/Glyph";
export const DEFAULT_UPDATE_CHANNEL = "stable";

export function parseUpdateArgs(argv) {
  const options = {
    source: OFFICIAL_UPDATE_SOURCE_URL,
    channel: DEFAULT_UPDATE_CHANNEL,
    yes: false,
    rehearse: false,
    apply: false,
    keepWorktree: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      options.source = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
    } else if (arg === "--channel") {
      options.channel = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--channel=")) {
      options.channel = arg.slice("--channel=".length);
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--rehearse") {
      options.rehearse = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--keep-worktree") {
      options.keepWorktree = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.source = options.source.trim();
  options.channel = options.channel.trim();

  if (options.source.length === 0) {
    throw new Error("Update source cannot be empty.");
  }

  if (options.channel !== "stable" && options.channel !== "beta") {
    throw new Error("Update channel must be stable or beta.");
  }

  if (options.keepWorktree && !options.rehearse) {
    throw new Error("Use --keep-worktree only with --rehearse.");
  }

  if (options.apply && options.rehearse) {
    throw new Error("Use --apply and --rehearse as separate workflows.");
  }

  return options;
}

export function updateReleaseRequestUrl(sourceUrl, channel) {
  const source = parseGitHubSource(sourceUrl);
  if (source instanceof Error) {
    return source;
  }

  const encodedOwner = encodeURIComponent(source.owner);
  const encodedRepo = encodeURIComponent(source.repo);
  return channel === "beta"
    ? `https://api.github.com/repos/${encodedOwner}/${encodedRepo}/releases?per_page=1`
    : `https://api.github.com/repos/${encodedOwner}/${encodedRepo}/releases/latest`;
}

export function parseGitHubSource(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return new Error("Update source must be a valid GitHub repository URL.");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    return new Error("Only https://github.com/<owner>/<repo> update sources are supported.");
  }

  const [owner, repoWithSuffix] = url.pathname.split("/").filter(Boolean);
  const repo = repoWithSuffix?.replace(/\.git$/u, "");
  if (!owner || !repo) {
    return new Error("GitHub update source must include owner and repo.");
  }

  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    gitUrl: `https://github.com/${owner}/${repo}.git`
  };
}

export function normalizeReleaseRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof value.tag_name !== "string" || value.tag_name.trim().length === 0) {
    return null;
  }

  return {
    tag: value.tag_name.trim(),
    name: typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : null,
    body: typeof value.body === "string" && value.body.trim().length > 0 ? summarizeReleaseNotes(value.body) : null,
    publishedAt: typeof value.published_at === "string" && value.published_at.trim().length > 0 ? value.published_at.trim() : null,
    url: typeof value.html_url === "string" && value.html_url.trim().length > 0 ? value.html_url.trim() : null
  };
}

export function normalizeReleaseResponse(value) {
  if (Array.isArray(value)) {
    return normalizeReleaseRecord(value[0]);
  }

  return normalizeReleaseRecord(value);
}

export function summarizeReleaseNotes(value) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

export function compareVersions(candidate, current) {
  const candidateVersion = parseSemver(candidate);
  const currentVersion = parseSemver(current);
  if (!candidateVersion || !currentVersion) {
    return candidate === current ? 0 : null;
  }

  for (const key of ["major", "minor", "patch"]) {
    if (candidateVersion[key] > currentVersion[key]) {
      return 1;
    }
    if (candidateVersion[key] < currentVersion[key]) {
      return -1;
    }
  }

  if (candidateVersion.prerelease === currentVersion.prerelease) {
    return 0;
  }

  if (candidateVersion.prerelease === null) {
    return 1;
  }

  if (currentVersion.prerelease === null) {
    return -1;
  }

  return comparePrerelease(candidateVersion.prerelease, currentVersion.prerelease);
}

export function buildUpdatePlan({ currentVersion, options, release, cleanWorkingTree }) {
  const source = parseGitHubSource(options.source);
  if (source instanceof Error) {
    throw source;
  }

  const comparison = compareVersions(release.tag, currentVersion);
  const newer = comparison === null ? release.tag !== currentVersion && release.tag !== `v${currentVersion}` : comparison > 0;
  const canFetchTag = Boolean(options.yes && newer && cleanWorkingTree && !options.rehearse && !options.apply);
  const canRehearse = Boolean(options.rehearse && options.yes && newer && cleanWorkingTree);
  const canApply = Boolean(options.apply && options.yes && newer && cleanWorkingTree);
  const worktreePath = `/tmp/glyph-update-${safePathSegment(release.tag)}`;
  const confirmedAction = options.apply ? "apply the update to the current checkout" : options.rehearse ? "create an update rehearsal worktree" : "fetch the update tag";
  const skippedAction = options.apply ? "apply" : options.rehearse ? "rehearsal" : "tag fetch";

  return {
    currentVersion,
    sourceUrl: source.repoUrl,
    channel: options.channel,
    release,
    comparison,
    newer,
    cleanWorkingTree,
    mutates: canFetchTag || canRehearse || canApply,
    rehearses: Boolean(options.rehearse),
    applies: Boolean(options.apply),
    keepWorktree: Boolean(options.keepWorktree),
    warnings: [
      ...(comparison === null ? [`Could not compare ${release.tag} to ${currentVersion} as semver; treating different tags as potentially newer.`] : []),
      ...(!cleanWorkingTree && options.yes ? [`Working tree is not clean; refusing to ${confirmedAction}.`] : []),
      ...(!newer && options.yes ? [`Latest release is not newer than the current package version; no ${skippedAction} is needed.`] : [])
    ],
    commands: {
      fetchTag: ["git", "fetch", source.gitUrl, "tag", release.tag],
      checkout: ["git", "checkout", release.tag],
      worktreeAdd: ["git", "worktree", "add", "--detach", worktreePath, release.tag],
      worktreeRemove: ["git", "worktree", "remove", "--force", worktreePath],
      install: ["pnpm", "install", "--frozen-lockfile"],
      releaseCheck: ["pnpm", "run", "release:check"],
      deployCheck: ["pnpm", "run", "deploy:glyph", "--", "--check"],
      deploy: ["pnpm", "run", "deploy:glyph", "--", "--yes"]
    }
  };
}

export function buildRehearsalSteps(plan) {
  return [
    { label: "Fetch release tag", command: plan.commands.fetchTag, cwd: null, mutates: true },
    { label: "Create isolated worktree", command: plan.commands.worktreeAdd, cwd: null, mutates: true },
    { label: "Install locked dependencies in worktree", command: plan.commands.install, cwd: plan.commands.worktreeAdd.at(-2), mutates: true },
    { label: "Run release checks in worktree", command: plan.commands.releaseCheck, cwd: plan.commands.worktreeAdd.at(-2), mutates: false },
    { label: "Summarize target migrations", command: null, cwd: plan.commands.worktreeAdd.at(-2), mutates: false },
    ...(!plan.keepWorktree ? [{ label: "Remove rehearsal worktree", command: plan.commands.worktreeRemove, cwd: null, mutates: true }] : [])
  ];
}

export function buildApplySteps(plan) {
  return [
    { label: "Fetch release tag", command: plan.commands.fetchTag, cwd: null, mutates: true },
    { label: "Check out release tag", command: plan.commands.checkout, cwd: null, mutates: true },
    { label: "Install locked dependencies", command: plan.commands.install, cwd: null, mutates: true },
    { label: "Run release checks", command: plan.commands.releaseCheck, cwd: null, mutates: false },
    { label: "Review and apply remote D1 migrations intentionally", command: null, cwd: null, mutates: false },
    { label: "Run deploy checks", command: plan.commands.deployCheck, cwd: null, mutates: false },
    { label: "Deploy intentionally", command: plan.commands.deploy, cwd: null, mutates: true }
  ];
}

export function formatUpdatePlan(plan) {
  const lines = [
    `Glyph manual update plan`,
    `Current version: ${plan.currentVersion}`,
    `Update source: ${plan.sourceUrl}`,
    `Channel: ${plan.channel}`,
    `Latest release: ${plan.release.tag}${plan.release.name ? ` (${plan.release.name})` : ""}`,
    plan.release.publishedAt ? `Published: ${plan.release.publishedAt}` : "Published: unknown",
    plan.release.url ? `Release URL: ${plan.release.url}` : "Release URL: unavailable",
    `Update available: ${plan.newer ? "yes" : "no"}`,
    `Working tree clean: ${plan.cleanWorkingTree ? "yes" : "no"}`,
    `Rehearsal mode: ${plan.rehearses ? "yes" : "no"}`,
    `Apply mode: ${plan.applies ? "yes" : "no"}`
  ];

  if (plan.release.body) {
    lines.push("", "Release notes summary:", plan.release.body);
  }

  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push(
    "",
    "Recommended manual workflow:",
    `1. Fetch the release tag: ${plan.commands.fetchTag.join(" ")}`,
    `2. Check out the tag locally: ${plan.commands.checkout.join(" ")}`,
    `3. Install locked dependencies: ${plan.commands.install.join(" ")}`,
    `4. Run release checks: ${plan.commands.releaseCheck.join(" ")}`,
    "5. Apply remote D1 migrations intentionally after reviewing migration notes.",
    `6. Run deploy checks: ${plan.commands.deployCheck.join(" ")}`,
    `7. Deploy intentionally: ${plan.commands.deploy.join(" ")}`,
    "",
    ...(plan.rehearses
      ? [
          "Update rehearsal:",
          `1. Fetch the release tag: ${plan.commands.fetchTag.join(" ")}`,
          `2. Create an isolated worktree: ${plan.commands.worktreeAdd.join(" ")}`,
          `3. Install locked dependencies inside the worktree: ${plan.commands.install.join(" ")}`,
          `4. Run release checks inside the worktree: ${plan.commands.releaseCheck.join(" ")}`,
          "5. Summarize migration files from the target release.",
          plan.keepWorktree
            ? `6. Keep the rehearsal worktree for inspection; remove it later with: ${plan.commands.worktreeRemove.join(" ")}`
            : `6. Clean up the rehearsal worktree: ${plan.commands.worktreeRemove.join(" ")}`,
          ""
        ]
      : []),
    ...(plan.applies
      ? [
          "Apply mode:",
          `1. Fetch the release tag: ${plan.commands.fetchTag.join(" ")}`,
          `2. Check out the release tag in this checkout: ${plan.commands.checkout.join(" ")}`,
          `3. Install locked dependencies: ${plan.commands.install.join(" ")}`,
          `4. Run release checks: ${plan.commands.releaseCheck.join(" ")}`,
          "5. Review release notes and migration files, then apply remote D1 migrations intentionally.",
          `6. Run deploy checks: ${plan.commands.deployCheck.join(" ")}`,
          `7. Deploy intentionally: ${plan.commands.deploy.join(" ")}`,
          "Apply mode checks out the release tag locally and leaves deployment and migrations to the operator.",
          ""
        ]
      : []),
    plan.mutates
      ? plan.rehearses
        ? "Confirmed rehearsal: this run will fetch the tag, create a temporary worktree, run local checks there, and clean up unless --keep-worktree is set. It will not change the current checkout, deploy, apply remote migrations, or mutate Cloudflare resources."
        : plan.applies
          ? "Confirmed apply: this run will fetch the validated release tag and check it out in the current clean checkout. It will not install dependencies, deploy, apply remote migrations, store tokens, schedule checks, or mutate Cloudflare resources."
          : "Confirmed mode: this run will fetch the validated release tag only. It will not check out code, install dependencies, deploy, or apply migrations."
      : "Dry run: no git refs, files, deployments, migrations, or Cloudflare resources will be changed."
  );

  return `${lines.join("\n")}\n`;
}

export function usage() {
  return `Glyph manual update helper

Usage:
  pnpm run update:glyph
  pnpm run update:glyph -- --channel beta
  pnpm run update:glyph -- --source https://github.com/owner/repo
  pnpm run update:glyph -- --yes
  pnpm run update:glyph -- --rehearse
  pnpm run update:glyph -- --rehearse --yes
  pnpm run update:glyph -- --apply
  pnpm run update:glyph -- --apply --yes

Options:
  --source <url>      GitHub release source. Default: ${OFFICIAL_UPDATE_SOURCE_URL}.
  --channel <name>    stable uses latest release; beta uses newest release entry. Default: stable.
  --yes, -y           Fetch the validated release tag when an update is available and the tree is clean.
  --rehearse          Plan a temporary-worktree update rehearsal. With --yes, run it.
  --apply             Plan applying a newer release to this checkout. With --yes, fetch and check out the tag.
  --keep-worktree     Keep the rehearsal worktree for inspection. Only valid with --rehearse.
  --help, -h          Show this help.

By default this command only checks release metadata and prints an update plan. It does not
mutate files, check out code, install dependencies, deploy, apply migrations, store tokens, or
call the deployed admin UI.

Rehearsal mode also defaults to a dry-run plan. Rehearsal execution requires --rehearse --yes,
uses an isolated temporary git worktree, and does not change the current checkout.

Apply mode also defaults to a dry-run plan. Apply execution requires --apply --yes, a clean
working tree, and a newer release. It fetches and checks out the validated tag only; install,
release checks, remote migrations, and deployment remain explicit operator steps.
`;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  };
}

function comparePrerelease(candidate, current) {
  const candidateParts = candidate.split(".");
  const currentParts = current.split(".");
  const length = Math.max(candidateParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateParts[index];
    const currentPart = currentParts[index];
    if (candidatePart === undefined) {
      return -1;
    }
    if (currentPart === undefined) {
      return 1;
    }
    if (candidatePart === currentPart) {
      continue;
    }

    const candidateNumber = /^\d+$/u.test(candidatePart) ? Number(candidatePart) : null;
    const currentNumber = /^\d+$/u.test(currentPart) ? Number(currentPart) : null;
    if (candidateNumber !== null && currentNumber !== null) {
      return candidateNumber > currentNumber ? 1 : -1;
    }
    if (candidateNumber !== null) {
      return -1;
    }
    if (currentNumber !== null) {
      return 1;
    }
    return candidatePart > currentPart ? 1 : -1;
  }

  return 0;
}

function safePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]/g, "-");
}

function readPackageVersion(rootDir) {
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("package.json must define a non-empty version.");
  }

  return packageJson.version;
}

async function fetchLatestRelease(sourceUrl, channel) {
  const requestUrl = updateReleaseRequestUrl(sourceUrl, channel);
  if (requestUrl instanceof Error) {
    throw requestUrl;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Glyph local update helper"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(requestUrl, {
    headers
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed with HTTP ${response.status}.`);
  }

  const release = normalizeReleaseResponse(await response.json());
  if (!release) {
    throw new Error("Update source did not return release metadata.");
  }

  return release;
}

function isWorkingTreeClean(rootDir) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("Could not inspect git working tree.");
  }

  return result.stdout.trim().length === 0;
}

function runTagFetch(plan, rootDir) {
  const result = spawnSync(plan.commands.fetchTag[0], plan.commands.fetchTag.slice(1), {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Release tag fetch failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function runCommand(command, cwd, label) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function runUpdateRehearsal(plan, rootDir) {
  const baseWorktreePath = plan.commands.worktreeAdd.at(-2);
  const worktreePath = mkdtempSync(`${baseWorktreePath}-`);
  rmSync(worktreePath, { recursive: true, force: true });
  const rehearsalPlan = {
    ...plan,
    commands: {
      ...plan.commands,
      worktreeAdd: [...plan.commands.worktreeAdd.slice(0, -2), worktreePath, plan.release.tag],
      worktreeRemove: [...plan.commands.worktreeRemove.slice(0, -1), worktreePath]
    }
  };

  console.log(`\nStarting update rehearsal in ${worktreePath}`);
  let worktreeCreated = false;

  try {
    runCommand(rehearsalPlan.commands.fetchTag, rootDir, "Fetch release tag");
    runCommand(rehearsalPlan.commands.worktreeAdd, rootDir, "Create isolated worktree");
    worktreeCreated = true;
    runCommand(rehearsalPlan.commands.install, worktreePath, "Install locked dependencies in worktree");
    runCommand(rehearsalPlan.commands.releaseCheck, worktreePath, "Run release checks in worktree");

    const migrations = listMigrationFiles(worktreePath);
    console.log("\nTarget release migration files:");
    if (migrations.length === 0) {
      console.log("- None found.");
    } else {
      for (const migration of migrations) {
        console.log(`- ${migration}`);
      }
    }

    console.log("\nRehearsal complete. Review release notes and migration files before applying remote migrations or deploying.");
  } finally {
    if (plan.keepWorktree) {
      console.log(`\nKept rehearsal worktree: ${worktreePath}`);
      console.log(`Remove it later with: git worktree remove --force ${worktreePath}`);
    } else if (worktreeCreated) {
      const result = spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env
      });
      if (result.status !== 0) {
        console.warn(`Could not remove rehearsal worktree automatically. Remove it manually with: git worktree remove --force ${worktreePath}`);
        rmSync(worktreePath, { recursive: true, force: true });
      }
    } else {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

function runUpdateApply(plan, rootDir) {
  runCommand(plan.commands.fetchTag, rootDir, "Fetch release tag");
  runCommand(plan.commands.checkout, rootDir, "Check out release tag");
  console.log(`\nChecked out ${plan.release.tag}. Continue manually with install, release-check, migration review, deploy checks, and intentional deploy steps.`);
}

function listMigrationFiles(rootDir) {
  const migrationsDir = join(rootDir, "migrations");
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseUpdateArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const currentVersion = readPackageVersion(rootDir);
  const release = await fetchLatestRelease(options.source, options.channel);
  const cleanWorkingTree = isWorkingTreeClean(rootDir);
  const plan = buildUpdatePlan({ currentVersion, options, release, cleanWorkingTree });

  console.log(formatUpdatePlan(plan));

  if (options.yes) {
    if (options.rehearse) {
      if (!plan.mutates) {
        return plan.newer && !plan.cleanWorkingTree ? 1 : 0;
      }
      runUpdateRehearsal(plan, rootDir);
      return 0;
    }

    if (options.apply) {
      if (!plan.mutates) {
        return plan.newer && !plan.cleanWorkingTree ? 1 : 0;
      }
      runUpdateApply(plan, rootDir);
      return 0;
    }

    if (!plan.mutates) {
      return plan.newer && !plan.cleanWorkingTree ? 1 : 0;
    }
    runTagFetch(plan, rootDir);
    console.log(`\nFetched ${plan.release.tag}. Continue manually with the printed checkout, release-check, migration, and deploy steps.`);
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
