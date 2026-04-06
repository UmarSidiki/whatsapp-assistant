# Task Plan: Bun-native server + PostgreSQL migration

## Goal
Run `packages/server` natively on Bun and switch from SQLite (`better-sqlite3`) to PostgreSQL with no externally visible behavior changes.

## Phases
- [completed] 1. Audit current runtime/db coupling (Bun blockers, Better Auth adapter, Drizzle schema/config, env usage)
- [completed] 2. Replace SQLite DB layer with PostgreSQL driver + Bun-compatible setup
- [completed] 3. Update auth/data integrations that depend on DB adapter behavior
- [completed] 4. Update scripts/config/docs for Bun-native dev/build/start
- [completed] 5. Validate compile/runtime and smoke test critical endpoints

## Constraints
- Preserve app functionality and API routes/behavior.
- Prefer Bun-native libs/runtime where feasible.
- Keep migration scoped to server package unless required.

## Risks
- Data type differences between SQLite and Postgres.
- Better Auth adapter compatibility and migrations.
- Hidden SQLite assumptions in queries.

## Notes
- Legacy SQLite migrations were kept untouched and excluded from PostgreSQL startup flow.
- New PostgreSQL migrations directory: `src/database/pg-migrations`.
