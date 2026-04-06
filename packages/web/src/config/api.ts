// Runtime config loader — fetches apiUrl from a hosted JSON file at VITE_API_CREDENTIALS_URL.
// Falls back to VITE_API_URL env var, then http://localhost:3000.

export type AppConfig = {
  apiUrl: string;
};

export const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:3000";
    }
    return window.location.origin;
  }
  return "http://localhost:3000";
};

export const API_BASE_URL = getBaseUrl();

let cachedConfig: AppConfig | null = null;
let inFlightConfig: Promise<AppConfig> | null = null;

function toConfig(value: unknown, fallback: string): AppConfig {
  if (
    typeof value === "object" &&
    value !== null &&
    "apiUrl" in value &&
    typeof (value as { apiUrl?: unknown }).apiUrl === "string"
  ) {
    const apiUrl = (value as { apiUrl: string }).apiUrl.trim();
    if (apiUrl) return { apiUrl };
  }
  return { apiUrl: fallback };
}

async function loadAppConfig(): Promise<AppConfig> {
  const credUrl = import.meta.env.VITE_API_CREDENTIALS_URL;
  const fallback = API_BASE_URL;

  if (!credUrl) {
    return { apiUrl: fallback };
  }

  try {
    const res = await fetch(credUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch app config: ${res.status}`);
    }
    const json = await res.json();
    return toConfig(json, fallback);
  } catch {
    return { apiUrl: fallback };
  }
}

export const getAppConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) return cachedConfig;
  if (!inFlightConfig) {
    inFlightConfig = loadAppConfig()
      .then((config) => {
        cachedConfig = config;
        return config;
      })
      .finally(() => {
        inFlightConfig = null;
      });
  }
  return inFlightConfig;
};

// Kept for backwards-compatibility
export const getAPICredentials = getAppConfig;
