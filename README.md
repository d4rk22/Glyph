# Glyph

Glyph is a private-use, Cloudflare-first file sharing app. The MVP target is anonymous uploads, R2-backed file storage, D1-backed metadata, random short download links, and a passkey-protected admin panel.

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

Create the D1 database and R2 bucket:

```sh
pnpm wrangler d1 create glyph
pnpm wrangler r2 bucket create glyph-files
```

Copy the D1 `database_id` returned by Wrangler into `wrangler.jsonc`, replacing the placeholder `00000000-0000-0000-0000-000000000000`.

The Worker expects these bindings:

- `DB`: D1 database named `glyph`.
- `FILES`: R2 bucket named `glyph-files`.
- `APP_ENV`: environment label used by `/health`.
- `PUBLIC_BASE_URL`: optional environment variable for generated short links. If unset, Glyph uses the request origin.
- `R2_ACCOUNT_ID`: optional Cloudflare account ID for direct-to-R2 presigned uploads.
- `R2_ACCESS_KEY_ID`: optional R2 S3-compatible access key ID for direct-to-R2 presigned uploads.
- `R2_SECRET_ACCESS_KEY`: optional R2 S3-compatible secret access key for direct-to-R2 presigned uploads. Store this as a Wrangler secret.
- `R2_BUCKET_NAME`: optional R2 bucket name for presigned URLs. Defaults to `glyph-files`.

Direct-to-R2 and multipart direct-to-R2 uploads require the R2 S3-compatible credentials above and bucket CORS that permits browser `PUT` requests from the Glyph origin. Multipart mode also requires CORS to expose the `ETag` response header so the browser can report completed part ETags back to the Worker for finalization. Without the credential values, Glyph keeps using the Worker-mediated upload form even if the saved upload mode is direct or multipart.

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

## Verification

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
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
- `POST /admin/maintenance/r2-cleanup` retries R2 object deletion for expired/deleted uploads whose cleanup is pending.

## Dependency Policy

Dev dependencies are limited to Cloudflare/TypeScript tooling: Wrangler, TypeScript, and Cloudflare Workers types.

Runtime dependency justification:

- `@simplewebauthn/server` verifies passkey registration and authentication responses. This is security-sensitive protocol work, so Glyph uses a focused, reputable WebAuthn package instead of hand-rolled cryptographic verification.

`pnpm-workspace.yaml` explicitly allows install-time builds for Wrangler's native transitive tooling packages: `esbuild`, `sharp`, and `workerd`.

## Deployment

After replacing the D1 placeholder ID and applying remote migrations, deploy the Worker:

```sh
pnpm run deploy
```

Recommended deployment checklist:

- `pnpm install` succeeds from `pnpm-lock.yaml`.
- `pnpm run typecheck` passes.
- `pnpm test` passes.
- `pnpm run db:migrate:remote` has been applied to the configured D1 database.
- `wrangler.jsonc` points at the intended D1 database and R2 bucket.
- Optional `PUBLIC_BASE_URL` is configured if generated links should use a custom public origin.
- `/admin` bootstrap is completed from the deployed origin.

## Known MVP Limitations

- Single admin identity only. Multi-user accounts are intentionally out of scope.
- Worker-mediated uploads remain the compatibility fallback. Direct-to-R2 and multipart direct-to-R2 uploads require separate R2 S3-compatible credentials and bucket CORS.
- Multipart upload progress is client-side and part-completion based; there is no server push, background Worker, or resumable client session yet.
- No folders, public file browsing, billing, deploy automation, self-updates, or custom-domain automation.
- Admin listing is limited to the 100 most recent metadata rows.
- Delete is soft in D1 metadata and best-effort for R2 object removal.
- Storage-cap expiration and R2 cleanup are request-driven; they do not use scheduled Workers, background queues, or cron triggers yet.
- Passkeys are origin-bound, so local and deployed admin credentials are separate.
