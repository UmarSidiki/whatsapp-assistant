import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { API_BASE_URL } from "@/config/api";

export type UserRole = "user" | "admin";

export const ADMIN_ROLES = ["admin"] as const satisfies readonly UserRole[];

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  storageKey: "whatsapp-bot-auth",
  disableCache: false,
  plugins: [
    inferAdditionalFields({
      user: {
        role: {
          type: "string",
        },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
