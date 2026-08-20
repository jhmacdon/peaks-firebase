"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// The two pieces of client state the Discover page's islands share.
//
// Why a provider rather than props: the browse sections are server-rendered
// and must be in the HTML the first request returns. The search island reads
// `useSearchParams()`, which makes Next render everything inside its Suspense
// boundary on the client instead — so the sections cannot live inside that
// island. They sit beside it and learn about an active search through this
// context, which reads no search params itself and therefore prerenders
// normally.
//
// The coordinates are shared for a plainer reason: two islands want them
// (Nearby, and search's proximity bias), and the browser should only be
// asked once.
interface DiscoverState {
  lat: number | null;
  lng: number | null;
  searching: boolean;
  setSearching: (value: boolean) => void;
}

const DiscoverStateContext = createContext<DiscoverState>({
  lat: null,
  lng: null,
  searching: false,
  setSearching: () => {},
});

export function useDiscoverState(): DiscoverState {
  return useContext(DiscoverStateContext);
}

export function DiscoverStateProvider({ children }: { children: ReactNode }) {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

  // Asked for once on mount. No status is tracked for denial or timeout —
  // the Nearby section simply stays absent when there is no location,
  // rather than showing a permanent "location is off" failure card.
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      },
      () => {
        // Denied or unavailable — nothing to do.
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  }, []);

  const value = useMemo(
    () => ({ lat, lng, searching, setSearching }),
    [lat, lng, searching]
  );

  return (
    <DiscoverStateContext.Provider value={value}>
      {children}
    </DiscoverStateContext.Provider>
  );
}

/** The browse stack: every server-rendered section, stood down while a
 * search is on screen so results are the whole page rather than a band above
 * the catalog. */
export function DiscoverBrowse({ children }: { children: ReactNode }) {
  const { searching } = useDiscoverState();
  if (searching) return null;
  return <div className="mt-12 space-y-12">{children}</div>;
}
