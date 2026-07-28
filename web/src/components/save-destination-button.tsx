"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSavedDestinationState,
  saveDestination,
  unsaveDestination,
} from "../lib/actions/saved-destinations";
import { useAuth } from "../lib/auth-context";

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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggleSaved}
        disabled={isBusy}
        aria-pressed={saved}
        className={
          saved
            ? "inline-flex min-w-20 items-center justify-center rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-950"
            : "inline-flex min-w-20 items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        }
      >
        {label}
      </button>
      {error && (
        <span role="status" className="max-w-48 text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
