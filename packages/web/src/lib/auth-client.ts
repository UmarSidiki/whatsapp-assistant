import { createAuthClient } from "better-auth/react";
import { API_BASE_URL } from "@/config/api";

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  storageKey: "whatsapp-bot-auth",
  disableCache: false,
});

export const { signIn, signUp, signOut, useSession } = authClient;
