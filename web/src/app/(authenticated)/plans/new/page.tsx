"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { createPlan } from "../../../../lib/actions/plans";
import { getDestination } from "../../../../lib/actions/destinations";
import { getRoute } from "../../../../lib/actions/routes";
import { getPublicPlanBundle } from "../../../../lib/actions/public-plans";
import { sharedTripPrefill, tripPrefill } from "../../../../lib/member-collections";
import DestinationPicker from "../../../../components/destination-picker";
import RoutePicker from "../../../../components/route-picker";
import { Button } from "../../../../components/ui/button";
import { Input, Label, Textarea } from "../../../../components/ui/field";
import { EmptyState } from "../../../../components/ui/empty-state";

type SelectedPlace = { id: string; name: string };

export default function NewPlanPage() {
  return <Suspense fallback={<EmptyState>Opening your trip…</EmptyState>}><NewTripForm /></Suspense>;
}

function NewTripForm() {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { routeId, destinationId, sourceTripId, name: suggestedName } = tripPrefill(params);
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [destinations, setDestinations] = useState<string[]>(destinationId ? [destinationId] : []);
  const [routes, setRoutes] = useState<string[]>(routeId ? [routeId] : []);
  const [selectedDestinations, setSelectedDestinations] = useState<SelectedPlace[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedPlace[]>([]);
  const [prefilling, setPrefilling] = useState(Boolean(routeId || destinationId || sourceTripId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefillRetry, setPrefillRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDestinations(destinationId ? [destinationId] : []);
      setRoutes(routeId ? [routeId] : []);
      setSelectedDestinations([]);
      setSelectedRoutes([]);
      setPrefilling(true);
      setError(null);
      try {
        if (sourceTripId) {
          const source = await getPublicPlanBundle(sourceTripId);
          if (cancelled) return;
          if (!source) throw new Error("This shared trip is no longer available. You can choose your own places and routes below.");
          const prefill = sharedTripPrefill(source);
          setDestinations(prefill.destinations.map((place) => place.id));
          setRoutes(prefill.routes.map((route) => route.id));
          setSelectedDestinations(prefill.destinations);
          setSelectedRoutes(prefill.routes);
          setName((current) => current || prefill.name);
          return;
        }
        const [route, destination] = await Promise.all([
          routeId ? getRoute(routeId) : Promise.resolve(null),
          destinationId ? getDestination(destinationId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if ((routeId && !route) || (destinationId && !destination)) throw new Error("This place or route is no longer available. Choose another below.");
        if (route) setSelectedRoutes([{ id: route.id, name: route.name || "Selected route" }]);
        if (destination) setSelectedDestinations([{ id: destination.id, name: destination.name || "Selected place" }]);
        setName((current) => current || suggestedName || route?.name || destination?.name || "");
      } catch (caught) {
        if (!cancelled) {
          setDestinations([]);
          setRoutes([]);
          setError(caught instanceof Error ? caught.message : "Couldn’t load the selected place or route.");
        }
      } finally {
        if (!cancelled) setPrefilling(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [routeId, destinationId, sourceTripId, suggestedName, prefillRetry]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Give your trip a name."); return; }
    if (routes.length === 0 && destinations.length === 0) { setError("Choose a place or route for your trip."); return; }
    setSubmitting(true); setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to save your trip.");
      const { id } = await createPlan(token, { name: name.trim(), description: description.trim(), destinations, routes, date: date || undefined });
      router.push(`/my-routes/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t save your trip.");
      setSubmitting(false);
    }
  }

  return <div className="mx-auto max-w-3xl px-6 py-10">
    <Button href="/my-routes" variant="quiet">← Your trips</Button>
    <h1 className="mt-5 font-display text-[32px] font-[680] text-ink sm:text-[40px]">Plan a trip</h1>
    <p className="mt-3 text-muted">Start with a place or route. Add a date when you know, then invite your friends.</p>
    {sourceTripId && <p className="mt-3 text-sm text-muted">Start with the shared trip’s places and catalog routes. Add your own date and notes. Custom tracks and party details are not copied.</p>}
    <form onSubmit={handleSubmit} className="mt-10 space-y-8">
      <fieldset disabled={submitting || prefilling} className="space-y-8 disabled:opacity-60">
        <div><h2 className="mb-4 text-xl font-medium text-ink">Where are you going?</h2><DestinationPicker selectedIds={destinations} selectedDestinations={selectedDestinations} onChange={setDestinations} /></div>
        <div><RoutePicker selectedIds={routes} selectedRoutes={selectedRoutes} onChange={setRoutes} /><p className="mt-2 text-sm text-muted">Choose a catalog route to include its map in your trip.</p></div>
        <div><Label htmlFor="trip-name">Trip name</Label><Input id="trip-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Rainier weekend" /></div>
        <div><Label htmlFor="trip-date">Trip date (optional)</Label><Input id="trip-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div><Label htmlFor="trip-notes">Notes (optional)</Label><Textarea id="trip-notes" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Meeting point, gear, or anything to remember" /></div>
      </fieldset>
      {prefilling && <p role="status" className="text-sm text-muted">Adding your selected place or route…</p>}
      {error && <div role="alert" className="text-sm text-alert"><p>{error}</p>{(routeId || destinationId || sourceTripId) && <Button type="button" variant="quiet" onClick={() => setPrefillRetry((n) => n + 1)}>Reload trip selection</Button>}</div>}
      <p className="text-sm text-muted">Your trip starts private. You can invite friends or share a public link later.</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={submitting || prefilling}>{submitting ? "Saving trip…" : "Create trip"}</Button><Button href="/my-routes" variant="secondary">Cancel</Button></div>
    </form>
  </div>;
}
