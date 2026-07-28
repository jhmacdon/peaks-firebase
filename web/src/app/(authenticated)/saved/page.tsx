"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DestinationCard from "../../../components/destination-card";
import { EmptyState } from "../../../components/ui/empty-state";
import {
  getSavedDestinations,
  type SavedDestination,
} from "../../../lib/actions/saved-destinations";
import { useAuth } from "../../../lib/auth-context";

export default function SavedDestinationsPage() {
  const { user, getIdToken } = useAuth();
  const userId = user?.uid ?? null;
  const [destinations, setDestinations] = useState<SavedDestination[]>([]);
  const [missingDestinationIds, setMissingDestinationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;

    async function loadSavedDestinations() {
      setLoading(true);
      setError(null);

      try {
        const token = await getIdToken();
        if (!token) throw new Error("Missing sign-in token");
        const result = await getSavedDestinations(token);

        if (!cancelled) {
          setDestinations(result.destinations);
          setMissingDestinationIds(result.missingDestinationIds);
        }
      } catch {
        if (!cancelled) {
          setError("Couldn’t load your saved destinations. Try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSavedDestinations();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, userId]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Saved</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Peaks and places you want to visit again.
        </p>
      </header>

      {loading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : error ? (
        <EmptyState className="px-6">
          <p>{error}</p>
        </EmptyState>
      ) : (
        <>
          {missingDestinationIds.length > 0 && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {missingDestinationIds.length === 1
                ? "One saved item is missing from the destination catalog."
                : `${missingDestinationIds.length} saved items are missing from the destination catalog.`}
              <span className="mt-1 block break-all font-mono text-xs opacity-80">
                {missingDestinationIds.join(", ")}
              </span>
            </div>
          )}

          {destinations.length === 0 ? (
            <EmptyState className="px-6 py-14">
              <p>No saved destinations yet.</p>
              <Link
                href="/discover"
                className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Find a destination
              </Link>
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {destinations.map((destination) => (
                <DestinationCard
                  key={destination.id}
                  id={destination.id}
                  name={destination.name}
                  elevation={destination.elevation}
                  features={destination.features}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
