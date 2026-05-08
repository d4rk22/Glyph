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
- Deployment can become a one-command setup/deploy workflow.
- Custom-domain setup can be automated after the basic deploy workflow is boring and reliable.

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
- Custom-domain automation can attach/manage an optional domain with clear Cloudflare permission docs.
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
13. Add direct-to-R2 uploads.
14. Add multipart uploads, upload progress, and estimated time remaining.
15. Add one-command deploy script.
16. Add custom-domain automation.
