import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const sqlite = new Database("./app.db");
export const db = drizzle(sqlite, { schema });

// Run pending migrations on startup
migrate(db, { migrationsFolder: "./src/database/migrations" });
