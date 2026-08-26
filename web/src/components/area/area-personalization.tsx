"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAreaPersonalActivity,
  type AreaPersonalActivity,
} from "../../lib/actions/areas";
import { useAuth } from "../../lib/auth-context";

interface AreaPersonalizationState {
  activity: AreaPersonalActivity | null;
  loading: boolean;
  signedIn: boolean;
}

const AreaPersonalizationContext = createContext<AreaPersonalizationState>({
  activity: null,
  loading: false,
  signedIn: false,
});

/** Loads one signed-in reader's area visits and reached destinations once,
 * then shares the result with the hero map, progress summary, destination
 * roster, and recent sessions. Static area content still renders on the
 * server and passes through as children. */
export function AreaPersonalizationProvider({
  areaId,
  children,
}: {
  areaId: string;
  children: ReactNode;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;
  const [activity, setActivity] = useState<AreaPersonalActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setActivity(null);
      setActivityLoading(false);
      return;
    }

    setActivity(null);
    setActivityLoading(true);

    getIdToken()
      .then((token) => (token ? getAreaPersonalActivity(token, areaId, 5) : null))
      .then((result) => {
        if (!cancelled) setActivity(result);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [areaId, authLoading, getIdToken, userId]);

  const value = useMemo(
    () => ({
      activity,
      loading: authLoading || activityLoading,
      signedIn: userId != null,
    }),
    [activity, activityLoading, authLoading, userId]
  );

  return (
    <AreaPersonalizationContext.Provider value={value}>
      {children}
    </AreaPersonalizationContext.Provider>
  );
}

export function useAreaPersonalization(): AreaPersonalizationState {
  return useContext(AreaPersonalizationContext);
}
