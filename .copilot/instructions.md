# Copilot instructions for this repository (afk-miners)

## Purpose
- Provide repository-specific guidance so Copilot Coding Agent can implement changes safely, efficiently, and with low cost on Neon.
- Preserve current public API behavior and gameplay while enabling autosuspend and reducing DB/CPU usage.

## Stack and conventions
- Runtime: Node.js (CommonJS `require(...)`), Express, optional `ws` websockets.
- Database: PostgreSQL (Neon recommended). Use the pooled endpoint (`-pooler`) with `sslmode=require` and set `application_name`.
- DB access: ALWAYS use helpers from `server/models/db.js` (`all`, `get`, `run`, `getPool`). Do NOT create additional pools or direct `pg` clients.
- Auth/CSRF: Keep middleware as-is (`cookieParser`, `requireAuth`, `requireCsrf`, `csrfRoute`). Do not alter route contracts.
- Websocket: Optional via `ws`. If enabled, the server attaches under `/ws`.

## Environment variables (observed by the app)
- DATABASE_URL: PostgreSQL connection string. Prefer Neon `-pooler`.
- DB_IDLE_CLOSE_MINUTES: when > 0, enables idle pool closer; allows Neon to autosuspend on inactivity.
- STATIC_CACHE_SECONDS: TTL for in-memory HTTP cache on static/catalog endpoints (default 300–600 in prod).
- SYNC_SPAWNS_INTERVAL_MS: interval for spawn sync loop (default 300000 = 5 min); must be idle-aware.
- MIGRATE_ON_BOOT: "1" (default) runs DB migrations on boot; "0" skip on boot (prod-friendly).
- REDIS_URL: optional, enables chat pub/sub between instances.
- JWT_SECRET, SESSION_COOKIE_NAME (or COOKIE_NAME): auth/session.

## Do / Don't

### Do
- Keep public API responses identical (shape and fields).
- Use `idlePoolCloser` to track activity and allow DB pool to close on idle.
- Gate background loops (respawn, spawn sync, loot cleanup) by idleness so they don't keep Neon compute awake.
- Add ETag/304 and short-lived in-memory cache for read-mostly endpoints like `/api/assets/items` and `/api/assets/sprites`.
- Prefer small, idempotent DB indexes for common lookups (e.g., `map_objects.mapKey`, `spawns.mapKey`).
- Log concisely (state transitions, warnings) — avoid noisy logs.

### Don't
- Don't introduce new pg pools or persistent background tasks that prevent autosuspend.
- Don't change route URLs or response JSON.
- Don't add heavy dependencies unless strictly necessary.
- Don't run periodic queries when the app is idle.

## Coding guidelines (practical)
- Use existing services: `server/services/idlePoolCloser`, `server/services/catalogCache` (or add small helpers under `server/services/`).
- When touching websockets in `server/index.js`, call `idlePoolCloser.updateLastRequest()` on:
  - `wss.on('connection', ...)`, and at the start of message handling.
- For spawn-related background work:
  - Replace fixed `setInterval(..., 60_000)` with idle-aware scheduling.
  - Expose `SYNC_SPAWNS_INTERVAL_MS` (default 5 min) and skip ticks when idle.
- For caches with ETag:
  - Compute a weak ETag (e.g., `W/"<md5>"` of JSON).
  - If `If-None-Match` matches, return 304 and avoid DB reads.
  - Respect `STATIC_CACHE_SECONDS` TTL for in-memory cache.

## Migrations and indexes
- Apply schema changes in `server/models/migrate.js` using idempotent SQL:
  - `CREATE TABLE IF NOT EXISTS ...`
  - `CREATE INDEX IF NOT EXISTS ...`
  - Use safe ALTERs and guards (PL/pgSQL DO blocks) only when required.
- Keep `MIGRATE_ON_BOOT=0` as prod-safe default in deployments; run migrations via job/manual when needed.

## Docs
- Update `docs/context/API.md` (or create it) to document the env vars above, defaults, and operational notes for Neon.

## Acceptance criteria to use in PRs
- Idle gating: with `DB_IDLE_CLOSE_MINUTES > 0` and no traffic, DB pool closes and background loops stop; on HTTP or WS activity, loops resume automatically in ≤30s.
- `/api/assets/items` and `/api/assets/sprites`:
  - Same JSON as before.
  - After warm cache, repeat requests with matching `If-None-Match` yield 304 without DB reads.
- If `MIGRATE_ON_BOOT=0`, boot logs a clear message that migrations were skipped.
- New indexes are created idempotently and safely if already present.

## Review checklist (for Copilot reviews)
- Public API unchanged? (URLs, JSON shape, status codes)
- No new pg pools? Background loops idle-aware and stoppable?
- ETag/304 implemented correctly with correct headers and TTL?
- Interval and env defaults conservative for prod?
- Logs minimal and useful (once per state change)?
- Migrations safe, idempotent, and limited in scope?

## Paths and assets
- Treat `client/sprites/` and large content files as data — do not reformat or rename.
- Avoid committing secrets or large binaries.

## How to run (notes)
- The server entry point is `server/index.js`. Use Node 18+ or compatible. Use `npm` unless the repo specifies otherwise.
- If scripts differ, follow what's defined in `package.json`.