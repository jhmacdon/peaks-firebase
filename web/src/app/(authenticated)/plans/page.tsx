"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getUserPlans, type Plan } from "@/lib/actions/plans";
import PlanCard from "@/components/plan-card";

export default function PlansPage() {
  const { getIdToken } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;

      const data = await getUserPlans(token);
      setPlans(data);
      setLoading(false);
    }
    load();
  }, [getIdToken]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Trip Plans</h1>
        <Link
          href="/plans/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          New Plan
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-gray-400 mb-4">
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
          <p className="text-gray-500 mb-4">No trip plans yet</p>
          <Link
            href="/plans/new"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Create Your First Plan
          </Link>
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
