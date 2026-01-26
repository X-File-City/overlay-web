import { useState, useEffect, useCallback } from "react";

interface ReleaseInfo {
  version: string;
  downloadUrl: string;
  releaseName: string;
  publishedAt: string;
}

const FALLBACK_URL = "https://github.com/DevelopedByDev/dawn-releases/releases";
const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

export function useLatestRelease() {
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRelease = useCallback(async () => {
    try {
      const response = await fetch("/api/latest-release");
      if (!response.ok) {
        throw new Error("Failed to fetch release");
      }
      const data = await response.json();
      setReleaseInfo(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching latest release:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRelease();

    const interval = setInterval(fetchRelease, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchRelease]);

  return {
    downloadUrl: releaseInfo?.downloadUrl ?? FALLBACK_URL,
    version: releaseInfo?.version ?? null,
    isLoading,
    error,
  };
}
