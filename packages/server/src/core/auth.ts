import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createHash } from "node:crypto";
import { db } from "../database";
import * as schema from "../database";

function resolveAuthSecret(): string {
  const envSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }

  // Dev-safe deterministic fallback to avoid weak static defaults.
  const seed = `${process.cwd()}::${process.env.DATABASE_URL ?? "local-dev"}::better-auth`;
  return createHash("sha256").update(seed).digest("hex");
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: resolveAuthSecret(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  user: {
    additionalFields: {
      role: {
        type: "string",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh every 24 hours
  },
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://assistant.itupdown.com",
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
  ],
});
