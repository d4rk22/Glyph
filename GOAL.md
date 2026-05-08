# Glyph MVP Goal

Build Glyph, a private-use Cloudflare-first file sharing app optimized for fast uploads, fast downloads, short unguessable links, anonymous uploads, and passkey-protected administration.

## Product Goal

Glyph should feel like a minimal personal file drop:

- Open the upload page.
- Choose a file.
- Upload it anonymously.
- Receive a short random URL.
- Share or revisit that URL to download the file.
- Use a passkey-protected admin panel to manage uploaded files.

The app is intended for private use with low upload volume and less than 10 GB stored in Cloudflare R2.

## Core Requirements

- Create a TypeScript Cloudflare Workers app.
- Use `pnpm` as the package manager.
- Keep runtime dependencies near zero.
- Use Cloudflare R2 for file storage.
- Use Cloudflare D1 for metadata, passkey credentials, admin sessions, and related state.
- Support anonymous uploads from `/`.
- Generate random short IDs for uploaded files.
- Serve downloads from short URLs like `/{id}`.
- Add an admin panel under `/admin`.
- Protect admin routes with passkey/WebAuthn authentication.
- Allow admin users to list uploads, view metadata, copy short links, and delete files.
- Keep the UI minimal, responsive, and polished.

## Data Model

Each upload should store metadata similar to:

- Short ID.
- R2 object key.
- Original filename.
- Content type.
- File size.
- Created timestamp.
- Deleted timestamp, if soft deletion is used.

Admin/passkey storage should support:

- Admin user identity.
- WebAuthn credential ID.
- Public key.
- Signature counter or equivalent replay protection data.
- Created and last-used timestamps.
- Session storage or session revocation state.

## Architecture

- Workers handle routing, upload coordination, metadata, admin UI, and authentication.
- R2 stores file bytes.
- D1 stores durable app state.
- File bytes should not be stored in D1.
- Prefer simple Worker-mediated uploads for the MVP if that keeps implementation reliable.
- Keep the design ready for direct-to-R2 presigned uploads and multipart uploads later.
- Short URLs should be unlisted and randomly generated.

## Dependency Policy

- Use `pnpm`.
- Commit `pnpm-lock.yaml`.
- Avoid third-party packages for simple helpers such as short ID generation, routing, formatting, or small validation utilities.
- Prefer Web Platform APIs and Cloudflare-native APIs.
- Avoid frontend frameworks unless there is a clear implementation benefit.
- A reputable WebAuthn/passkey library is acceptable if hand-rolled verification would increase security risk.
- Any meaningful dependency should be justified in the README or implementation notes.

## MVP Non-Goals

- Multi-user accounts.
- Public file browsing.
- Folder organization.
- Expiring links, unless trivial to add.
- Large multipart uploads.
- Custom domain setup automation.
- Billing or usage dashboards.
- Full CDN/cache tuning.

## Acceptance Criteria

- `pnpm install` succeeds from the committed lockfile.
- The app can run locally with Wrangler.
- D1 migrations are present.
- R2 and D1 bindings are configured and documented.
- Anonymous upload flow works.
- Upload completion returns a short URL.
- Short URL download flow works.
- Missing or deleted short URLs return a polished not-found response.
- Admin passkey bootstrap/login flow is implemented or clearly documented if local WebAuthn testing is limited.
- Admin file listing works.
- Admin delete removes or marks the metadata row and removes the R2 object when possible.
- Type checking passes.
- Available tests pass.
- README documents setup, Cloudflare resources, local development, deployment, dependency policy, and known MVP limitations.

## Suggested Phases

1. Scaffold a minimal TypeScript Cloudflare Workers project with Wrangler, pnpm, D1, and R2 bindings.
2. Add D1 migrations and metadata helpers.
3. Implement anonymous upload and short URL download.
4. Add minimal polished UI for upload, success, download, not-found, and error states.
5. Add admin passkey bootstrap and login.
6. Add admin file listing, copy-link affordance, metadata view, and deletion.
7. Add tests and documentation.
8. Run verification and summarize remaining risks.
