"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { createPlan } from "../../../../lib/actions/plans";
import DestinationPicker from "../../../../components/destination-picker";
import RoutePicker from "../../../../components/route-picker";

export default function NewPlanPage() {
  const { getIdToken } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [routes, setRoutes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Plan name is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        setError("Not authenticated");
        setSubmitting(false);
        return;
      }

      const { id } = await createPlan(token, {
        name: name.trim(),
        description: description.trim() || undefined,
        destinations: destinations.length > 0 ? destinations : undefined,
        routes: routes.length > 0 ? routes : undefined,
        date: date || undefined,
      });

      router.push(`/plans/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">New Trip Plan</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label
            htmlFor="plan-name"
            className="block text-sm font-medium mb-1.5"
          >
            Plan Name <span className="text-red-500">*</span>
          </label>
          <input
            id="plan-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mt. Rainier Weekend"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="plan-desc"
            className="block text-sm font-medium mb-1.5"
          >
            Description
          </label>
          <textarea
            id="plan-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Notes about your trip..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
          />
        </div>

        {/* Date */}
        <div>
          <label
            htmlFor="plan-date"
            className="block text-sm font-medium mb-1.5"
          >
            Date
          </label>
          <input
            id="plan-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Destinations */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Destinations
          </label>
          <DestinationPicker
            selectedIds={destinations}
            onChange={setDestinations}
          />
        </div>

        {/* Routes */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Routes</label>
          <RoutePicker selectedIds={routes} onChange={setRoutes} />
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating..." : "Create Plan"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
