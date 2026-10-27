"use client";

import { useState } from "react";
import Link from "next/link";
import { titleize } from "../../lib/destination-detail";
import { getRoutePlaces } from "../../lib/actions/route-context";
import { mergeRoutePlaces, type RoutePlacePage } from "../../lib/route-context";
import { SectionHeading } from "../ui/section-heading";

export function RouteWaypoints({routeId,initialPage,className=""}:{
  routeId:string;initialPage:RoutePlacePage|null;className?:string;
}) {
  const [places,setPlaces]=useState(initialPage?.items??[]);
  const [cursor,setCursor]=useState(initialPage?.nextCursor??null);
  const [loaded,setLoaded]=useState(initialPage!==null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(initialPage?null:"Places could not be loaded.");
  async function load() {
    if (busy) return;
    setBusy(true);setError(null);
    try {
      const page=await getRoutePlaces(routeId,loaded?cursor??undefined:undefined);
      setPlaces(previous=>loaded?mergeRoutePlaces(previous,page.items):page.items);setCursor(page.nextCursor);setLoaded(true);
    } catch {setError("Places could not be loaded. Please try again.");setLoaded(false);setCursor(null);}
    finally {setBusy(false);}
  }
  return <section className={className} aria-labelledby="route-waypoints">
    <SectionHeading><span id="route-waypoints">Along the way</span></SectionHeading>
    {loaded&&places.length===0?<p className="mt-4 text-sm text-muted">No named places were found in this part of the route.</p>:null}
    {places.length>0?<ol className="mt-4 divide-y divide-hairline border-y border-hairline">
      {places.map(place=>{
        const details=[place.elevation!=null?`${Math.round(place.elevation*3.28084).toLocaleString()} ft`:null,
          ...place.features.map(titleize),
          place.distance_along_m<10?"Start":`${(place.distance_along_m/1609.344).toFixed(1)} mi in`,
          place.route_offset_m>50?`${Math.round(place.route_offset_m*3.28084).toLocaleString()} ft off route`:null].filter(Boolean);
        return <li key={place.id} className="py-3">
          <Link href={`/destinations/${place.id}`} className="font-medium text-ink hover:underline">{place.name}</Link>
          <p className="mt-0.5 text-[13px] text-muted">{details.join(" · ")}</p>
        </li>;
      })}
    </ol>:null}
    {error?<p role="status" className="mt-4 text-sm text-muted">{error}</p>:null}
    {(cursor||!loaded||error)?<button type="button" onClick={load} disabled={busy}
      className="mt-4 min-h-11 text-sm font-medium text-accent-text disabled:opacity-50">
      {busy?"Loading places…":error?"Try again":"More places along this route"}
    </button>:null}
  </section>;
}
