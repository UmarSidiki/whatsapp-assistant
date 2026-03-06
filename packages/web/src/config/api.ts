// Runtime config loader — fetches apiUrl from a hosted JSON file at VITE_API_CREDENTIALS_URL.
// Falls back to VITE_API_URL env var, then http://localhost:3000.

export type AppConfig = {
  apiUrl: string;
};

export const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
};

export const API_BASE_URL = getBaseUrl();

let cachedConfig: AppConfig | null = null;

export const getAppConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) return cachedConfig;

  const credUrl = import.meta.env.VITE_API_CREDENTIALS_URL;
  const fallback = API_BASE_URL;

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
