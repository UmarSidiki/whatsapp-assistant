// Runtime config loader — fetches apiUrl from a hosted JSON file at VITE_API_CREDENTIALS_URL.
// Falls back to VITE_API_URL env var, then http://localhost:3000.

export type AppConfig = {
  apiUrl: string;
};

let cachedConfig: AppConfig | null = null;

export const getAppConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) return cachedConfig;

  const credUrl = import.meta.env.VITE_API_CREDENTIALS_URL;
  const fallback = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

  if (!credUrl) {
    cachedConfig = { apiUrl: fallback };
    return cachedConfig;
  }

  try {
    const res = await fetch(credUrl);
    const json = await res.json();
    cachedConfig = { apiUrl: json.apiUrl ?? fallback };
  } catch {
    cachedConfig = { apiUrl: fallback };
  }

  return cachedConfig;
};

// Kept for backwards-compatibility
export const getAPICredentials = getAppConfig;
