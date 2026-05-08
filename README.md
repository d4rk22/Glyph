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

## Migrations

Migrations live in `migrations/` and create D1 tables for uploads, admin users, passkey credentials, admin sessions, WebAuthn challenges, and app settings. Later migrations add upload lifecycle fields for expiration, upload modes, and storage accounting.

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

- Original filename.
- Short URL with an in-browser copy button.
- Size and content type.
- Expiration state, expiration timestamp, and expired timestamp when present.
- Created timestamp and deleted timestamp, when present.
- Short ID and R2 object key.

Deleting an upload asks R2 to remove the stored object, then marks the D1 metadata row with `deleted_at`. Deleted short links return the same polished not-found response as missing links. If the R2 delete request fails, Glyph still marks the metadata deleted so the public link is unavailable.

Admins can set or clear a manual expiration for active uploads. Expiration timestamps are stored as UTC. Expired short links return the not-found response, but the metadata remains visible in the admin panel. Automatic storage-cap expiration is intentionally deferred to a later v2 phase.

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
- Uploads are Worker-mediated for the MVP. Direct-to-R2 and multipart uploads are intentionally deferred.
- No folders, public file browsing, billing, usage dashboard, expiring links, or custom-domain automation.
- Admin listing is limited to the 100 most recent metadata rows.
- Delete is soft in D1 metadata and best-effort for R2 object removal.
- Passkeys are origin-bound, so local and deployed admin credentials are separate.
