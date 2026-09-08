"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DestinationCard from "../../../components/destination-card";
import { EmptyState } from "../../../components/ui/empty-state";
import { Button } from "../../../components/ui/button";
import { Input, Label, Select } from "../../../components/ui/field";
import { getSavedDestinations, type SavedDestination } from "../../../lib/actions/saved-destinations";
import { useSavedPlaces } from "../../../lib/saved-places-context";
import { useAuth } from "../../../lib/auth-context";
import { selectSavedDestinations, type SavedSort } from "../../../lib/member-collections";

export default function SavedDestinationsPage() {
  const { user } = useAuth();
  const savedPlaces = useSavedPlaces();
  const [state, setState] = useState<{ uid: string; destinations: SavedDestination[]; missingIds: string[]; loading: boolean; error: string | null }>({ uid: "", destinations: [], missingIds: [], loading: true, error: null });
  const request = useRef({ generation: 0 });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SavedSort>("recent");
  const load = useCallback(async () => {
    const ticket = ++request.current.generation;
    const uid = user?.uid ?? "";
    setState({ uid, destinations: [], missingIds: [], loading: true, error: null });
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error("Sign in again to see your saved places.");
      const result = await getSavedDestinations(token);
      if (request.current.generation === ticket) setState({ uid, destinations: result.destinations, missingIds: result.missingDestinationIds, loading: false, error: null });
    } catch (caught) {
      if (request.current.generation === ticket) setState({ uid, destinations: [], missingIds: [], loading: false, error: caught instanceof Error ? caught.message : "Couldn’t load your saved places." });
    }
  }, [user]);
  useEffect(() => { const active = request.current; void load(); return () => { active.generation++; }; }, [load]);
  const current = state.uid === (user?.uid ?? "");
  const destinations = useMemo(() => current ? state.destinations : [], [current, state.destinations]);
  const missingIds = current ? state.missingIds : [];
  const loading = !current || state.loading || savedPlaces.loading;
  const error = current ? state.error || (savedPlaces.error ? "Couldn’t check your saved places. Please try again." : null) : null;
  const visible = useMemo(() => selectSavedDestinations(destinations.filter((place) => savedPlaces.ids.has(place.id)), query, sort), [destinations, query, sort, savedPlaces.ids]);
  const reload = () => { void Promise.all([load(), savedPlaces.reload()]); };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-[680] text-ink sm:text-[40px]">Saved places</h1>
          <p className="mt-2 text-muted">Keep the places that caught your eye, then turn an idea into a trip.</p>
        </div>
        <Button href="/my-routes" variant="secondary">Your trips</Button>
      </header>
      {error ? (
        <EmptyState><p role="alert">{error}</p><Button className="mt-4" onClick={reload}>Try again</Button></EmptyState>
      ) : loading ? <EmptyState>Loading saved places…</EmptyState> : <>
        {missingIds.length > 0 && <div role="alert" className="mb-6 rounded-ctl border border-alert/30 p-4 text-sm text-alert">
          <p>{missingIds.length} saved {missingIds.length === 1 ? "place is" : "places are"} missing from the catalog.</p>
          <details className="mt-2"><summary className="cursor-pointer">Item details</summary><p className="mt-2 break-all">{missingIds.join(", ")}</p></details>
        </div>}
        {destinations.length === 0 ? (
          <EmptyState title="Your next trip starts here" description="Save a peak, lake, or trailhead while you explore."><Button href="/discover" className="mt-4">Explore places</Button></EmptyState>
        ) : <>
          <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_220px]">
            <div><Label htmlFor="saved-search">Find a saved place</Label><Input id="saved-search" type="search" placeholder="Name, region, or activity" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <div><Label htmlFor="saved-sort">Sort by</Label><Select id="saved-sort" value={sort} onChange={(event) => setSort(event.target.value as SavedSort)}><option value="recent">Recently saved</option><option value="name">Name</option><option value="elevation">Highest elevation</option></Select></div>
          </div>
          <p role="status" className="mb-4 text-sm text-muted">{visible.length} saved {visible.length === 1 ? "place" : "places"}</p>
          {visible.length === 0 ? <EmptyState title={query.trim() ? "No matching places" : "No saved places yet"}>{query.trim() ? <Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button> : <Button href="/discover" variant="secondary">Explore places</Button>}</EmptyState> : (
            <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{visible.map((destination) => <DestinationCard key={destination.id} {...destination} />)}</div>
          )}
        </>}
      </>}
    </div>
  );
}
