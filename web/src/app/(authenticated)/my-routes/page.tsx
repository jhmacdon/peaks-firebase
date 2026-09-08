"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth-context";
import { getUserPlans, type Plan } from "../../../lib/actions/plans";
import PlanCard from "../../../components/plan-card";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Input, Label } from "../../../components/ui/field";
import { tripGroup } from "../../../lib/member-collections";

export default function MyRoutesPage() {
  const { getIdToken } = useAuth();
  const [trips, setTrips] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again.");
      setTrips(await getUserPlans(token));
    } catch { setError("Couldn’t load your trips."); }
    finally { setLoading(false); }
  }, [getIdToken]);
  useEffect(() => { void load(); }, [load]);
  const visible = trips.filter((trip) => `${trip.name} ${trip.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="mx-auto max-w-[1200px] px-6 py-10">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="font-display text-[32px] font-[680] text-ink sm:text-[40px]">Your trips</h1><p className="mt-2 text-muted">Places, routes, and the people going with you.</p></div>
      <Button href="/my-routes/new">Plan a trip</Button>
    </header>
    {loading ? <EmptyState>Loading your trips…</EmptyState> : error ? <EmptyState><p role="alert">{error}</p><Button className="mt-4" onClick={load}>Try again</Button></EmptyState> : trips.length === 0 ? (
      <EmptyState title="Where will you go next?" description="Choose a place or route, add a date, and invite your friends."><Button href="/discover" className="mt-4" variant="secondary">Explore places</Button></EmptyState>
    ) : <>
      <div className="mb-8 max-w-xl"><Label htmlFor="trip-search">Find a trip</Label><Input id="trip-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your trips" /></div>
      {visible.length === 0 ? <EmptyState title="No matching trips"><Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button></EmptyState> : ["Upcoming", "Ideas", "Past"].map((group) => {
        const items = visible.filter((trip) => tripGroup(trip.date, today) === group).sort((a, b) => group === "Upcoming" ? (a.date ?? "").localeCompare(b.date ?? "") : (b.date ?? b.updatedAt).localeCompare(a.date ?? a.updatedAt));
        return items.length > 0 && <section key={group} className="mt-10"><h2 className="mb-5 text-xl font-medium text-ink">{group}</h2><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((trip) => <PlanCard key={trip.id} id={trip.id} name={trip.name} date={trip.date} destinationCount={trip.destinations.length} partySize={trip.party.length} isPublic={trip.isPublic} description={trip.description} preview={trip.preview} />)}</div></section>;
      })}
    </>}
  </div>;
}
