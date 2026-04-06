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

await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

console.log("Migrations applied successfully");
await client.end();
