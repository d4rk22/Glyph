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

## Prerequisites

- Node.js.
- `pnpm`.
- A Cloudflare account with Workers, R2, and D1 access.

## Install

```sh
pnpm install
```

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

## Migrations

Apply migrations locally:

```sh
pnpm run db:migrate:local
```

Apply migrations remotely:

```sh
pnpm run db:migrate:remote
```

## Local Development

```sh
pnpm run dev
```

Then open the local URL printed by Wrangler.

## Verification

```sh
pnpm run typecheck
pnpm test
```

Dev dependencies are limited to Cloudflare/TypeScript tooling: Wrangler, TypeScript, and Cloudflare Workers types.

Runtime dependency justification:

- `@simplewebauthn/server` verifies passkey registration and authentication responses. This is security-sensitive protocol work, so Glyph uses a focused, reputable WebAuthn package instead of hand-rolled cryptographic verification.

`pnpm-workspace.yaml` explicitly allows install-time builds for Wrangler's native transitive tooling packages: `esbuild`, `sharp`, and `workerd`.

## Deployment

After replacing the D1 placeholder ID and applying remote migrations:

```sh
pnpm run deploy
```

## Known MVP Limitations

- Direct-to-R2 and multipart uploads are intentionally deferred.
