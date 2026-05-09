# Contributing

Glyph is early and optimized for a small self-hosted deployment. Issues and focused pull requests are welcome once the repository is public.

Before opening a pull request:

- Keep runtime dependencies near zero.
- Keep the app framework-free unless there is a clear maintenance benefit.
- Run `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`, and `pnpm run release:check`.
- Do not include real Cloudflare IDs, secrets, local `.dev.vars`, or Wrangler state.

For security concerns, see `SECURITY.md`.
