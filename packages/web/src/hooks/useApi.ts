import { useState, useEffect } from "react";
import { API_BASE_URL } from "@/config/api";

export function useApiUrl(): string {
  const [url, setUrl] = useState(API_BASE_URL);

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
