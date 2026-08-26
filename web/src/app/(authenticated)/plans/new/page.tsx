"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { createPlan } from "../../../../lib/actions/plans";
import DestinationPicker from "../../../../components/destination-picker";
import RoutePicker from "../../../../components/route-picker";
import { Button } from "../../../../components/ui/button";
import { Input, Label, Textarea } from "../../../../components/ui/field";

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
      setError("Route name is required");
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

      router.push(`/my-routes/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create route");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6 text-ink">New Route</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <Label htmlFor="plan-name">
            Route Name <span className="text-alert">*</span>
          </Label>
          <Input
            id="plan-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mt. Rainier Weekend"
          />
        </div>

        {/* Description */}
        <div>
          <Label htmlFor="plan-desc">Description</Label>
          <Textarea
            id="plan-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Notes about your trip..."
          />
        </div>

        {/* Date */}
        <div>
          <Label htmlFor="plan-date">Trip Date</Label>
          <Input
            id="plan-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Destinations */}
        <div>
          <Label>Destinations</Label>
          <DestinationPicker
            selectedIds={destinations}
            onChange={setDestinations}
          />
        </div>

        {/* Routes */}
        <div>
          <Label>Routes</Label>
          <RoutePicker selectedIds={routes} onChange={setRoutes} />
        </div>

        {/* Error */}
        {error && (
          <div role="alert" className="rounded-ctl border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
            {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Route"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
