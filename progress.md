# Progress Log

## 2026-04-06
- Created planning files for Bun-native + PostgreSQL migration.
- Audited SQLite/Bun incompatibilities and mapped impacted files.
- Migrated runtime stack to Bun-native server entry (`Bun.serve`) and Postgres-backed Drizzle.
- Updated Better Auth adapter provider from SQLite to PostgreSQL.
- Converted schema and service query APIs to PostgreSQL-compatible Drizzle usage.
- Updated analytics/admin timestamp logic from Unix/SQLite patterns to PostgreSQL timestamp queries.
- Updated scripts/env/docs for Bun + PostgreSQL workflow.
- Verified no current TypeScript/compile errors in `packages/server`.
