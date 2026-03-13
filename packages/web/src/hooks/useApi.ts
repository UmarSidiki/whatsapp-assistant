import { useState, useEffect } from "react";
import { API_BASE_URL, getAppConfig } from "@/config/api";

export function useApiUrl(): string {
  const [url, setUrl] = useState(API_BASE_URL);

  useEffect(() => {
    let isMounted = true;
    getAppConfig()
      .then((cfg) => {
        if (isMounted) setUrl(cfg.apiUrl);
      })
      .catch(() => {
        // Keep API_BASE_URL if runtime config loading fails.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return url;
}
