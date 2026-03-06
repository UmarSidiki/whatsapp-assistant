import { useState, useEffect } from "react";

const fallback = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export function useApiUrl(): string {
  const [url, setUrl] = useState(fallback);

  useEffect(() => {
    const credUrl = import.meta.env.VITE_API_CREDENTIALS_URL;
    if (!credUrl) return;
    fetch(credUrl)
      .then((r) => r.json())
      .then((cfg) => { if (cfg?.apiUrl) setUrl(cfg.apiUrl); })
      .catch(() => {});
  }, []);

  return url;
}
