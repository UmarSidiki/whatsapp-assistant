import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(configDir, "../../.env");
const schemaPath = path.resolve(configDir, "./src/database/schema.ts");
const migrationsOutPath = path.resolve(configDir, "./src/database/pg-migrations");

config({ path: rootEnvPath });

export default defineConfig({
  dialect: "postgresql",
  schema: schemaPath,
  out: migrationsOutPath,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
