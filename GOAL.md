# Glyph Project Goal

Build Glyph as a private-use, Cloudflare-first file sharing app optimized for fast uploads, fast downloads, short unguessable links, anonymous uploads, passkey-protected administration, and simple operations.

## MVP Goal

The MVP is complete. Glyph now supports:

- Anonymous uploads from `/`.
- Cloudflare R2-backed file storage.
- Cloudflare D1-backed metadata.
- Random short URLs for uploaded files.
- Short-link downloads from `/{id}`.
- Polished missing/deleted not-found responses.
- First-admin passkey bootstrap and passkey login.
- D1-backed admin sessions.
- A protected admin panel with upload listing, metadata, copy-link affordances, and deletion.
- Focused tests, setup/deployment docs, and final MVP verification.

The MVP is intended for private use with low upload volume and less than 10 GB stored in Cloudflare R2.

## v2 Goal

The next product goal is to evolve Glyph from a minimal private file drop into a more self-managing private file service:

- Links can expire manually or by policy.
- Storage usage is visible in the admin UI.
- A configurable storage cap can automatically expire the oldest active files as the cap is reached.
- Uploads can move from Worker-mediated transfer to direct-to-R2 transfer.
- Large files can use multipart uploads.
- Upload UI can show progress and estimated time remaining.
- Deployment can become a guided one-command setup/deploy workflow with explicit safety gates.
- Admins can check for updates and choose manual or opt-in automatic self-updates once the repository is public.
- Releases have a single package-backed version source and a local, non-publishing readiness check.
- The repository can be public after a secrets/configuration audit confirms tracked files use placeholders only.
- Expired/deleted objects can be reconciled with R2 by a simple retryable cleanup path.
- Custom-domain setup can start with deploy-time readiness checks and clear manual Cloudflare steps, then move toward fuller automation after the basic deploy workflow is boring and reliable.

## v2 Requirements

- Preserve the MVP upload, download, and admin behavior unless a phase explicitly replaces it.
- Keep `pnpm` as the package manager and commit `pnpm-lock.yaml`.
- Keep runtime dependencies near zero.
- Continue using Workers as the app/control plane.
- Continue using R2 for file bytes and D1 for durable app state.
- Store expiration, storage accounting, upload mode, app settings, and admin state in D1.
- Do not store file bytes in D1.
- Keep short URLs unlisted and randomly generated.
- Keep UI framework-free unless a clear implementation benefit outweighs the added complexity.
- Keep custom-domain automation optional rather than required for a basic deploy.

## Data Model Direction

Upload metadata should support:

- Short ID.
- R2 object key.
- Original filename.
- Content type.
- File size.
- Created timestamp.
- Deleted timestamp, when admin deletion occurs.
- Expiration timestamp, when a link is scheduled to expire.
- Expired timestamp, when a link has been expired by policy.
- Upload mode, such as Worker-mediated, direct-to-R2, or multipart.
- Storage state, such as pending, stored, expired, or deleted.

App settings should support:

- Storage cap in bytes, nullable.
- Default upload TTL in seconds, nullable.
- Preferred upload mode.
- Future settings without schema churn where practical.

Admin/passkey storage should continue to support:

- Admin user identity.
- WebAuthn credential ID.
- Public key.
- Signature counter or equivalent replay protection data.
- Created and last-used timestamps.
- Session storage and session revocation state.

## Architecture Direction

- Workers handle routing, upload coordination, metadata, admin UI, authentication, policy enforcement, and deploy/setup orchestration where appropriate.
- R2 stores file bytes.
- D1 stores metadata, settings, passkey credentials, admin sessions, upload lifecycle state, and storage accounting inputs.
- Worker-mediated uploads remain the compatibility baseline.
- Direct-to-R2 uploads should keep the Worker as the authorization/finalization control plane.
- Multipart uploads should support large files, retryable parts, progress, and estimated time remaining.
- Storage-cap enforcement should prefer expiring the oldest active files and deleting R2 objects best-effort.
- R2 cleanup should eventually retry failed object deletions for expired/deleted metadata without making public links available again.
- Custom-domain automation should be layered after one-command deploy, not entangled with normal deployment.

## Dependency Policy

- Use `pnpm`.
- Commit `pnpm-lock.yaml`.
- Avoid third-party packages for simple helpers such as short ID generation, routing, date formatting, validation, settings parsing, or small CLI utilities.
- Prefer Web Platform APIs and Cloudflare-native APIs.
- Avoid frontend frameworks unless there is a clear implementation benefit.
- A reputable WebAuthn/passkey library is acceptable because hand-rolled verification would increase security risk.
- Any meaningful dependency should be justified in the README or implementation notes.

## MVP Non-Goals

These were intentionally excluded from the MVP but are now candidates for v2:

- Expiring links.
- Usage dashboard.
- Storage cap and oldest-file auto expiration.
- Direct-to-R2 uploads.
- Multipart uploads.
- Upload progress and estimated time remaining.
- One-command deploy script.
- Custom-domain setup automation.

## Continuing Non-Goals

- Multi-user accounts.
- Public file browsing.
- Folder organization.
- Billing.
- Full CDN/cache tuning.
- Making custom domains mandatory for basic deployment.

## v2 Acceptance Criteria

- Existing MVP acceptance criteria continue to pass.
- Expiring links can be configured and expired links are unavailable from public short URLs.
- Admin users can see storage usage and upload lifecycle state.
- A configurable storage cap can expire the oldest active files as needed.
- Direct-to-R2 uploads work without bypassing D1 metadata/finalization controls.
- Multipart uploads support large files with progress, retry behavior, and estimated time remaining.
- One-command deploy can create or reuse Cloudflare resources, apply migrations, deploy the Worker, and print live/admin URLs.
- Self-update can check the public GitHub repository for newer releases, show current/deployed version and release notes, guide manual updates, and eventually support conservative opt-in automatic updates.
- R2 cleanup can find expired/deleted uploads whose objects may still exist, retry deletion safely, and report cleanup status without serving those links publicly.
- Custom-domain deployment support can validate public base URL and Wrangler route readiness, document manual Cloudflare setup, and leave deeper DNS/route/domain API automation as an explicit future path.
- Guided setup can create the basic D1/R2 resources on explicit request while keeping secrets, CORS, DNS, and custom-domain attachment manual until safer automation exists.
- Release/versioning groundwork keeps the deployed admin version tied to the package version and documents manual update/release expectations before executable self-updates exist.
- Manual self-update workflow shows release metadata, release notes, semver-aware update status, and operator update steps without executing deploys or migrations from admin.
- Public repository readiness includes MIT license metadata, placeholder-only configuration examples, security notes, and contribution expectations.
- The public release/update channel uses GitHub releases from the official public repository while allowing forks and private deployments to keep a blank or custom update source.
- Local manual self-update can compare the package-backed version to the public release channel, print a safe operator update plan, and fetch a validated release tag only with explicit confirmation and a clean working tree.
- Maintenance releases can bump the package-backed version, validate the release/update workflow, and publish GitHub release notes without npm publication, Worker deployment, remote migrations, or Cloudflare mutations.
- Local update rehearsal can validate a newer release in an isolated temporary worktree with explicit confirmation, cleanup guidance, migration-file summaries, and no current-checkout, deployment, remote migration, or Cloudflare mutation.
- Local manual update apply mode can move a clean checkout to a validated newer release tag with explicit confirmation while leaving install, checks, migrations, and deploy as operator-controlled steps.
- Update apply-mode maintenance releases can keep the public release/update channel aligned with local source-update workflow improvements while preserving the conservative source-only release model.
- Update rehearsal maintenance releases can keep the public release/update channel aligned with local rehearsal improvements while preserving the conservative source-only release model.
- Admin update checks can guide operators toward local update rehearsal while remaining read-only and never executing commands, deploying, applying migrations, storing tokens, scheduling checks, or mutating Cloudflare resources.
- Admin update checks can guide operators toward local apply mode while remaining read-only and never executing commands, checking out code, deploying, applying migrations, storing tokens, scheduling checks, or mutating Cloudflare resources.
- Admin update apply-guidance maintenance releases can keep the public release/update channel aligned with protected admin apply guidance while preserving the conservative source-only release model.
- Admin update rehearsal guidance maintenance releases can keep the public release/update channel aligned with protected admin guidance while preserving the conservative source-only release model.
- Read-only scheduled update check groundwork can persist update-check results in D1 and optionally notice releases without deploying, applying migrations, checking out code, mutating source, storing tokens, executing local helpers, or mutating Cloudflare resources.
- Read-only scheduled update-check maintenance releases can keep the public release/update channel aligned with scheduled check groundwork while preserving the conservative source-only release model.
- Admin scheduled update-check guidance can make the opt-in setting clearly read-only, explain operator-owned Cloudflare trigger setup, and preserve the no-deploy/no-mutation safety boundary.
- Scheduled update-check guidance maintenance releases can keep the public release/update channel aligned with clarified admin guidance while preserving the conservative source-only release model.
- Scheduled update-check deploy readiness can report Wrangler cron trigger configuration and required admin/source follow-up while preserving the no-trigger-creation/no-mutation safety boundary.
- Scheduled update-check deploy-readiness maintenance releases can keep the public release/update channel aligned with deploy/setup helper readiness reporting while preserving the conservative source-only release model.
- Optional scheduled maintenance can enforce storage caps, expire oldest active uploads, retry R2 cleanup, and persist last-run results only when an operator configures a Cloudflare Scheduled Worker trigger and enables maintenance in `/admin`.
- Optional scheduled maintenance releases can keep the public release/update channel aligned with storage maintenance, D1 migration, and admin status changes while preserving the conservative source-only release model.
- Public repository support templates guide bug reports, feature requests, deployment/setup support, and security-report redirection without asking users to post secrets or private deployment details.
- Public support template maintenance releases can keep the public release/update channel aligned with repository support-surface changes while preserving the conservative source-only release model.
- Turnkey deploy v1 can guide a technical operator from fresh checkout to deployed Worker by verifying prerequisites, creating or reusing D1/R2 resources, safely updating local Wrangler bindings with explicit confirmation, running checks/migrations/dry-run/deploy, and printing live URLs plus remaining manual Cloudflare tasks.
- Turnkey resource discovery and recovery can detect existing D1/R2 resources, reuse safe matches, extract D1 database IDs when Wrangler exposes them, and print focused recovery steps for auth, placeholder IDs, already-existing resources, invalid public origins, and direct/multipart readiness blockers.
- Turnkey deploy hardening can improve fresh-checkout success by reporting Cloudflare auth/token readiness, preserving explicit remote migration gates, checking direct/multipart secret and R2 CORS readiness, printing post-deploy verification steps, and showing recovery guidance for non-interactive and partial-setup failures.
- Guided direct/multipart setup planning can print exact Wrangler secret commands without values, recommend R2 CORS for the deployed Glyph origin, keep CORS application manual, and preserve Worker-mediated uploads as the fallback until deployed secrets and CORS are ready.
- Type checking passes.
- Available tests pass.
- Wrangler dry-run passes.
- D1 migrations are present and documented.
- README documents setup, local development, deployment, v2 limitations, and any new operational risks.

## Suggested v2 Phases

9. Update project guidance for v2 and add data-model foundation for settings, expiration, storage accounting, and future upload modes.
10. Add manual expiring links.
11. Add usage dashboard.
12. Add storage cap and oldest-file auto expiration.
13. Add R2 deletion retry and cleanup for expired/deleted uploads.
14. Add direct-to-R2 uploads.
15. Add multipart uploads, upload progress, and estimated time remaining. Completed.
16. Add one-command deploy script. Completed.
17. Add self-update system with manual updates and opt-in automatic updates. Groundwork completed.
18. Add custom-domain deployment support. Completed.
19. Improve one-command deploy with guided Cloudflare resource setup. Completed.
20. Add release/versioning groundwork for future public self-updates. Completed.
21. Improve self-update check into a manual update workflow. Completed.
22. Prepare Glyph for public repository visibility. Completed.
23. Bootstrap the public GitHub release/update channel. Completed.
24. Implement a conservative local manual self-update helper. Completed.
25. Publish the first maintenance release through the public release/update channel. Completed.
26. Add conservative local update rehearsal for release updates. Completed.
27. Publish the update rehearsal maintenance release. Completed.
28. Add admin-facing guidance for local update rehearsal. Completed.
29. Publish the admin update rehearsal guidance maintenance release. Completed.
30. Add public repository issue and support templates. Completed.
31. Publish the public support templates maintenance release. Completed.
32. Add conservative local manual update apply mode. Completed.
33. Publish the update apply-mode maintenance release. Completed.
34. Add admin-facing guidance for local update apply mode. Completed.
35. Publish the admin update apply-guidance maintenance release. Completed.
36. Add read-only scheduled update check groundwork. Completed.
37. Publish the read-only scheduled update-check maintenance release. Completed.
38. Add admin configuration guidance for read-only scheduled update checks. Completed.
39. Publish the scheduled update-check guidance maintenance release. Completed.
40. Add deploy/readiness checks for optional read-only scheduled update checks. Completed.
41. Publish the scheduled update-check deploy-readiness maintenance release. Completed.
42. Add optional scheduled maintenance for storage cap enforcement and R2 cleanup. Completed.
43. Publish the optional scheduled maintenance release. Completed.
44. Implement turnkey deploy v1. Completed.
45. Publish the turnkey deploy v1 maintenance release. Completed.
46. Improve turnkey resource discovery and recovery. Completed.
47. Publish the turnkey discovery/recovery maintenance release. Completed.
48. Harden turnkey deploy for fresh-checkout operator success. Completed.
49. Publish the turnkey deploy hardening maintenance release. Completed.
50. Add guided secrets and R2 CORS setup planning for turnkey deploy. Completed.
51. Publish the guided secrets and R2 CORS planning maintenance release. Completed.
