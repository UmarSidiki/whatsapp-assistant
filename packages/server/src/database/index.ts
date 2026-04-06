// Re-export everything from schema
export * from "./schema";

// Database connection
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required for PostgreSQL connection");
}

const client = postgres(databaseUrl, {
	max: Number(process.env.DB_POOL_MAX ?? 10),
	idle_timeout: Number(process.env.DB_IDLE_TIMEOUT ?? 20),
	connect_timeout: Number(process.env.DB_CONNECT_TIMEOUT ?? 10),
	prepare: false,
});

export const db = drizzle(client, { schema });
