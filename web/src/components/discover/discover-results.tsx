"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DestinationCard from "../destination-card";
import RouteCard from "../route-card";
import AreaCard from "../area-card";
import ListCard from "../list-card";
import { CatalogFilters } from "./catalog-filters";
import { useDiscoverState } from "./discover-state";
import { searchCatalog } from "../../lib/actions/catalog-search";
import { catalogHref, hasCatalogSelection, parseCatalogFilters } from "../../lib/catalog-search";
import type { CatalogPage } from "../../lib/catalog-results";
import { subdivisionName } from "../../lib/regions";

const SCOPES = [{id:"all",label:"All"},{id:"destinations",label:"Peaks & places"},{id:"routes",label:"Routes"},{id:"areas",label:"Parks & areas"},{id:"lists",label:"Lists"}] as const;

export function DiscoverResults() {
  const params = useSearchParams();
  const search = params.toString();
  const filters = parseCatalogFilters(search);
  const router = useRouter();
  const { setSearching } = useDiscoverState();
  const active = hasCatalogSelection(filters);
  const [page, setPage] = useState<{search:string;data:CatalogPage}|null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(filters.query);
  useEffect(()=>setQuery(filters.query),[filters.query]);
  useEffect(()=>setSearching(active),[active,setSearching]);
  useEffect(()=>{
    if (!active) return;
    let cancelled=false;
    setError("");
    searchCatalog(search).then(data=>{if(!cancelled)setPage({search,data});}).catch(()=>{if(!cancelled)setError("We couldn't load these results. Please try again.");});
    return ()=>{cancelled=true;};
  },[search,active,retry]);
  const data = page?.search===search ? page.data : null;
  const loading = active && !data && !error;
  function change(changes:Record<string,string|number|null>) { router.push(catalogHref("/discover",search,changes),{scroll:false}); }
  const title = filters.query ? `Results for “${filters.query}”` : filters.state ? `Explore ${subdivisionName("US",filters.state)}` : filters.area ? "Explore this area" : filters.nearLat!==null ? "Near your chosen location" : "Find your next outing";
  return <div>
    <h1 className={`${active?"text-3xl":"text-3xl sm:text-4xl"} font-semibold tracking-tight text-ink`}>{active?"Explore":"Find your next day outside"}</h1>
    {!active?<p className="mt-2 text-base leading-6 text-muted">Explore peaks, routes, and parks. Start with a place near you.</p>:null}
    <form onSubmit={event=>{event.preventDefault();change({q:query});}} className="mt-4 flex max-w-3xl gap-2">
      <label className="sr-only" htmlFor="discover-search">Search peaks, parks, routes, and lists</label>
      <input id="discover-search" name="q" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search a peak, park, or route" className="min-h-12 min-w-0 flex-1 rounded-media border border-border bg-page px-4 text-base text-ink placeholder:text-muted"/>
      <button type="submit" className="min-h-12 rounded-media bg-accent px-5 text-sm font-semibold text-[#21211f]">Search</button>
    </form>
    <div className="mt-4 max-w-3xl"><CatalogFilters search={search} onChange={change}/></div>
    {!active?<section className="mt-7 rounded-media bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold text-ink">Start somewhere close</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Choose a state or use your location to find peaks, trails, and parks for your next day outside.</p>
      <div className="mt-4 flex flex-wrap gap-2">{["WA","CA","CO","NH","UT"].map(state=><Link key={state} href={catalogHref("/discover","",{state})} className="inline-flex min-h-11 items-center rounded-full border border-border bg-page px-4 text-sm font-medium text-ink hover:border-accent">{subdivisionName("US",state)}</Link>)}<Link href="/peaks" className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-accent-text">All state guides →</Link></div>
    </section>:<section className="mt-4 sm:mt-6" aria-labelledby="results-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-3"><h2 id="results-heading" className="text-xl font-semibold text-ink">{title}</h2><div className="flex gap-4"><Link href={catalogHref("/map",search)} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text">Map view</Link><Link href="/discover" className="inline-flex min-h-11 items-center text-sm text-muted underline">Clear filters</Link></div></div>
      <nav aria-label="Result types" className="mt-2 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap">{SCOPES.map(scope=><Link key={scope.id} href={catalogHref("/discover",search,{type:scope.id})} aria-current={filters.scope===scope.id?"page":undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm ${filters.scope===scope.id?"border-accent bg-accent/10 font-semibold text-accent-text":"border-border text-ink-2"}`}>{scope.label}{data&&(scope.id==="routes"||!(filters.difficulty||filters.maxDistance||filters.maxGain))?<span className="text-xs text-muted">{data.counts[scope.id].toLocaleString("en-US")}</span>:null}</Link>)}</nav>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted">{loading?"Finding places…":data?`${data.total.toLocaleString("en-US")} results${data.total&&data.hits.length?` · showing ${(data.page-1)*data.pageSize+1}–${Math.min(data.page*data.pageSize,data.total)}`:""}`:""}</p>
      {error?<div role="alert" className="mt-5 rounded-media border border-alert/30 p-5"><p className="text-sm text-alert">{error}</p><button type="button" onClick={()=>{setPage(null);setRetry(value=>value+1);}} className="mt-3 min-h-11 rounded-ctl border border-border px-4 text-sm font-medium text-ink">Try again</button></div>:null}
      {loading?<div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">{Array.from({length:6},(_,index)=><div key={index} className="h-72 rounded-media bg-fill"/>)}</div>:null}
      {data&&!error&&data.hits.length===0?<div className="mt-6 rounded-media bg-surface p-6"><h3 className="font-semibold text-ink">No places match this view</h3><p className="mt-2 text-sm text-muted">Try fewer filters, another place name, or a wider region.</p>{filters.page>1?<button className="mt-3 min-h-11 text-sm text-accent-text underline" onClick={()=>change({page:1})}>Back to first page</button>:null}</div>:null}
      {data&&!error?<div className="mt-6 grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">{data.hits.map(hit=><div key={`${hit.kind}:${hit.id}`} className="min-w-0">
        {hit.destination?<DestinationCard {...hit.destination} imageUrl={hit.imageUrl} imageAttribution={hit.destination.hero_image_attribution} imageAttributionUrl={hit.destination.hero_image_attribution_url} imageFocalX={hit.destination.hero_image_focal_x} imageFocalY={hit.destination.hero_image_focal_y} locationLabel={hit.locationLabel} lat={hit.lat} lng={hit.lng}/>:hit.route?<RouteCard route={hit.route} locationLabel={hit.locationLabel} lat={hit.lat} lng={hit.lng}/>:hit.area?<AreaCard area={hit.area} lat={hit.lat} lng={hit.lng}/>:hit.list?<ListCard list={hit.list}/>:null}
        {hit.lat!==null&&hit.lng!==null?<Link href={catalogHref("/map",search,{selected:`${hit.kind}:${hit.id}`,lat:hit.lat,lng:hit.lng,z:hit.kind==="areas"?9:12})} className="mt-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-accent-text">Show on map →</Link>:null}
      </div>)}</div>:null}
      {data&&data.total>data.pageSize?<nav aria-label="Search result pages" className="mt-8 flex items-center justify-center gap-5">{data.page>1?<Link href={catalogHref("/discover",search,{page:data.page-1})} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-ink">Previous</Link>:null}<span className="text-sm text-muted">Page {data.page} of {Math.ceil(data.total/data.pageSize).toLocaleString("en-US")}</span>{data.page*data.pageSize<data.total?<Link href={catalogHref("/discover",search,{page:data.page+1})} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-ink">Next</Link>:null}</nav>:null}
    </section>}
  </div>;
}
