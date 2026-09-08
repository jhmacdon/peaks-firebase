"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getListCompletion, type ListCompletionEntry } from "../../lib/actions/lists";
import { useAuth } from "../../lib/auth-context";

interface ListCompletionState {
  entries: Record<string, ListCompletionEntry> | null;
  signedIn: boolean;
  error: boolean;
  retry: () => void;
}

const ListCompletionContext = createContext<ListCompletionState>({
  entries: null,
  signedIn: false,
  error: false,
  retry: () => {},
});

/** One fetch of a signed-in reader's per-destination completion on this
 * list, shared by every client that needs it — the roster below (
 * list-roster.tsx) and the map hero (list-hero.tsx) — rather than each
 * consumer re-fetching the same sparse map. Renders `children`
 * unconditionally, so the server-rendered page underneath passes straight
 * through the static HTML; this only ever layers a signed-in reader's own
 * completion on top.
 *
 * `entries` is sparse by construction — getListCompletion's two SQL joins
 * are both inner, so a destination with no reached session has no key at
 * all. Missing key means "not reached", never "zero visits". Consumers
 * must guard every lookup (`entries?.[id]`), never assume a key exists. */
export function ListCompletionProvider({
  listId,
  children,
}: {
  listId: string;
  children: ReactNode;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [result, setResult] = useState<{
    userId: string;
    listId: string;
    entries: Record<string, ListCompletionEntry> | null;
    error: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // getListCompletion reads whose completion to fetch off the verified
  // token, not off a uid the client hands it — so the provider sends the ID
  // token and never a caller-chosen user id (same reasoning as ListProgress).
  const userId = user?.uid ?? null;

  useEffect(() => {
    let cancelled = false;

    if (authLoading || !userId) {
      setResult(null);
      return;
    }

    const scope = { userId, listId };
    setResult({ ...scope, entries: null, error: false });
    async function load() {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to load your list progress");
      const entries = await getListCompletion(token, listId);
      if (!cancelled) setResult({ ...scope, entries, error: false });
    }

    load().catch(() => {
      if (!cancelled) setResult({ ...scope, entries: null, error: true });
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, listId, userId, getIdToken, attempt]);

  // Hide an old result during the render before effect cleanup runs, too.
  const current = !authLoading && result?.userId === userId && result?.listId === listId;
  const entries = current ? result.entries : null;
  const error = current ? result.error : false;
  const value = useMemo(() => ({ entries, signedIn: !!userId, error, retry: () => setAttempt((value) => value + 1) }), [entries, userId, error]);

  return (
    <ListCompletionContext.Provider value={value}>
      {children}
    </ListCompletionContext.Provider>
  );
}

export function useListCompletion(): ListCompletionState {
  return useContext(ListCompletionContext);
}
