import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplySteps,
  buildRehearsalSteps,
  buildUpdatePlan,
  compareVersions,
  formatUpdatePlan,
  normalizeReleaseResponse,
  OFFICIAL_UPDATE_SOURCE_URL,
  parseGitHubSource,
  parseUpdateArgs,
  updateReleaseRequestUrl
} from "../scripts/update.mjs";

const release = {
  tag: "v0.2.0",
  name: "Glyph v0.2.0",
  body: "## Highlights - New update helper",
  publishedAt: "2026-05-09T12:00:00Z",
  url: "https://github.com/d4rk22/Glyph/releases/tag/v0.2.0"
};

test("manual update argument parser defaults to official source and dry run", () => {
  assert.deepEqual(parseUpdateArgs([]), {
    source: OFFICIAL_UPDATE_SOURCE_URL,
    channel: "stable",
    yes: false,
    rehearse: false,
    apply: false,
    keepWorktree: false,
    help: false
  });

  assert.deepEqual(parseUpdateArgs(["--source", "https://github.com/example/glyph", "--channel=beta", "--yes"]), {
    source: "https://github.com/example/glyph",
    channel: "beta",
    yes: true,
    rehearse: false,
    apply: false,
    keepWorktree: false,
    help: false
  });

  assert.equal(parseUpdateArgs(["--rehearse"]).rehearse, true);
  assert.equal(parseUpdateArgs(["--apply"]).apply, true);
  assert.equal(parseUpdateArgs(["--rehearse", "--keep-worktree"]).keepWorktree, true);
  assert.throws(() => parseUpdateArgs(["--source="]), /Update source cannot be empty/);
  assert.throws(() => parseUpdateArgs(["--channel", "nightly"]), /stable or beta/);
  assert.throws(() => parseUpdateArgs(["--source"]), /requires a value/);
  assert.throws(() => parseUpdateArgs(["--keep-worktree"]), /only with --rehearse/);
  assert.throws(() => parseUpdateArgs(["--apply", "--rehearse"]), /separate workflows/);
});

test("manual update helper accepts only GitHub release sources", () => {
  assert.deepEqual(parseGitHubSource("https://github.com/d4rk22/Glyph"), {
    owner: "d4rk22",
    repo: "Glyph",
    repoUrl: "https://github.com/d4rk22/Glyph",
    gitUrl: "https://github.com/d4rk22/Glyph.git"
  });

  assert.deepEqual(parseGitHubSource("https://github.com/d4rk22/Glyph.git"), {
    owner: "d4rk22",
    repo: "Glyph",
    repoUrl: "https://github.com/d4rk22/Glyph",
    gitUrl: "https://github.com/d4rk22/Glyph.git"
  });

  assert.match(String(parseGitHubSource("https://example.com/d4rk22/Glyph")), /Only https:\/\/github\.com/);
});

test("manual update helper builds stable and beta release API URLs", () => {
  assert.equal(
    updateReleaseRequestUrl("https://github.com/d4rk22/Glyph", "stable"),
    "https://api.github.com/repos/d4rk22/Glyph/releases/latest"
  );
  assert.equal(
    updateReleaseRequestUrl("https://github.com/d4rk22/Glyph", "beta"),
    "https://api.github.com/repos/d4rk22/Glyph/releases?per_page=1"
  );
});

test("manual update helper normalizes release metadata and notes", () => {
  const parsed = normalizeReleaseResponse({
    tag_name: " v0.2.0 ",
    name: " Glyph v0.2.0 ",
    body: "## Highlights\n\n- New update helper",
    published_at: "2026-05-09T12:00:00Z",
    html_url: "https://github.com/d4rk22/Glyph/releases/tag/v0.2.0"
  });

  assert.deepEqual(parsed, release);
  assert.equal(normalizeReleaseResponse([{ tag_name: "v0.3.0" }])?.tag, "v0.3.0");
  assert.equal(normalizeReleaseResponse({ name: "No tag" }), null);
});

test("manual update helper compares semver-like tags", () => {
  assert.equal(compareVersions("v0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("v0.0.9", "0.1.0"), -1);
  assert.equal(compareVersions("v1.0.0-beta.2", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("release-2026", "0.1.0"), null);
});

test("manual update plan is non-mutating by default", () => {
  const plan = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs([]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(plan.newer, true);
  assert.equal(plan.mutates, false);
  assert.equal(plan.rehearses, false);
  assert.deepEqual(plan.commands.fetchTag, ["git", "fetch", "https://github.com/d4rk22/Glyph.git", "tag", "v0.2.0"]);
  assert.match(formatUpdatePlan(plan), /Dry run: no git refs, files, deployments, migrations, or Cloudflare resources will be changed/);
});

test("manual update plan only fetches a tag with confirmation and clean tree", () => {
  const confirmed = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--yes"]),
    release,
    cleanWorkingTree: true
  });
  assert.equal(confirmed.mutates, true);
  assert.match(formatUpdatePlan(confirmed), /will fetch the validated release tag only/);

  const dirty = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--yes"]),
    release,
    cleanWorkingTree: false
  });
  assert.equal(dirty.mutates, false);
  assert.match(dirty.warnings.join("\n"), /Working tree is not clean/);

  const current = buildUpdatePlan({
    currentVersion: "0.2.0",
    options: parseUpdateArgs(["--yes"]),
    release,
    cleanWorkingTree: true
  });
  assert.equal(current.mutates, false);
  assert.equal(current.newer, false);
});

test("manual update rehearsal is a dry-run plan unless confirmed", () => {
  const dryRun = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--rehearse"]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(dryRun.rehearses, true);
  assert.equal(dryRun.mutates, false);
  assert.deepEqual(dryRun.commands.worktreeAdd, ["git", "worktree", "add", "--detach", "/tmp/glyph-update-v0.2.0", "v0.2.0"]);
  assert.deepEqual(dryRun.commands.worktreeRemove, ["git", "worktree", "remove", "--force", "/tmp/glyph-update-v0.2.0"]);
  assert.match(formatUpdatePlan(dryRun), /Update rehearsal:/);
  assert.match(formatUpdatePlan(dryRun), /Dry run: no git refs, files, deployments, migrations, or Cloudflare resources will be changed/);
});

test("manual update apply mode is a dry-run plan unless confirmed", () => {
  const dryRun = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--apply"]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(dryRun.applies, true);
  assert.equal(dryRun.mutates, false);
  assert.match(formatUpdatePlan(dryRun), /Apply mode:/);
  assert.match(formatUpdatePlan(dryRun), /Check out the release tag in this checkout/);
  assert.match(formatUpdatePlan(dryRun), /Dry run: no git refs, files, deployments, migrations, or Cloudflare resources will be changed/);
});

test("manual update apply mode requires confirmation clean tree and newer release", () => {
  const confirmed = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--apply", "--yes"]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(confirmed.mutates, true);
  assert.match(formatUpdatePlan(confirmed), /Confirmed apply/);
  assert.match(formatUpdatePlan(confirmed), /fetch the validated release tag and check it out/);
  assert.match(formatUpdatePlan(confirmed), /will not install dependencies, deploy, apply remote migrations/);

  const dirty = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--apply", "--yes"]),
    release,
    cleanWorkingTree: false
  });

  assert.equal(dirty.mutates, false);
  assert.match(dirty.warnings.join("\n"), /refusing to apply the update to the current checkout/);

  const current = buildUpdatePlan({
    currentVersion: "0.2.0",
    options: parseUpdateArgs(["--apply", "--yes"]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(current.mutates, false);
  assert.equal(current.newer, false);
  assert.match(current.warnings.join("\n"), /no apply is needed/);
});

test("manual update apply steps include checkout and post-apply guidance", () => {
  const plan = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--apply", "--yes"]),
    release,
    cleanWorkingTree: true
  });
  const steps = buildApplySteps(plan);

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Fetch release tag",
      "Check out release tag",
      "Install locked dependencies",
      "Run release checks",
      "Review and apply remote D1 migrations intentionally",
      "Run deploy checks",
      "Deploy intentionally"
    ]
  );
  assert.equal(steps[1]?.command?.join(" "), "git checkout v0.2.0");
  assert.equal(steps[4]?.command, null);
  assert.match(formatUpdatePlan(plan), /pnpm install --frozen-lockfile/);
  assert.match(formatUpdatePlan(plan), /pnpm run release:check/);
  assert.match(formatUpdatePlan(plan), /Review release notes and migration files/);
});

test("manual update rehearsal requires confirmation and a clean tree", () => {
  const confirmed = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--rehearse", "--yes"]),
    release,
    cleanWorkingTree: true
  });

  assert.equal(confirmed.mutates, true);
  assert.match(formatUpdatePlan(confirmed), /Confirmed rehearsal/);
  assert.match(formatUpdatePlan(confirmed), /It will not change the current checkout/);

  const dirty = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--rehearse", "--yes"]),
    release,
    cleanWorkingTree: false
  });

  assert.equal(dirty.mutates, false);
  assert.match(dirty.warnings.join("\n"), /refusing to create an update rehearsal worktree/);
});

test("manual update rehearsal steps include isolated worktree checks and cleanup guidance", () => {
  const plan = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--rehearse", "--yes"]),
    release,
    cleanWorkingTree: true
  });
  const steps = buildRehearsalSteps(plan);

  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Fetch release tag",
      "Create isolated worktree",
      "Install locked dependencies in worktree",
      "Run release checks in worktree",
      "Summarize target migrations",
      "Remove rehearsal worktree"
    ]
  );
  assert.equal(steps.at(-1)?.command?.join(" "), "git worktree remove --force /tmp/glyph-update-v0.2.0");

  const keepPlan = buildUpdatePlan({
    currentVersion: "0.1.0",
    options: parseUpdateArgs(["--rehearse", "--yes", "--keep-worktree"]),
    release,
    cleanWorkingTree: true
  });
  assert.equal(buildRehearsalSteps(keepPlan).some((step) => step.label === "Remove rehearsal worktree"), false);
  assert.match(formatUpdatePlan(keepPlan), /Keep the rehearsal worktree for inspection/);
});
