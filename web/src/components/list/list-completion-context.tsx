"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getListCompletion, type ListCompletionEntry } from "../../lib/actions/lists";
import { useAuth } from "../../lib/auth-context";

interface ListCompletionState {
  entries: Record<string, ListCompletionEntry> | null;
  signedIn: boolean;
}

const ListCompletionContext = createContext<ListCompletionState>({
  entries: null,
  signedIn: false,
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
  const [entries, setEntries] = useState<Record<string, ListCompletionEntry> | null>(null);

  // getListCompletion reads whose completion to fetch off the verified
  // token, not off a uid the client hands it — so the provider sends the ID
  // token and never a caller-chosen user id (same reasoning as ListProgress).
  const userId = user?.uid ?? null;

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setEntries(null);
      return;
    }

    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const result = await getListCompletion(token, listId);
      if (!cancelled) setEntries(result);
    }

    load().catch(() => {
      if (!cancelled) setEntries(null);
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, listId, userId, getIdToken]);

  const value = useMemo(() => ({ entries, signedIn: !!user }), [entries, user]);

  return (
    <ListCompletionContext.Provider value={value}>
      {children}
    </ListCompletionContext.Provider>
  );
}

export function useListCompletion(): ListCompletionState {
  return useContext(ListCompletionContext);
}
