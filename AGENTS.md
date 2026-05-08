# Glyph Project Guidance

## MVP Goal

Build Glyph as a private-use, Cloudflare-first file sharing app.

The MVP should provide:

- Anonymous uploads from a minimal public upload page.
- Cloudflare R2-backed file storage.
- Cloudflare D1-backed metadata.
- Random short URLs for uploaded files.
- Short-link downloads.
- A passkey-protected admin panel.
- Admin file listing, link copying, metadata viewing, and deletion.
- A simple, polished UI inspired by PicoShare's low-friction feel.

## Architecture Direction

- Cloudflare Workers should be the app/control plane.
- R2 should store file bytes.
- D1 should store metadata, passkey credentials, admin sessions, and related state.
- The app should avoid routing large file bytes through unnecessary infrastructure where practical.
- The architecture should leave room for direct-to-R2 uploads and multipart uploads after the MVP.

## Dependency Policy

Use pnpm, keep runtime dependencies near zero, and only add third-party packages when the security or maintenance benefit clearly outweighs the supply-chain cost.

For this project:

- Use `pnpm` as the package manager.
- Commit `pnpm-lock.yaml`.
- Prefer Web Platform APIs and Cloudflare-native APIs.
- Do not add third-party packages for simple helpers such as short ID generation, routing, date formatting, or small validation utilities.
- Keep framework usage minimal; do not add a frontend framework unless it clearly improves the app.
- It is acceptable to use a reputable WebAuthn/passkey library if hand-rolled verification would be riskier.
- Justify any meaningful dependency in the README or implementation notes.

## MVP Non-Goals

- Multi-user accounts.
- Public file browsing.
- Folder organization.
- Billing or usage dashboards.
- Full CDN/cache tuning.
- Large multipart uploads, unless they become straightforward during implementation.
- Custom domain setup automation.

## Verification Expectations

Before considering MVP work complete:

- `pnpm install` should succeed from the committed lockfile.
- Type checking should pass.
- Available tests should pass.
- D1 migrations should be present and documented.
- R2 and D1 bindings should be documented.
- README should explain setup, local development, deployment, and known MVP limitations.
