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
	// Keep pooled connections open by default. Bun + postgres reconnect path can emit
	// noisy negative-timeout warnings when idle reconnect scheduling drifts.
	idle_timeout: Number(process.env.DB_IDLE_TIMEOUT ?? 0),
	connect_timeout: Number(process.env.DB_CONNECT_TIMEOUT ?? 10),
	max_lifetime: Number(process.env.DB_MAX_LIFETIME ?? 0),
	prepare: false,
});

export const db = drizzle(client, { schema });
