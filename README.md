# 1st MLG Mentor Match

Mobile-only (PWA) officer mentorship app for 1st Marine Logistics Group. See [PLAN.md](PLAN.md) for the design and phased build.

## Layout

- `server/` — Node 22 + Hono API (serves `/api/*`, and the built PWA). Drizzle ORM on Postgres; schema in `server/src/db/schema.ts`, migrations in `server/drizzle/`.
- `web/` — Vite + React + Tailwind v4 PWA (`vite-plugin-pwa`).
- `railway.json` — Railway build/deploy config (runs migrations, then starts the server).

## Commands

```bash
pnpm install
pnpm build          # web then server
pnpm start          # serves API + PWA on $PORT (default 3000)
pnpm dev:server     # API with reload (needs DATABASE_URL for DB routes)
pnpm dev:web        # Vite dev server, proxies /api to :3000
pnpm typecheck
pnpm db:generate    # new migration after editing schema.ts
pnpm db:migrate     # apply migrations to $DATABASE_URL
TEST_DATABASE_URL=postgres://… pnpm --filter server test   # API tests; WIPES that database
```

## Environment variables (Railway `app` service)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | Signs session cookies and hashes sign-in codes |
| `RESEND_API_KEY` | Sends sign-in codes. Without it, codes only appear in the server log |
| `EMAIL_FROM` | `1st MLG Mentorship <mentorship@1stmedlisteningpost.com>` |
| `ADMIN_EMAILS` | Comma-separated; these addresses become admins on sign-in, roster or not |
| `PORT` | `3000` |

## Roster CSV

Header row required: `email, name, service, grade, unit` (unit optional). Service is `USMC`/`USN` (or Marine/Navy); grade like `O-3`, `O3`, or `W-2`. Upload from **Admin** in the app.

Copy `.env.example` to `.env` for local development. Never commit `.env`.
