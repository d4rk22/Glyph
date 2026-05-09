#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OFFICIAL_UPDATE_SOURCE_URL = "https://github.com/d4rk22/Glyph";
export const DEFAULT_UPDATE_CHANNEL = "stable";

export function parseUpdateArgs(argv) {
  const options = {
    source: OFFICIAL_UPDATE_SOURCE_URL,
    channel: DEFAULT_UPDATE_CHANNEL,
    yes: false,
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
  const canFetchTag = Boolean(options.yes && newer && cleanWorkingTree);

  return {
    currentVersion,
    sourceUrl: source.repoUrl,
    channel: options.channel,
    release,
    comparison,
    newer,
    cleanWorkingTree,
    mutates: canFetchTag,
    warnings: [
      ...(comparison === null ? [`Could not compare ${release.tag} to ${currentVersion} as semver; treating different tags as potentially newer.`] : []),
      ...(!cleanWorkingTree && options.yes ? ["Working tree is not clean; refusing to fetch the update tag."] : []),
      ...(!newer && options.yes ? ["Latest release is not newer than the current package version; no tag fetch is needed."] : [])
    ],
    commands: {
      fetchTag: ["git", "fetch", source.gitUrl, "tag", release.tag],
      checkout: ["git", "checkout", release.tag],
      install: ["pnpm", "install", "--frozen-lockfile"],
      releaseCheck: ["pnpm", "run", "release:check"],
      deployCheck: ["pnpm", "run", "deploy:glyph", "--", "--check"],
      deploy: ["pnpm", "run", "deploy:glyph", "--", "--yes"]
    }
  };
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
    `Working tree clean: ${plan.cleanWorkingTree ? "yes" : "no"}`
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
    plan.mutates
      ? "Confirmed mode: this run will fetch the validated release tag only. It will not check out code, install dependencies, deploy, or apply migrations."
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

Options:
  --source <url>      GitHub release source. Default: ${OFFICIAL_UPDATE_SOURCE_URL}.
  --channel <name>    stable uses latest release; beta uses newest release entry. Default: stable.
  --yes, -y           Fetch the validated release tag when an update is available and the tree is clean.
  --help, -h          Show this help.

By default this command only checks release metadata and prints an update plan. It does not
mutate files, check out code, install dependencies, deploy, apply migrations, store tokens, or
call the deployed admin UI.
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

  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Glyph local update helper"
    }
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
