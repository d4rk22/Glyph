# Glyph

Glyph is a private-use, Cloudflare-first file sharing app. The MVP target is anonymous uploads, R2-backed file storage, D1-backed metadata, random short download links, and a passkey-protected admin panel.

Glyph is licensed under the MIT License. It is source-available for self-hosting and public review, but the package is marked private to avoid accidental npm publication.

## Current Status

Phase 1 scaffold is in place:

- TypeScript Cloudflare Worker entrypoint.
- `pnpm` project metadata and scripts.
- Wrangler configuration with D1 and R2 bindings.
- Initial D1 migration for uploads, passkey credentials, admin users, and sessions.
- Minimal placeholder UI for `/`, `/admin`, `/health`, and not-found responses.

Phase 2 metadata helpers are also in place:

- Upload metadata creation, lookup, listing, soft deletion, and hard deletion.
- Short ID generation with retry handling for upload ID collisions.
- Admin user creation, lookup, and login timestamp helpers.
- WebAuthn credential creation, lookup, listing, usage update, and deletion.
- Admin session creation, token hashing, active lookup, and revocation.

Phase 3 upload/download flow is in place:

- `/` renders an anonymous multipart upload form.
- `POST /` stores file bytes in R2 and metadata in D1.
- Successful uploads return a short unlisted URL.
- `/{id}` streams active uploads back with original filename and content type.
- Missing, deleted, or unavailable uploads return the polished not-found response.

Phase 4 UI polish is in place:

- Upload, success, admin placeholder, and not-found pages use a cleaner responsive app surface.
- Upload errors are presented inline with stronger visual treatment.
- Success pages expose the short URL, file name, size, and direct download action.

Phase 5 admin authentication is in place:

- `/admin` bootstraps the first admin passkey when no admin exists.
- Existing admins sign in with their registered passkey.
- Admin sessions are stored in D1 and scoped to `/admin` with HTTP-only cookies.

Phase 6 protected admin file management is in place:

- `/admin` lists uploads after passkey login.
- The admin panel shows filename, short URL, size, content type, creation/deletion state, IDs, and object keys.
- Admins can open/copy short links and delete uploads.
- Delete requests ask R2 to remove the object and mark the D1 metadata row deleted.

Phase 7 test and documentation hardening is in place:

- Route-level tests cover protected admin access, upload listing rendering, same-origin delete protection, delete notices, and deleted short-link responses.
- This README now documents the MVP setup, bindings, migrations, passkey flow, admin file management, deployment, dependency policy, and limitations.

Phase 8 final MVP verification is complete:

- `pnpm install --frozen-lockfile`, typecheck, tests, local D1 migration checks, and Wrangler dry-run have been verified.
- Local smoke checks cover the upload page, anonymous upload, short-link download, missing/deleted not-found pages, admin login surface, admin file listing, and admin deletion.
- Remaining MVP risks and limitations are documented below.

Phase 9 v2 foundation is in place:

- `GOAL.md` now preserves the completed MVP goal and adds the post-MVP v2 roadmap.
- D1 schema groundwork exists for upload expiration, upload modes, storage state, and app settings.
- Typed D1 helpers cover app settings, expiration metadata, uploads due for expiration, and storage usage aggregates.

Phase 10 manual expiring links are in place:

- Admins can set, update, clear, and view per-upload expiration timestamps from `/admin`.
- Public short links return the polished not-found page when `expires_at` is in the past or `expired_at` is set.
- Clearing expiration also clears the expired marker so an upload can become active again if it has not been deleted.

Phase 11 usage dashboard is in place:

- `/admin` shows active, expired, deleted, and total upload counts and file-size summaries.
- Usage accounting treats past `expires_at` timestamps as expired even before a public link is revisited.
- The v2 roadmap now includes a future self-update system phase after one-command deploy and before custom-domain automation.

Phase 12 simple storage cap enforcement is in place:

- Admins can view, set, update, and clear a storage cap in bytes from `/admin`.
- Storage-cap enforcement runs after successful uploads and after admin cap updates.
- When active stored bytes exceed the cap, Glyph expires the oldest active uploads first and asks R2 to delete those objects best-effort.
- Enforcement stays request-driven for now; there are no scheduled Workers, queues, or retry systems.

Phase 13 R2 deletion retry and cleanup is in place:

- Upload metadata tracks R2 deletion requested, completed, failed, and error state.
- Admin deletion and storage-cap auto-expiration record R2 cleanup state around object deletion attempts.
- `/admin` shows R2 cleanup counts and provides a protected same-origin retry action for expired/deleted uploads whose R2 cleanup is not complete.
- Cleanup remains request-driven; scheduled Workers, queues, and cron triggers are still deferred.

Phase 14 direct-to-R2 single-part uploads are in place:

- Worker-mediated uploads remain the default and fallback upload path.
- Admins can switch upload mode between Worker-mediated and direct-to-R2 from `/admin`.
- Direct uploads create pending D1 metadata, issue a short-lived presigned R2 PUT URL, and finalize through the Worker before the short link becomes active.
- Pending or failed direct uploads are not downloadable from public short links.

Phase 15 multipart direct-to-R2 uploads are in place:

- Admins can switch upload mode between Worker-mediated, direct-to-R2, and multipart direct-to-R2 from `/admin`.
- Multipart uploads create pending D1 metadata, initiate R2 multipart upload state through the Worker, authorize each part with short-lived presigned URLs, and finalize through the Worker before the short link becomes active.
- Pending, failed, incomplete, or aborted multipart uploads are not downloadable from public short links.
- The browser upload flow shows client-side progress and estimated time remaining for direct upload modes. Multipart progress is based on completed parts and file size.
- Worker-mediated uploads and direct single-part uploads remain available as fallback paths.

Phase 16 one-command deploy workflow is in place:

- `pnpm run deploy:glyph -- --check` validates project prerequisites, runs typecheck/tests, checks remote D1 migrations, and performs a Wrangler dry-run.
- `pnpm run deploy:glyph -- --yes` runs the same checks, applies remote D1 migrations, performs a Wrangler dry-run, and deploys the Worker.
- The first version assumes the Cloudflare account, Wrangler auth, D1 database, R2 bucket, bindings, secrets, and bucket CORS are already configured.

Phase 17 self-update groundwork is in place:

- `/admin` shows the deployed Glyph version, update source, update channel, and automatic update opt-in state.
- Admins can save a future public GitHub update source, choose `stable` or `beta`, and opt in to automatic updates as a stored setting.
- Admins can manually check a configured GitHub release source for newer release metadata.
- Update checks are read-only; they do not deploy, apply migrations, restart the Worker, or mutate code.

Phase 18 simple custom-domain deployment support is in place:

- The deploy helper validates that `PUBLIC_BASE_URL`, when configured, is an origin-only `https://` URL.
- The deploy helper reports the configured public base URL and Wrangler route hosts during deploy checks.
- Wrangler route/custom-domain mismatches are surfaced as warnings so manual Cloudflare setup can be corrected before rollout.
- Custom-domain support remains conservative; Glyph does not create DNS records, certificates, zones, routes, or custom domains through the Cloudflare API yet.

Phase 19 guided Cloudflare setup is in place:

- `pnpm run deploy:glyph -- --setup` prints a safe setup plan without changing Cloudflare resources.
- `pnpm run deploy:glyph -- --setup --yes` runs only the explicit D1 database and R2 bucket create commands.
- Setup output explains the required manual follow-up: copy the D1 `database_id`, configure secrets, configure R2 CORS, and run a deploy readiness check.
- Setup remains conservative; it does not write secrets, edit DNS, create custom domains, configure CORS automatically, or update source-controlled Wrangler config.

Phase 20 release/versioning groundwork is in place:

- The deployed Glyph version shown in `/admin` is read from the package version through `src/version.ts`.
- `pnpm run release:check` validates the version source and runs non-publishing release checks.
- Release documentation now describes version bumps, GitHub release notes, migration expectations, and manual update expectations.
- Release checks remain local and conservative; they do not publish releases, deploy, apply remote migrations, or mutate Cloudflare resources.

Phase 21 manual self-update workflow is in place:

- `/admin` update checks display GitHub release tag, name, release notes summary, published date, release URL, and update status.
- Version comparison is semver-aware for semver-like tags while staying dependency-free.
- The update result page includes a manual operator checklist for reviewing release notes, pulling a tag locally, running release checks, applying migrations intentionally, and deploying through the deploy helper.
- Admin update checks remain read-only; they do not deploy, apply migrations, restart the Worker, mutate code, store GitHub tokens, or run automatic updates.

Phase 22 public repository readiness is in place:

- Public-readiness audit found no committed real secrets, tokens, real Cloudflare account identifiers, or private deployment details in tracked files.
- MIT license metadata and `LICENSE` are present.
- `.env.example` and `.dev.vars.example` document optional configuration with placeholders only.
- `SECURITY.md` and `CONTRIBUTING.md` document security reporting, secret handling, and contribution expectations.

Phase 23 public release/update channel is in place:

- The official public update source is `https://github.com/d4rk22/Glyph`.
- `/admin` suggests that source when no update source is configured, while keeping the stored default blank for forks and private deployments.
- Public releases use `vMAJOR.MINOR.PATCH` tags, starting with `v0.1.0`.
- GitHub releases are the release/update channel for the manual self-update workflow.

Phase 24 local manual self-update helper is in place:

- `pnpm run update:glyph` checks the official GitHub release channel and prints a local update plan without changing files, git refs, deployments, migrations, or Cloudflare resources.
- `--source` and `--channel` let forks or private deployments check their own GitHub release source.
- `--yes` is intentionally narrow: when an update is available and the working tree is clean, it fetches the validated release tag only, then leaves checkout, install, release checks, migrations, and deploy as explicit operator steps.

Phase 25 first maintenance release is in place:

- The package-backed Glyph version is `0.1.1`.
- `v0.1.1` is the first maintenance release intended to prove the public GitHub release channel and local manual update flow.
- The release remains source-only; no npm package, Worker deploy, remote migration, or Cloudflare resource mutation is part of the release process.

Phase 26 local update rehearsal is in place:

- `pnpm run update:glyph -- --rehearse` prints an isolated temporary-worktree rehearsal plan without changing the current checkout.
- `pnpm run update:glyph -- --rehearse --yes` can fetch the validated release tag, create a temporary detached worktree, run install and release checks there, summarize target migration files, and clean up the worktree.
- Rehearsal mode still does not deploy, apply remote migrations, publish packages, execute updates from admin, store GitHub tokens, or mutate Cloudflare resources.

Phase 27 update rehearsal maintenance release is in place:

- The package-backed Glyph version is `0.1.2`.
- `v0.1.2` publishes the local update rehearsal workflow through the public GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, token storage, scheduled check, or Cloudflare mutation is part of the release process.

Phase 28 admin-facing update rehearsal guidance is in place:

- Protected `/admin` update checks now point operators toward `pnpm run update:glyph -- --rehearse` before any manual update work.
- Update result pages recommend `pnpm run update:glyph -- --rehearse --yes` only from a clean local checkout when the operator is ready to validate the release in a temporary worktree.
- Admin update checks remain read-only; they do not execute local commands, deploy, apply migrations, store tokens, schedule checks, or mutate Cloudflare resources.

Phase 29 admin update rehearsal guidance maintenance release is in place:

- The package-backed Glyph version is `0.1.3`.
- `v0.1.3` publishes the protected admin update-check guidance through the public GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, token storage, scheduled check, or Cloudflare mutation is part of the release process.

Phase 30 public repository issue and support templates are in place:

- GitHub issue templates now cover bug reports, feature requests, deployment/setup support, and security-report redirection.
- Templates remind users not to post secrets, real Cloudflare account IDs, API tokens, sensitive private domains, passkey data, R2 object keys, private file details, or private deployment logs.
- Public support is best-effort community support only; Glyph is not a hosted service and does not provide an SLA, billing support, or guaranteed compatibility with every Cloudflare account configuration.

Phase 31 public support templates maintenance release is in place:

- The package-backed Glyph version is `0.1.4`.
- `v0.1.4` publishes the public issue/support templates through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, token storage, scheduled check, or Cloudflare mutation is part of the release process.

Phase 32 conservative local manual update apply mode is in place:

- `pnpm run update:glyph -- --apply` prints a local source-update plan without changing the checkout.
- `pnpm run update:glyph -- --apply --yes` requires a clean working tree and a newer validated release, then fetches and checks out the release tag.
- Apply mode stays local-only; it does not install dependencies, deploy, apply remote migrations, store tokens, schedule checks, run from admin, or mutate Cloudflare resources.

Phase 33 update apply-mode maintenance release is in place:

- The package-backed Glyph version is `0.1.5`.
- `v0.1.5` publishes the local manual update apply workflow through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, token storage, scheduled check, or Cloudflare mutation is part of the release process.

Phase 34 admin-facing update apply guidance is in place:

- Protected `/admin` update checks now show the local apply workflow alongside release metadata and rehearsal guidance.
- Update result pages recommend `pnpm run update:glyph -- --apply` to review the local apply plan and `pnpm run update:glyph -- --apply --yes` only from a clean local checkout when ready.
- Admin update checks remain read-only; they do not execute local commands, check out code, deploy, apply migrations, store tokens, schedule checks, or mutate Cloudflare resources.

Phase 35 admin update apply-guidance maintenance release is in place:

- The package-backed Glyph version is `0.1.6`.
- `v0.1.6` publishes the protected admin update-check apply guidance through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, token storage, scheduled check, or Cloudflare mutation is part of the release process.

Phase 36 read-only scheduled update check groundwork is in place:

- Update checks now persist a read-only D1 snapshot with last checked time, latest release tag/name/URL, published date, update availability, and last error.
- `/admin` shows the last stored update-check result alongside the existing manual update guidance.
- An optional Scheduled Worker handler can perform the same read-only GitHub release metadata check when update checks are explicitly enabled and an update source is configured.
- Scheduled checks only notice releases; they do not deploy, apply migrations, check out code, mutate source, store GitHub tokens, execute local update helpers, or mutate Cloudflare resources.

Phase 37 read-only scheduled update-check maintenance release is in place:

- The package-backed Glyph version is `0.1.7`.
- `v0.1.7` publishes the D1-backed update-check result storage, protected admin last-check display, and optional read-only Scheduled Worker handler through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, trigger creation, token storage, or Cloudflare mutation is part of the release process.

Phase 38 scheduled update-check configuration guidance is in place:

- The `/admin` self-update panel now labels the opt-in setting as read-only scheduled update checks instead of executable automatic updates.
- Admin guidance explains that scheduled checks stay inert unless the operator configures a Cloudflare Scheduled Worker trigger and enables the setting in Glyph.
- The panel states that scheduled checks only fetch public GitHub release metadata and persist the read-only result in D1.
- Scheduled checks still never deploy, apply migrations, check out code, mutate source, store GitHub tokens, execute local update helpers, create Cloudflare triggers, or mutate Cloudflare resources.

Phase 39 scheduled update-check guidance maintenance release is in place:

- The package-backed Glyph version is `0.1.8`.
- `v0.1.8` publishes the clarified admin scheduled-check guidance through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, trigger creation, token storage, or Cloudflare mutation is part of the release process.

Phase 40 scheduled update-check deploy readiness is in place:

- `pnpm run deploy:glyph -- --check` and `pnpm run deploy:glyph -- --setup` report whether Wrangler cron triggers for optional read-only scheduled update checks are configured.
- Readiness output explains that scheduled checks require both an operator-owned Cloudflare Scheduled Worker trigger and `/admin` read-only scheduled checks with a valid update source.
- The deploy helper never creates scheduled triggers or mutates Cloudflare resources for scheduled checks.
- Scheduled checks remain D1-only release metadata notices; they never deploy, apply migrations, check out code, mutate source, store GitHub tokens, execute local update helpers, or mutate Cloudflare resources.

Phase 41 scheduled update-check deploy-readiness maintenance release is in place:

- The package-backed Glyph version is `0.1.9`.
- `v0.1.9` publishes the deploy/setup helper cron-trigger readiness reporting through the GitHub release channel.
- The release remains source-only; no npm package, Worker deploy, remote migration, admin-executed update, trigger creation, token storage, scheduled trigger automation, or Cloudflare mutation is part of the release process.

## Prerequisites

- Node.js 22 or newer.
- `pnpm` 11. The project declares `packageManager` in `package.json`.
- A Cloudflare account with Workers, R2, and D1 access.
- A browser and platform that support passkeys/WebAuthn for admin setup and login.

## Install

```sh
pnpm install
```

The committed `pnpm-lock.yaml` is the source of truth for dependency resolution.

## Cloudflare Resources

Preview the guided Cloudflare setup plan:

```sh
pnpm run deploy:glyph -- --setup
```

When you are ready to create the basic resources, run:

```sh
pnpm run deploy:glyph -- --setup --yes
```

That command runs:

- `pnpm wrangler d1 create glyph`
- `pnpm wrangler r2 bucket create glyph-files`

Use `--database <name>` or `--bucket <name>` with `--setup` if your instance should use different names. If the resources already exist, skip `--setup --yes` and use the plan as a checklist. Copy the D1 `database_id` returned by Wrangler into `wrangler.jsonc`, replacing the placeholder `00000000-0000-0000-0000-000000000000`.

The Worker expects these bindings:

- `DB`: D1 database named `glyph`.
- `FILES`: R2 bucket named `glyph-files`.
- `APP_ENV`: environment label used by `/health`.
- `PUBLIC_BASE_URL`: optional environment variable for generated short links. If unset, Glyph uses the request origin.
- `R2_ACCOUNT_ID`: optional Cloudflare account ID for direct-to-R2 presigned uploads.
- `R2_ACCESS_KEY_ID`: optional R2 S3-compatible access key ID for direct-to-R2 presigned uploads.
- `R2_SECRET_ACCESS_KEY`: optional R2 S3-compatible secret access key for direct-to-R2 presigned uploads. Store this as a Wrangler secret.
- `R2_BUCKET_NAME`: optional R2 bucket name for presigned URLs. Defaults to `glyph-files`.

See `.env.example` and `.dev.vars.example` for placeholder-only configuration examples. Do not commit real values. `.dev.vars` and `.wrangler/` are ignored by git.

Direct-to-R2 and multipart direct-to-R2 uploads require the R2 S3-compatible credentials above and bucket CORS that permits browser `PUT` requests from the Glyph origin. Multipart mode also requires CORS to expose the `ETag` response header so the browser can report completed part ETags back to the Worker for finalization. Without the credential values, Glyph keeps using the Worker-mediated upload form even if the saved upload mode is direct or multipart.

For a custom domain, configure Cloudflare so the Worker is reachable at the desired `https://` origin, then set `vars.PUBLIC_BASE_URL` in `wrangler.jsonc` to that exact origin, for example `https://files.example.com`. Keep it origin-only: no path, query string, or fragment. Generated short links use this value, and passkeys registered for `/admin` are bound to that origin. If direct-to-R2 or multipart uploads are enabled, the R2 bucket CORS allowed origin must match the deployed Glyph origin.

## Migrations

Migrations live in `migrations/` and create D1 tables for uploads, admin users, passkey credentials, admin sessions, WebAuthn challenges, and app settings. Later migrations add upload lifecycle fields for expiration, upload modes, storage accounting, R2 deletion cleanup state, direct upload finalization state, and multipart upload state.

Apply migrations locally:

```sh
pnpm run db:migrate:local
```

Apply migrations remotely:

```sh
pnpm run db:migrate:remote
```

## Local Development

Apply local migrations first, then start Wrangler:

```sh
pnpm run dev
```

Then open the local URL printed by Wrangler.

Useful local paths:

- `/`: anonymous upload form.
- `/{id}`: short-link download for an active upload.
- `/admin`: passkey bootstrap, login, and protected file management.
- `/health`: JSON health check.

The first visit to `/admin` bootstraps the first and only MVP admin passkey when no admin user exists. After bootstrap, `/admin` requires that passkey and creates an HTTP-only session cookie scoped to `/admin`.

For local passkey testing, use a browser on the local Wrangler origin. Passkeys are origin-bound, so credentials registered on one host, scheme, or port are not portable to another.

## Admin File Management

The protected admin panel lists the 100 most recent uploads, including active and deleted rows. Each upload card shows:

- Usage totals for active, expired, deleted, and total uploads.
- Current storage cap, active usage, and remaining capacity.
- Current upload mode and direct-upload credential availability.
- R2 cleanup pending, failed, and completed counts.
- Original filename.
- Short URL with an in-browser copy button.
- Size and content type.
- Expiration state, expiration timestamp, and expired timestamp when present.
- Created timestamp and deleted timestamp, when present.
- Short ID and R2 object key.

Deleting an upload marks the D1 metadata row with `deleted_at`, then asks R2 to remove the stored object and records the cleanup result. Deleted short links return the same polished not-found response as missing links. If the R2 delete request fails, Glyph still keeps the metadata deleted so the public link is unavailable.

Admins can set or clear a manual expiration for active uploads. Expiration timestamps are stored as UTC. Expired short links return the not-found response, but the metadata remains visible in the admin panel.

Admins can also set or clear a storage cap in bytes. When active stored bytes exceed that cap after an upload or cap update, Glyph marks the oldest active uploads expired until active usage is at or below the cap, and requests best-effort R2 object deletion for those expired uploads. This is intentionally simple request-time enforcement; scheduled cleanup, retry queues, and richer policy controls are deferred.

The R2 cleanup panel can retry object deletion for expired or deleted uploads whose cleanup has not completed. The retry action is protected by the admin session and same-origin checks. Cleanup state never controls public link availability; D1 deletion and expiration metadata do.

Once R2 cleanup is marked complete for an expired upload, its expiration cannot be cleared from the admin UI because the file bytes have already been removed.

When direct-to-R2 mode is enabled and configured, anonymous uploads use a short-lived presigned R2 PUT URL. The Worker still creates pending metadata first and finalizes the upload after the object appears in R2 with the expected size. The public short link is unavailable until finalization marks the metadata stored.

When multipart direct-to-R2 mode is enabled and configured, files at or above the conservative multipart threshold use R2 multipart upload. The Worker creates pending metadata, initiates the R2 multipart upload, signs individual part uploads, completes the multipart upload after all expected parts are reported, verifies the final object size where practical, and only then marks the short link stored. Smaller files in multipart mode continue through the direct single-part path. Failed or aborted multipart uploads are marked unavailable in D1. The normal Worker-mediated `POST /` path remains available as a fallback.

The self-update panel is groundwork for a future public repository workflow. It stores update settings and the latest read-only update-check result in D1, displays the current deployed Glyph version, and can check GitHub release metadata from a configured public repo. Manual checks persist the last checked time, latest release tag/name/URL, published date, update availability, and last check error for display in `/admin`. The manual check is intentionally read-only. It displays release metadata and a manual update checklist, but it does not reuse the deploy helper from admin except as the documented future path for applying migrations, running verification, and deploying safely.

Glyph also exports a Scheduled Worker handler for read-only update checks. It is inert by default because `wrangler.jsonc` does not configure a trigger and the handler exits unless read-only scheduled update checks are enabled in settings and an update source URL is configured. Operators who want periodic notices can add a Cloudflare Scheduled Worker trigger in their deployment configuration, configure an update source in `/admin`, and enable read-only scheduled update checks from the self-update panel. This only fetches public GitHub release metadata and records the result in D1. Rehearsal, apply, migrations, deploy checks, and deployment remain local/operator-controlled.

The recommended manual update workflow is:

- Review release notes and migration notes in `/admin`.
- Pull the selected release or tag locally.
- Run `pnpm install --frozen-lockfile`.
- Run `pnpm run release:check`.
- Apply remote migrations intentionally.
- Run `pnpm run deploy:glyph -- --check`.
- Deploy with `pnpm run deploy:glyph -- --yes`.

## Release Checks

Glyph uses `package.json` as the release version source. The Worker imports that value through `src/version.ts`, and `/admin` displays it as the deployed Glyph version. Future self-update checks should compare this deployed version against the selected GitHub release tag after trimming a leading `v`.

The official public update source is:

```text
https://github.com/d4rk22/Glyph
```

Use `stable` to check GitHub's latest release and `beta` to check the newest release entry. Forks and private deployments can leave the source blank or point it at their own public GitHub release source.

Before tagging a release, update `package.json` with the next semver version and prepare GitHub release notes that call out:

- User-visible changes.
- New migrations and whether they are required before deploy.
- Deployment or setup changes.
- New secrets, bindings, CORS, or custom-domain expectations.
- Known limitations or rollback notes.

Release tags should use `vMAJOR.MINOR.PATCH`, for example `v0.1.3`. Release titles should name the version, and release notes should include these sections when relevant:

- Highlights.
- Migrations.
- Deployment notes.
- Manual update steps.
- Known limitations.

Run the local release checklist:

```sh
pnpm run release:check
```

The release check validates the package-backed version source, runs typecheck and tests, performs a Wrangler deploy dry-run, and checks local D1 migrations. Use `--skip-d1` only when local Wrangler D1 is unavailable and the migration status has been checked another way. The command does not publish GitHub releases, deploy the Worker, apply remote migrations, make the repository public, or mutate Cloudflare resources.

## Local Manual Updates

Check the public release channel and print an update plan:

```sh
pnpm run update:glyph
```

Use a fork or beta-style release channel:

```sh
pnpm run update:glyph -- --source https://github.com/owner/repo --channel beta
```

The default source is `https://github.com/d4rk22/Glyph`, and the default channel is `stable`. `stable` checks GitHub's latest release endpoint; `beta` checks the newest release entry.

By default, the helper is a dry run. It compares the current `package.json` version to the selected GitHub release, prints the release tag, URL, notes summary, published date, update status, and a manual operator workflow. It does not mutate files, fetch tags, check out code, install dependencies, deploy, apply migrations, store GitHub tokens, or call the deployed admin UI.

The helper can use a read-only `GITHUB_TOKEN` or `GH_TOKEN` environment variable for GitHub release metadata if unauthenticated API rate limits are reached. Tokens are read from the process environment only; Glyph does not store them.

When you want the helper to perform its only mutating action, run:

```sh
pnpm run update:glyph -- --yes
```

Confirmed mode refuses to continue unless the working tree is clean and the selected release is newer. When those checks pass, it fetches the validated release tag only. Continue manually by checking out the tag, running `pnpm install --frozen-lockfile`, `pnpm run release:check`, applying remote D1 migrations intentionally, running `pnpm run deploy:glyph -- --check`, and deploying with `pnpm run deploy:glyph -- --yes`.

Rehearse an update without touching the current checkout:

```sh
pnpm run update:glyph -- --rehearse
```

The rehearsal dry run prints the tag fetch, temporary worktree, install, release-check, migration summary, and cleanup plan. To execute that local rehearsal, run:

```sh
pnpm run update:glyph -- --rehearse --yes
```

Confirmed rehearsal mode requires a clean working tree and a newer selected release. It fetches the validated release tag, creates an isolated detached git worktree under `/tmp`, runs `pnpm install --frozen-lockfile` and `pnpm run release:check` inside that worktree, lists the target release's `migrations/*.sql` files, and removes the temporary worktree by default. Add `--keep-worktree` to keep the worktree for inspection; the helper prints the cleanup command.

The rehearsal workflow prepares future opt-in automatic updates by proving that release checks can run away from the active checkout. It still does not check out code in the current tree, deploy Workers, apply remote migrations, publish npm packages, execute updates from admin, store GitHub tokens, schedule checks, or mutate Cloudflare resources.

After rehearsing and reviewing a newer release, print the local apply plan:

```sh
pnpm run update:glyph -- --apply
```

To apply the source update to the current checkout, run:

```sh
pnpm run update:glyph -- --apply --yes
```

Confirmed apply mode refuses to continue unless the working tree is clean and the selected release is newer. When those checks pass, it fetches the validated release tag and checks out that tag in the current checkout. It does not install dependencies, deploy Workers, apply remote migrations, publish packages, execute from admin, store GitHub tokens, schedule checks, or mutate Cloudflare resources. After apply mode, run `pnpm install --frozen-lockfile`, `pnpm run release:check`, review and apply remote D1 migrations intentionally, run `pnpm run deploy:glyph -- --check`, and deploy intentionally with `pnpm run deploy:glyph -- --yes`.

The protected `/admin` update-check result page mirrors this local workflow. It can display release metadata and recommended commands for rehearsal and apply mode, including `pnpm run update:glyph -- --apply` and `pnpm run update:glyph -- --apply --yes`, but it remains read-only and never runs local update helpers from the Worker.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run release:check
pnpm run update:glyph
pnpm run update:glyph -- --rehearse
pnpm wrangler deploy --dry-run --outdir /tmp/glyph-dry-run
```

Current focused tests cover helpers plus admin MVP route behavior with fake D1/R2 bindings.

Final MVP smoke checks should include:

- `GET /` renders the anonymous upload page.
- `POST /` accepts a file and returns a short URL.
- `HEAD /{id}` or `GET /{id}` returns the uploaded file while active.
- `GET /missing-id` returns the polished not-found page.
- `GET /admin` shows passkey setup/login when unauthenticated.
- Authenticated `/admin` shows upload metadata, copy affordances, and delete actions.
- `POST /admin/uploads/delete` marks metadata deleted and requests R2 object removal.
- `GET /{deleted-id}` returns the polished not-found page.
- `POST /admin/settings/storage-cap` updates or clears the storage cap for an authenticated same-origin admin request.
- `POST /admin/settings/upload-mode` switches between Worker-mediated, direct-to-R2, and multipart direct-to-R2 upload mode for an authenticated same-origin admin request.
- `POST /admin/settings/updates` saves read-only self-update settings for an authenticated same-origin admin request.
- `POST /admin/updates/check` checks configured GitHub release metadata, persists the read-only result snapshot in D1, shows release notes, local rehearsal guidance, and manual update guidance without deploying, mutating code, executing local commands, storing GitHub tokens, or mutating Cloudflare resources.
- Scheduled update checks, when explicitly configured by the operator, use the same read-only release metadata path and only persist update-check results in D1.
- `POST /admin/maintenance/r2-cleanup` retries R2 object deletion for expired/deleted uploads whose cleanup is pending.
- `pnpm run release:check` validates version consistency and local release readiness without publishing or deploying.
- `pnpm run update:glyph` checks the public release channel and prints a non-mutating manual update plan.
- `pnpm run update:glyph -- --rehearse` prints a non-mutating temporary-worktree rehearsal plan.

## Dependency Policy

Dev dependencies are limited to Cloudflare/TypeScript tooling: Wrangler, TypeScript, and Cloudflare Workers types.

Runtime dependency justification:

- `@simplewebauthn/server` verifies passkey registration and authentication responses. This is security-sensitive protocol work, so Glyph uses a focused, reputable WebAuthn package instead of hand-rolled cryptographic verification.

`pnpm-workspace.yaml` explicitly allows install-time builds for Wrangler's native transitive tooling packages: `esbuild`, `sharp`, and `workerd`.

## Public Repository Notes

Tracked configuration uses placeholders only. Before opening issues, sharing logs, or deploying from a fork, make sure these stay private:

- Real D1 `database_id` values.
- Cloudflare account IDs.
- R2 S3-compatible access keys and secret keys.
- API tokens, Wrangler secrets, `.dev.vars`, and Wrangler local state.
- Private domains when they are sensitive.
- Private deployment logs.
- Passkey, session, or upload metadata from a real deployment.
- R2 object keys, private file names, and private short links.

The repository is MIT licensed. Security reporting and contribution expectations are documented in `SECURITY.md` and `CONTRIBUTING.md`.

Public issue support is best-effort community support. Glyph does not provide a hosted service, SLA, billing support, or guaranteed compatibility with every Cloudflare account configuration. Maintainers should never need real secrets in public issues; security reports should follow `SECURITY.md` instead.

## Deployment

After replacing the D1 placeholder ID and confirming Wrangler is authenticated, run a safe deployment check:

```sh
pnpm run deploy:glyph -- --check
```

When the check is clean and you are ready to mutate remote Cloudflare resources, run:

```sh
pnpm run deploy:glyph -- --yes
```

The `--yes` command performs these steps in order:

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm wrangler d1 migrations apply glyph --remote`
- `pnpm wrangler deploy --dry-run --outdir /tmp/glyph-deploy-dry-run`
- `pnpm wrangler deploy`

Use `--skip-install` if dependencies are already installed and you want to avoid the install step. Use `--database <name-or-binding>` if the remote D1 database binding/name is not `glyph`.

For a guided setup checklist before the first deploy, run:

```sh
pnpm run deploy:glyph -- --setup
```

The setup plan is read-only by default. To create the basic Cloudflare resources from the helper, run:

```sh
pnpm run deploy:glyph -- --setup --yes
```

The setup `--yes` path creates the D1 database and R2 bucket with Wrangler. It does not edit `wrangler.jsonc`, store secrets, configure R2 CORS, create DNS records, attach custom domains, or deploy the Worker. After setup, copy the returned D1 `database_id`, configure any optional direct-upload secrets/CORS manually, then run `pnpm run deploy:glyph -- --check`.

The deploy helper validates that `wrangler.jsonc` contains:

- Worker entrypoint `src/index.ts`.
- D1 binding `DB` with `migrations_dir` set to `migrations`.
- R2 binding `FILES`.
- `APP_ENV`.
- A non-placeholder D1 `database_id` when running with `--yes`.
- `PUBLIC_BASE_URL`, when present, is an origin-only `https://` URL.

The deploy helper also reports:

- Worker name.
- Public base URL, or that Glyph will use the request-origin fallback.
- Wrangler route hosts discovered from `route`, `routes`, or `custom_domains` config.
- Optional scheduled update-check cron triggers discovered from `triggers.crons`.
- A reminder that scheduled checks also require a valid update source and read-only scheduled checks enabled in `/admin`.
- Guided setup actions and manual follow-up steps when run with `--setup`.

If `PUBLIC_BASE_URL` is set but no Wrangler route/custom-domain config is present, the helper warns so you can confirm the Worker is attached manually. If both are present but hosts differ, the helper warns about the mismatch.

Optional read-only scheduled update checks are a two-part setup: add a Cloudflare Scheduled Worker trigger in Wrangler or Cloudflare config, then configure a valid update source and enable read-only scheduled checks in `/admin`. The deploy helper only reports trigger readiness; it does not create triggers or mutate Cloudflare resources for scheduled checks.

Before deploying, make sure these Cloudflare pieces already exist:

- Wrangler is logged in for the intended Cloudflare account.
- The D1 database exists and its real `database_id` is in `wrangler.jsonc`.
- The R2 bucket exists and is bound as `FILES`.
- Optional `PUBLIC_BASE_URL` is configured if generated links should use a custom public origin.
- Optional custom-domain routing is configured in Cloudflare or Wrangler so the Worker answers on that origin.
- Optional read-only scheduled update-check trigger is configured if periodic release notices are desired; the `/admin` setting and update source must also be configured after deploy.
- Direct-to-R2 and multipart upload secrets are configured if those modes will be used: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and optionally `R2_BUCKET_NAME`.
- R2 bucket CORS permits browser `PUT` requests from the deployed Glyph origin and exposes `ETag` for multipart uploads.
- `/admin` bootstrap is completed from the deployed origin after first deploy.

Custom-domain setup is still manual:

- Add the domain to Cloudflare and make sure DNS is proxied through Cloudflare.
- Attach the Worker to the route or custom domain for the Glyph origin.
- Set `PUBLIC_BASE_URL` to the same `https://` origin so generated links match the public domain.
- Update R2 CORS if direct-to-R2 or multipart uploads are used.
- Register or re-register the admin passkey on the custom-domain origin because passkeys are origin-bound.

The lower-level `pnpm run deploy`, `pnpm run db:migrate:remote`, and Wrangler commands remain available for manual operations.

## Known MVP Limitations

- Single admin identity only. Multi-user accounts are intentionally out of scope.
- Worker-mediated uploads remain the compatibility fallback. Direct-to-R2 and multipart direct-to-R2 uploads require separate R2 S3-compatible credentials and bucket CORS.
- Multipart upload progress is client-side and part-completion based; there is no server push, background Worker, or resumable client session yet.
- The deploy helper can create the basic D1 database and R2 bucket on request, but Wrangler auth, the copied D1 database ID, secrets, CORS, DNS, and custom-domain attachment are still manual setup.
- Release checks are local only; they do not publish GitHub releases, create tags, deploy, or apply remote migrations.
- Self-update remains conservative: `/admin` is read-only, and the local helper can fetch a validated tag or run a temporary-worktree rehearsal only with `--yes`; it cannot deploy, apply remote migrations, restart Workers, store GitHub tokens, or execute updates from admin. Optional scheduled checks can only store release metadata in D1, and the deploy helper only reports cron trigger readiness.
- Custom-domain support validates and documents readiness, but does not create DNS records, zones, certificates, routes, or custom domains yet.
- No folders, public file browsing, billing, executable self-updates, or full custom-domain automation.
- Admin listing is limited to the 100 most recent metadata rows.
- Delete is soft in D1 metadata and best-effort for R2 object removal.
- Storage-cap expiration and R2 cleanup are request-driven; they do not use scheduled Workers, background queues, or cron triggers yet.
- Passkeys are origin-bound, so local and deployed admin credentials are separate.
