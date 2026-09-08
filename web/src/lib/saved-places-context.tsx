"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getSavedDestinationIds } from "./actions/saved-destinations";
import { useAuth } from "./auth-context";

type SavedPlacesState = {
  ids: Set<string>;
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
  update: (id: string, saved: boolean) => void;
};
const SavedPlacesContext = createContext<SavedPlacesState | null>(null);

/** One status read per signed-in layout, shared by every place card and detail action. */
export function SavedPlacesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState({ uid: "", ids: new Set<string>(), loading: false, error: false });
  const request = useRef({ value: 0 });
  const reload = useCallback(async () => {
    const ticket = ++request.current.value;
    if (!user) {
      setState({ uid: "", ids: new Set(), loading: false, error: false });
      return;
    }
    setState((old) => ({ ids: old.uid === user.uid ? old.ids : new Set(), uid: user.uid, loading: true, error: false }));
    try {
      const ids = await getSavedDestinationIds(await user.getIdToken());
      if (request.current.value === ticket) setState({ uid: user.uid, ids: new Set(ids), loading: false, error: false });
    } catch {
      if (request.current.value === ticket) setState({ uid: user.uid, ids: new Set(), loading: false, error: true });
    }
  }, [user]);
  useEffect(() => { const generation = request.current; void reload(); return () => { generation.value++; }; }, [reload]);
  const update = useCallback((id: string, saved: boolean) => {
    setState((old) => {
      if (old.uid !== (user?.uid ?? "")) return old;
      const ids = new Set(old.ids);
      if (saved) ids.add(id); else ids.delete(id);
      return { ...old, ids };
    });
  }, [user?.uid]);
  const current = state.uid === (user?.uid ?? "");
  return <SavedPlacesContext.Provider value={{ ids: current ? state.ids : new Set(), loading: Boolean(user) && (!current || state.loading), error: current && state.error, reload, update }}>{children}</SavedPlacesContext.Provider>;
}

export function useSavedPlaces() {
  const state = useContext(SavedPlacesContext);
  if (!state) throw new Error("Saved places require SavedPlacesProvider");
  return state;
}
