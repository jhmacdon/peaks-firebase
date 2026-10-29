"use client";

import { useEffect, useState } from "react";
import type { CatalogPage } from "./catalog-results";

export const SEARCH_SLOW_MS = 8_000;
export const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_ERROR = "We couldn’t load these results. Please try again.";

/** Key every completion to its query and attempt. Old successes, failures,
 * and timeouts must never replace a newer search or a cleared browse view. */
export function useCatalogSearch(
  search: string,
  active: boolean,
  request: (search: string) => Promise<CatalogPage>,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([search, attempt]);
  const [result, setResult] = useState<{ key: string; data?: CatalogPage; error?: string; slow?: boolean } | null>(null);

  useEffect(() => {
    if (!active) {
      setResult(null);
      return;
    }
    let finished = false;
    setResult({ key });
    const slowTimer = setTimeout(() => {
      if (!finished) setResult({ key, slow: true });
    }, SEARCH_SLOW_MS);
    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        setResult({ key, error: "Search is taking longer than expected. Please try again." });
      }
    }, SEARCH_TIMEOUT_MS);
    void request(search).then(
      (data) => { if (!finished) setResult({ key, data }); },
      () => { if (!finished) setResult({ key, error: SEARCH_ERROR }); },
    ).finally(() => {
      finished = true;
      clearTimeout(slowTimer);
      clearTimeout(timeout);
    });
    return () => {
      finished = true;
      clearTimeout(slowTimer);
      clearTimeout(timeout);
    };
  }, [search, active, attempt, key, request]);

  const current = active && result?.key === key ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? "",
    loading: active && !current?.data && !current?.error,
    slow: current?.slow ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
