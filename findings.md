# Findings

## 2026-04-06
- Initialized migration tracking.
- Bun runtime previously failed due `better-sqlite3` native module incompatibility.
- Migrated server DB driver from SQLite (`better-sqlite3`) to PostgreSQL (`postgres` + Drizzle postgres-js).
- Converted Drizzle schema from `sqlite-core` to `pg-core` with booleans/timestamptz dates.
- Replaced SQLite-specific query APIs (`.all/.get/.run`) with Postgres-compatible query patterns.
- Replaced SQLite unix timestamp/date SQL logic with Postgres timestamp/date expressions.
- Existing SQLite migration history cannot be executed against PostgreSQL; migration output now targets `src/database/pg-migrations`.
