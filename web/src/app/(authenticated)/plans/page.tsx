"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth-context";
import { getUserPlans, type Plan } from "../../../lib/actions/plans";
import { LOADING_LABEL } from "../../../lib/constants";
import PlanCard from "../../../components/plan-card";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";

export default function PlansPage() {
  const { getIdToken } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Sign in to see your trip plans.");
          return;
        }
        const data = await getUserPlans(token);
        setPlans(data);
      } catch {
        setError("Couldn’t load your trip plans. Try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getIdToken]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-ink">Trip Plans</h1>
        <Button href="/plans/new" variant="secondary">New Plan</Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted">{LOADING_LABEL}</div>
      ) : error ? (
        <EmptyState className="py-16">
          <p role="alert" className="text-alert">
            {error}
          </p>
        </EmptyState>
      ) : plans.length === 0 ? (
        <div className="text-center py-16">
          <div className="mb-4 text-faint">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <p className="mb-4 text-muted">No trip plans yet</p>
          <Button href="/plans/new">Create Your First Plan</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              id={plan.id}
              name={plan.name}
              date={plan.date}
              destinationCount={plan.destinations.length}
              partySize={plan.party.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}
