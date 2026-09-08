"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveDestination, unsaveDestination } from "../lib/actions/saved-destinations";
import { useAuth } from "../lib/auth-context";
import { useSavedPlaces } from "../lib/saved-places-context";
import { parseSaveIntent, SAVE_INTENT_KEY } from "../lib/save-intent";
import { Button } from "./ui/button";

export default function SaveDestinationButton({ destinationId, name, compact = false }: {
  destinationId: string;
  name: string | null;
  compact?: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const { ids, loading: statusLoading, error: statusError, reload, update } = useSavedPlaces();
  const router = useRouter();
  const saved = ids.has(destinationId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const resumedIntent = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  const changeSaved = useCallback(async (nextSaved: boolean) => {
    if (!user || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      if (nextSaved) await saveDestination(token, destinationId, name);
      else await unsaveDestination(token, destinationId);
      update(destinationId, nextSaved);
      try {
        if (parseSaveIntent(sessionStorage.getItem(SAVE_INTENT_KEY))?.destinationId === destinationId) sessionStorage.removeItem(SAVE_INTENT_KEY);
      } catch { /* Saving still works when browser storage is unavailable. */ }
    } catch {
      setError(nextSaved ? "Couldn’t save this place. Try again." : "Couldn’t remove this save. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [user, destinationId, name, update]);

  // Resume only an explicit Save click from this tab, never an action encoded
  // in an arbitrary incoming URL. The intent expires after ten minutes.
  useEffect(() => {
    if (!user || authLoading || statusLoading || statusError || resumedIntent.current) return;
    let intent;
    try { intent = parseSaveIntent(sessionStorage.getItem(SAVE_INTENT_KEY)); } catch { return; }
    if (intent?.destinationId !== destinationId || intent.returnPath !== location.pathname + location.search) return;
    resumedIntent.current = true;
    container.current?.scrollIntoView({ block: "center" });
    container.current?.querySelector("button")?.focus({ preventScroll: true });
    if (saved) { sessionStorage.removeItem(SAVE_INTENT_KEY); return; }
    void changeSaved(true);
  }, [user, authLoading, statusLoading, statusError, destinationId, saved, changeSaved]);

  async function toggleSaved() {
    if (authLoading || pendingRef.current) return;
    if (!user) {
      let returnPath = location.pathname + location.search;
      try { sessionStorage.setItem(SAVE_INTENT_KEY, JSON.stringify({ destinationId, returnPath, createdAt: Date.now() })); }
      catch { returnPath = `/destinations/${encodeURIComponent(destinationId)}`; }
      router.push(`/login?next=${encodeURIComponent(returnPath)}`);
      return;
    }
    if (statusError) { await reload(); return; }
    await changeSaved(!saved);
  }
  const label = statusError ? "Retry saved status" : pending ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save";
  const busy = authLoading || statusLoading || pending;
  return (
    <div ref={container} className={`flex flex-col gap-1 ${compact ? "items-end" : "items-start"}`}>
      <Button variant={compact || saved || statusError ? "secondary" : "primary"} onClick={toggleSaved} disabled={busy}
        aria-pressed={saved} aria-label={compact ? `${label}: ${name || "place"}` : undefined}
        title={compact ? label : undefined} className={compact ? "h-11 min-h-11 w-11 px-0 shadow-sm" : "min-w-24"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z" /></svg>
        {!compact && label}
      </Button>
      {error && <span role="status" className="max-w-56 rounded-ctl bg-page p-2 text-sm text-alert">{error}</span>}
      {!compact && statusError && <span role="status" className="text-sm text-alert">Couldn’t load saved status.</span>}
    </div>
  );
}
