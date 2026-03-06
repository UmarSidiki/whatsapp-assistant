import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const sqlite = new Database("./app.db");
export const db = drizzle(sqlite, { schema });

// Run pending migrations on startup
migrate(db, { migrationsFolder: "./src/db/migrations" });
