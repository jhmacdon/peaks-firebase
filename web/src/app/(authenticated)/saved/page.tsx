"use client";

import { useEffect, useState } from "react";
import DestinationCard from "../../../components/destination-card";
import { EmptyState } from "../../../components/ui/empty-state";
import { Button } from "../../../components/ui/button";
import {
  getSavedDestinations,
  type SavedDestination,
} from "../../../lib/actions/saved-destinations";
import { useAuth } from "../../../lib/auth-context";
import { LOADING_LABEL } from "../../../lib/constants";

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
        <h1 className="text-2xl font-semibold text-ink">Saved</h1>
        <p className="mt-1 text-sm text-muted">
          Peaks and places you want to visit again.
        </p>
      </header>

      {loading ? (
        <div className="py-12 text-center text-muted">{LOADING_LABEL}</div>
      ) : error ? (
        <EmptyState className="px-6">
          <p role="alert" className="text-alert">
            {error}
          </p>
        </EmptyState>
      ) : (
        <>
          {missingDestinationIds.length > 0 && (
            <div
              role="alert"
              className="mb-5 rounded-ctl border border-alert/30 bg-alert/10 px-4 py-3 text-sm text-alert"
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
              <Button href="/discover" className="mt-4">
                Find a destination
              </Button>
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
