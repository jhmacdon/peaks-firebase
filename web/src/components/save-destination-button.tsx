"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSavedDestinationState,
  saveDestination,
  unsaveDestination,
} from "../lib/actions/saved-destinations";
import { useAuth } from "../lib/auth-context";
import { Button } from "./ui/button";

export default function SaveDestinationButton({
  destinationId,
  name,
}: {
  destinationId: string;
  name: string | null;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const userId = user?.uid ?? null;
  const [saved, setSaved] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setSaved(false);
      setStatusLoading(false);
      setError(null);
      return;
    }

    async function loadStatus() {
      setStatusLoading(true);
      setError(null);

      try {
        const token = await getIdToken();
        if (!token) throw new Error("Missing sign-in token");
        const state = await getSavedDestinationState(token, destinationId);
        if (!cancelled) setSaved(state.saved);
      } catch {
        if (!cancelled) setError("Couldn’t load saved status.");
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [destinationId, getIdToken, userId]);

  async function toggleSaved() {
    if (authLoading || pending) return;

    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error("Missing sign-in token");

      if (saved) {
        await unsaveDestination(token, destinationId);
        setSaved(false);
      } else {
        await saveDestination(token, destinationId, name);
        setSaved(true);
      }
    } catch {
      setError(saved ? "Couldn’t remove this save." : "Couldn’t save this place.");
    } finally {
      setPending(false);
    }
  }

  const isBusy = authLoading || statusLoading || pending;
  const label = pending
    ? saved
      ? "Removing…"
      : "Saving…"
    : saved
      ? "Saved"
      : "Save";

  return (
    <div className="flex flex-col items-start gap-1">
      {/* Saving a place is the destination page's one filled primary action
          (design-tokens.md, "Accent budget"). Once it's saved the work is
          done, so the control steps back to a neutral fill rather than
          holding the accent for a state the reader can't act on again
          without undoing it. */}
      <Button
        variant={saved ? "secondary" : "primary"}
        onClick={toggleSaved}
        disabled={isBusy}
        aria-pressed={saved}
        className="min-w-20 disabled:cursor-wait"
      >
        {label}
      </Button>
      {error && (
        <span role="status" className="max-w-48 text-xs text-alert">
          {error}
        </span>
      )}
    </div>
  );
}
