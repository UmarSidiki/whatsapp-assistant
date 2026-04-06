/**
 * Standalone migration runner — runs all pending migrations against PostgreSQL
 * Usage: bun run db:migrate
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = "./src/database/pg-migrations";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run migrations");
}

console.log("Running PostgreSQL migrations");

const client = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(client);

const hasMigrationTable = async (): Promise<boolean> => {
  const [row] = await client`select to_regclass('drizzle.__drizzle_migrations') as reg`;
  return Boolean(row?.reg);
};

const getAppliedMigrationsCount = async (): Promise<number> => {
  if (!(await hasMigrationTable())) return 0;
  const [row] = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
  return Number(row?.count ?? 0);
};

const getExistingCoreTablesCount = async (): Promise<number> => {
  const [row] = await client`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('user', 'session', 'account', 'message_log')
  `;
  return Number(row?.count ?? 0);
};

const main = async () => {
  try {
    const appliedMigrations = await getAppliedMigrationsCount();
    const existingCoreTables = await getExistingCoreTablesCount();

    // If schema exists but migration history is empty (e.g. bootstrapped via db:push),
    // skip SQL migrations to avoid "relation already exists" errors.
    if (appliedMigrations === 0 && existingCoreTables > 0) {
      console.log("Detected existing schema without migration history; skipping db:migrate safely.");
      console.log("Use 'bun run db:push' for schema sync in this environment.");
    } else {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      console.log("Migrations applied successfully");
    }
  } finally {
    await client.end();
  }
};

await main();

