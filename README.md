# Steam Key Vault

Self-hosted vault for storing Steam keys and handing them out via single-use links — without ever double-issuing one.

- **Encrypted at rest** (AES-256-GCM), deduped by hash, grouped by Steam App ID with store artwork
- **Claim links**: key is revealed only when the recipient clicks *Reveal* (link previewers can't burn it); atomic — exactly one visitor wins; optional expiry; revoke returns the key to the pool
- **Bulk import** from paste or `.txt`/`.csv` (incl. Steamworks exports), bulk mark used/invalid, export
- **Roles**: admins do everything; **devs** get a simple *Send keys* page with per-user daily/batch limits, see only their own links, and can report bad keys
- **Audit log** for every import, reveal, status change, claim and sign-in
- Rich Discord/Slack link previews (game art, no key leakage)

Built with Next.js 16, Postgres + Drizzle, Tailwind. One container, deploys to Railway in minutes.

## Quick start

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, ADMIN_PASSWORD
pnpm gen-secrets              # → SESSION_SECRET, MASTER_KEY (paste into .env)
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000 → `/setup` creates the first admin (setup code = `ADMIN_PASSWORD`). Invite others from **Users**.

## Deploy (Railway)

1. New project → add **Postgres** → add this repo as a service (Dockerfile is auto-detected, `railway.json` sets the health check).
2. Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `MASTER_KEY`, `PORT=3000`, optionally `APP_URL`, `SENDER_NAME`.
3. Generate a domain. Migrations run on boot.

**Back up `MASTER_KEY`** — without it stored keys are unrecoverable.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `ADMIN_PASSWORD` | ✓ | First-run setup code; afterwards a break-glass recovery login |
| `SESSION_SECRET` | ✓ | Cookie/session secret |
| `MASTER_KEY` | ✓ | 32-byte hex key encrypting stored Steam keys |
| `APP_URL` | | Public base URL for claim/invite links |
| `SENDER_NAME` | | Name in link previews (“*X* sent you a Steam key”) |
| `SITE_NAME` | | Site label in previews (defaults to `APP_URL` host) |

## Scripts

`pnpm dev` · `pnpm build` · `pnpm db:generate` (new migration from schema) · `pnpm db:migrate` · `pnpm gen-secrets` · `node scripts/smoke.mjs` (Playwright E2E against a running server)

## Notes

- Steam offers no API to validate unredeemed keys; the app recognises the `XXXXX-XXXXX-XXXXX` shape and dedupes.
- Link URLs are never stored (only a hash) — if lost, revoke and re-issue.
- Devs never see raw keys; only admins can reveal/export.
