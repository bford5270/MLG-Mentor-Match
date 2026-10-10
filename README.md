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
```

Copy `.env.example` to `.env` for local development. Never commit `.env`.
