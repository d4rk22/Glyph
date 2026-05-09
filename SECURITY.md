# Security Policy

Glyph is a small self-hosted file sharing app intended for private deployments.

## Reporting Issues

Please report suspected security issues privately to the repository owner instead of opening a public issue with exploit details. If no private contact is available, open a minimal issue asking for a security contact without including sensitive details.

## Secrets

Do not commit real Cloudflare account IDs, R2 access keys, R2 secret keys, D1 database IDs, passkey material, session data, `.dev.vars`, or Wrangler local state.

Use Wrangler secrets or the Cloudflare dashboard for sensitive values. The files `.env.example` and `.dev.vars.example` contain placeholders only.

## Current Security Notes

- Passkeys are origin-bound; local and deployed admin credentials are separate.
- Anonymous uploads are intentionally public to anyone who can reach the upload page.
- Short links are unlisted and random, but not a substitute for access control.
- Self-update checks are read-only and do not deploy code or apply migrations.
