"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth-context";
import { getUserPlans, type Plan } from "../../../lib/actions/plans";
import { LOADING_LABEL } from "../../../lib/constants";
import PlanCard from "../../../components/plan-card";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";

export default function MyRoutesPage() {
  const { getIdToken } = useAuth();
  const [routes, setRoutes] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Sign in to see your saved routes.");
          return;
        }
        const data = await getUserPlans(token);
        setRoutes(data);
      } catch {
        setError("Couldn’t load your saved routes. Try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getIdToken]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">My Routes</h1>
        <Button href="/my-routes/new" variant="secondary">
          New Route
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted">{LOADING_LABEL}</div>
      ) : error ? (
        <EmptyState className="py-16">
          <p role="alert" className="text-alert">
            {error}
          </p>
        </EmptyState>
      ) : routes.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mb-4 text-faint">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto"
              aria-hidden="true"
            >
              <path d="M4 19c4-6 6-9 9-9 2 0 3 2 7 5" />
              <circle cx="7" cy="7" r="2" />
            </svg>
          </div>
          <p className="mb-4 text-muted">No saved routes yet</p>
          <Button href="/my-routes/new">Create Your First Route</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map((route) => (
            <PlanCard
              key={route.id}
              id={route.id}
              name={route.name}
              date={route.date}
              destinationCount={route.destinations.length}
              partySize={route.party.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}
