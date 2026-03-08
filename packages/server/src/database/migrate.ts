/**
 * Standalone migration runner — runs all pending migrations against app.db
 * Usage: npm run db:migrate
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const DB_PATH = process.env.DB_PATH ?? "./app.db";
const MIGRATIONS_FOLDER = "./src/database/migrations";

console.log(`🗄  Running migrations on: ${DB_PATH}`);

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

console.log("✅ Migrations applied successfully");
sqlite.close();
