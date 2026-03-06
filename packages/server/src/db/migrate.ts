/**
 * Standalone migration runner — runs all pending migrations against app.db
 * Usage: bun run src/db/migrate.ts
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const DB_PATH = process.env.DB_PATH ?? "./app.db";
const MIGRATIONS_FOLDER = "./src/db/migrations";

console.log(`🗄  Running migrations on: ${DB_PATH}`);

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

console.log("✅ Migrations applied successfully");
sqlite.close();
