import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./src/database/pg-migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
