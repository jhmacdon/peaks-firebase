"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getDestinationsInViewport, getRoutesInViewport, type SearchDestination, type ViewportRoute } from "../../../lib/actions/search";
import { getCatalogSelection, searchCatalog } from "../../../lib/actions/catalog-search";
import { catalogHref, hasCatalogSelection, parseCatalogFilters, parseCatalogSelection } from "../../../lib/catalog-search";
import { catalogHitHref, type CatalogHit, type CatalogPage } from "../../../lib/catalog-results";
import { buildExploreResults, catalogHitToExploreResult, type ExploreResult } from "../../../lib/explore-results";
import { DEFAULT_MAP_VIEW, MAP_TYPES, ROUTE_MIN_ZOOM, VIEWPORT_DESTINATION_LIMIT, VIEWPORT_ROUTE_LIMIT, clampViewportBounds, destinationFeatureFilter, destinationTypesSelected, mapExploreHref, parseMapExploreUrl, routesSelected, toggleMapType, type MapTypeId } from "../../../lib/map-view";
import { getRouteTraversalMetrics } from "../../../lib/route-guide";
import { ExploreChips } from "../../../components/explore/explore-chips";
import { ExploreControls } from "../../../components/explore/explore-controls";
import { ExplorePanel } from "../../../components/explore/explore-panel";
import type { ExploreMapHandle, MapDestination, MapRoute, MapViewport } from "../../../components/explore-map";

const ExploreMap = dynamic(()=>import("../../../components/explore-map"),{ssr:false,loading:()=> <div className="flex h-full items-center justify-center bg-fill text-sm text-muted">Loading map…</div>});
const filterQuery=(search:string)=>catalogHref("/discover",search).split("?")[1]??"";
const resultSelection=(result:ExploreResult)=>`${result.kind==="destination"?"destinations":result.kind==="route"?"routes":result.kind==="area"?"areas":"lists"}:${result.id}`;

export default function MapPage() {
  return <div className="relative h-[calc(100dvh-var(--chrome-top-h)-var(--chrome-bottom-h))] overflow-hidden bg-fill md:h-[calc(100dvh-var(--chrome-h))]"><Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>}><MapExplorer/></Suspense></div>;
}

function MapExplorer() {
  const params=useSearchParams();
  const router=useRouter();
  const [initial]=useState(()=>({map:parseMapExploreUrl(params.toString()),filters:filterQuery(params.toString()),selected:params.get("selected")}));
  const [filterSearch,setFilterSearch]=useState(initial.filters);
  const filters=useMemo(()=>parseCatalogFilters(filterSearch),[filterSearch]);
  const catalogActive=hasCatalogSelection(filters);
  const [query,setQuery]=useState(filters.query);
  const [types,setTypes]=useState<MapTypeId[]>(initial.map.types);
  const [viewport,setViewport]=useState<MapViewport|null>(null);
  const [destinations,setDestinations]=useState<SearchDestination[]>([]);
  const [routes,setRoutes]=useState<ViewportRoute[]>([]);
  const [catalog,setCatalog]=useState<{key:string;page:CatalogPage}|null>(null);
  const [viewportLoading,setViewportLoading]=useState(false);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [error,setError]=useState("");
  const [tileError,setTileError]=useState(false);
  const [retry,setRetry]=useState(0);
  const [selected,setSelected]=useState<string|null>(initial.selected);
  const [selection,setSelection]=useState<CatalogHit|null>(null);
  const [focusRequest,setFocusRequest]=useState(0);
  const [hovered,setHovered]=useState<ExploreResult|null>(null);
  const [basemap,setBasemap]=useState<"topo"|"satellite">("topo");
  const [sheetOpen,setSheetOpen]=useState(false);
  const [locating,setLocating]=useState(false);
  const [ready,setReady]=useState(false);
  const mapRef=useRef<ExploreMapHandle|null>(null);
  const lastFocus=useRef("");
  const followSearch=useRef(!initial.map.view&&!initial.selected);
  const latitude=viewport?.centerLat??initial.map.view?.lat??DEFAULT_MAP_VIEW.lat;
  const longitude=viewport?.centerLng??initial.map.view?.lng??DEFAULT_MAP_VIEW.lng;
  const typesKey=types.join(",");
  const viewportKey=viewport?[viewport.minLat,viewport.maxLat,viewport.minLng,viewport.maxLng,viewport.zoom].map(n=>n.toFixed(3)).join(","):"";
  const viewportRef=useRef(viewport);
  viewportRef.current=viewport;
  const typesRef=useRef(types);
  typesRef.current=types;

  const changeFilters=useCallback((changes:Record<string,string|number|null>)=>{
    setFilterSearch(current=>filterQuery(catalogHref("/discover",current,changes)));
    if(changes.q!==undefined)setQuery(String(changes.q??""));
    if(Object.keys(changes).some(key=>key!=="page")) {
      setSelected(null);
      followSearch.current=true;
    }
  },[]);
  useEffect(()=>{
    if(query.trim()===filters.query)return;
    const timer=setTimeout(()=>changeFilters({q:query}),300);
    return ()=>clearTimeout(timer);
  },[query,filters.query,changeFilters]);

  useEffect(()=>{
    if(!catalogActive)return;
    let cancelled=false;
    setCatalogLoading(true);
    setError("");
    searchCatalog(filterSearch).then(page=>{
      if(cancelled)return;
      setCatalog({key:filterSearch,page});
      if(followSearch.current) {
        const first=page.hits.find(hit=>hit.lat!==null&&hit.lng!==null);
        if(first){followSearch.current=false;setSelected(`${first.kind}:${first.id}`);}
      }
    }).catch(()=>{if(!cancelled)setError("We couldn't load these results. Your filters are saved; try again.");}).finally(()=>{if(!cancelled)setCatalogLoading(false);});
    return ()=>{cancelled=true;};
  },[catalogActive,filterSearch,retry]);

  useEffect(()=>{
    const bounds=viewportRef.current;
    if(!bounds||catalogActive)return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      setViewportLoading(true);
      setError("");
      const selectedTypes=typesRef.current;
      const read={...clampViewportBounds(bounds),centerLat:bounds.centerLat,centerLng:bounds.centerLng};
      Promise.all([
        destinationTypesSelected(selectedTypes).length?getDestinationsInViewport({...read,features:destinationFeatureFilter(selectedTypes)}):Promise.resolve([]),
        routesSelected(selectedTypes)&&bounds.zoom>=ROUTE_MIN_ZOOM?getRoutesInViewport(read):Promise.resolve([]),
      ]).then(([nextDestinations,nextRoutes])=>{if(!cancelled){setDestinations(nextDestinations);setRoutes(nextRoutes);}})
        .catch(()=>{if(!cancelled){setDestinations([]);setRoutes([]);setError("We couldn't load this part of the map. Try again.");}})
        .finally(()=>{if(!cancelled)setViewportLoading(false);});
    },300);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[viewportKey,typesKey,catalogActive,retry]);

  useEffect(()=>{
    if(!selected){setSelection(null);return;}
    let cancelled=false;
    setSelection(null);
    getCatalogSelection(selected).then(hit=>{if(!cancelled)setSelection(hit);})
      .catch(()=>{if(!cancelled)setError("We couldn't open this guide on the map. Try again.");});
    return ()=>{cancelled=true;};
  },[selected,retry]);

  const hits=catalog?.key===filterSearch?catalog.page.hits:[];
  const selectedHits=selection?[...hits.filter(hit=>hit.id!==selection.id||hit.kind!==selection.kind),selection]:hits;
  const mapDestinations=useMemo<MapDestination[]>(()=>{
    const source=catalogActive?selectedHits.flatMap(hit=>hit.destination?[hit.destination]:[]):destinations;
    const result:MapDestination[]=source.filter(d=>d.lat!==null&&d.lng!==null).map(d=>({id:d.id,name:d.name,elevation:d.elevation,lat:d.lat!,lng:d.lng!,features:d.features}));
    for (const area of selectedHits.filter(hit=>hit.area&&hit.lat!==null&&hit.lng!==null)) {
      result.push({id:area.id,name:area.name,elevation:null,lat:area.lat!,lng:area.lng!,features:[],catalogKind:"areas"});
    }
    if(!catalogActive&&selection?.destination&&selection.lat!==null&&selection.lng!==null&&!result.some(d=>d.id===selection.id))result.push({...selection.destination,lat:selection.lat,lng:selection.lng});
    return result;
  // selectedHits is built from these two stable sources.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[catalogActive,catalog,filterSearch,destinations,selection]);
  const mapRoutes=useMemo<MapRoute[]>(()=>{
    const result:MapRoute[]=catalogActive?selectedHits.flatMap(hit=>{
      if(!hit.route)return [];
      const metrics=getRouteTraversalMetrics(hit.route);
      return [{id:hit.id,name:hit.name,polyline6:hit.polyline6??null,distance:metrics.distanceMeters,gain:metrics.gainMeters}];
    }):routes.map(route=>{const metrics=getRouteTraversalMetrics({...route,gain_loss:route.gain_loss??null,shape:route.shape??null});return {...route,distance:metrics.distanceMeters,gain:metrics.gainMeters};});
    if(!catalogActive&&selection?.route&&!result.some(r=>r.id===selection.id)) {
      const metrics=getRouteTraversalMetrics(selection.route);
      return [...result,{id:selection.id,name:selection.name,polyline6:selection.polyline6??null,distance:metrics.distanceMeters,gain:metrics.gainMeters}];
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[catalogActive,catalog,filterSearch,routes,selection]);

  useEffect(()=>{
    if(!ready||!selection||!mapRef.current)return;
    const focusKey=`${selected}:${focusRequest}`;
    if(lastFocus.current===focusKey)return;
    lastFocus.current=focusKey;
    if(selection.bounds)mapRef.current.focusBounds(selection.bounds);
    else if(selection.route&&selection.polyline6)mapRef.current.focusRoute(selection.id);
    else if(selection.lat!==null&&selection.lng!==null)mapRef.current.openDestination(selection.id,selection.lat,selection.lng);
  },[ready,selection,selected,focusRequest,mapRoutes]);

  useEffect(()=>{
    if(!viewport)return;
    window.history.replaceState(null,"",mapExploreHref({view:{lat:viewport.centerLat,lng:viewport.centerLng,zoom:viewport.zoom},types,query:filters.query,search:filterSearch,selected}));
  },[viewport,types,filters.query,filterSearch,selected]);

  const onReady=useCallback((handle:ExploreMapHandle)=>{mapRef.current=handle;setReady(true);},[]);
  const onViewport=useCallback((next:MapViewport)=>setViewport(next),[]);
  const clearSelection=useCallback(()=>setSelected(null),[]);
  const onDestination=useCallback((destination:MapDestination)=>setSelected(`${destination.catalogKind??"destinations"}:${destination.id}`),[]);
  const onRoute=useCallback((route:MapRoute)=>setSelected(`routes:${route.id}`),[]);
  const pick=useCallback((result:ExploreResult)=>{
    if(result.kind==="list"){router.push(result.href??`/lists/${encodeURIComponent(result.id)}`);return;}
    setSelected(resultSelection(result));setFocusRequest(n=>n+1);setSheetOpen(false);
  },[router]);
  const locate=useCallback(()=>{
    if(!navigator.geolocation){setError("Location is unavailable. Choose a state in the location controls.");return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position=>{setLocating(false);setError("");changeFilters({nearLat:position.coords.latitude.toFixed(5),nearLng:position.coords.longitude.toFixed(5),state:null,area:null,sort:"nearest"});mapRef.current?.showUserLocation(position.coords.latitude,position.coords.longitude);},()=>{setLocating(false);setError("Couldn't find your location. Choose a state or try again.");},{timeout:10000,maximumAge:600000});
  },[changeFilters]);

  const results=catalogActive?hits.map(hit=>catalogHitToExploreResult(hit,latitude,longitude)):buildExploreResults({destinations,routes,centerLat:latitude,centerLng:longitude});
  const loading=!error&&(catalogActive?catalogLoading||catalog?.key!==filterSearch:viewportLoading||!viewport);
  const page=catalog?.key===filterSearch?catalog.page:null;
  const capped=!catalogActive&&(destinations.length>=VIEWPORT_DESTINATION_LIMIT||routes.length>=VIEWPORT_ROUTE_LIMIT);
  const countLine=error?"Results unavailable":loading?"Finding places…":catalogActive&&page?`${page.total.toLocaleString("en-US")} results · page ${page.page} of ${Math.max(1,Math.ceil(page.total/page.pageSize))}`:capped?"Closest places in view":`${results.length} results in view`;
  const selectedKind=parseCatalogSelection(selected)?.kind;
  const hint=!catalogActive&&routesSelected(types)&&(viewport?.zoom??0)<ROUTE_MIN_ZOOM?"Zoom in to see route lines.":catalogActive?"The map shows this page of results. Use Next to see more.":null;
  const footer=<div className="border-t border-hairline p-4"><Link href={catalogHref("/discover",filterSearch)} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text">List view →</Link>{page&&page.page>1&&page.hits.length===0?<button onClick={()=>changeFilters({page:1})} className="block min-h-11 text-sm font-medium text-accent-text underline">Back to first page</button>:null}{page&&page.total>page.pageSize?<nav aria-label="Map result pages" className="mt-2 flex justify-between gap-3"><button disabled={page.page<=1} onClick={()=>changeFilters({page:page.page-1})} className="min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40">Previous</button><button disabled={page.page*page.pageSize>=page.total} onClick={()=>changeFilters({page:page.page+1})} className="min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40">Next</button></nav>:null}</div>;
  const selectionPreview=selection?<div className="m-4 rounded-media border border-accent/40 bg-accent/5 p-4"><div className="flex items-start justify-between gap-3"><span className="text-xs font-medium text-accent-text">Selected {selectedKind==="areas"?"area":selectedKind==="routes"?"route":"place"}</span><button onClick={clearSelection} aria-label="Clear selected guide" className="-mr-2 -mt-2 h-11 w-11 text-lg text-muted">×</button></div><Link href={catalogHitHref(selection)} className="block text-base font-semibold text-ink">{selection.name}</Link>{selection.locationLabel?<p className="mt-1 text-sm text-muted">{selection.locationLabel}</p>:null}<Link href={catalogHitHref(selection)} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-text">Open guide →</Link></div>:null;
  const panel=(showHeading:boolean)=><ExplorePanel showHeading={showHeading} countLine={countLine} hint={hint} loading={loading} query={query} onQueryChange={setQuery} searching={catalogLoading} searchActive={catalogActive} results={results} selectedId={selection?.id??null} onPick={pick} onHover={setHovered} filterSearch={filterSearch} onFiltersChange={changeFilters} error={error} onRetry={()=>setRetry(n=>n+1)} footer={footer} selection={selectionPreview}/>;

  return <>
    <div className="absolute inset-0 z-0"><ExploreMap destinations={mapDestinations} routes={mapRoutes} areaBoundary={selection?.boundary} basemap={basemap} selectedDestinationId={selectedKind==="destinations"||selectedKind==="areas"?selection?.id??null:null} selectedRouteId={selectedKind==="routes"?selection?.id??null:null} hoveredDestinationId={hovered?.kind==="destination"||hovered?.kind==="area"?hovered.id:null} hoveredRouteId={hovered?.kind==="route"?hovered.id:null} showRouteAttribution={routes.some(route=>route.provenance?.contains_osm_geometry)||hits.some(hit=>hit.route?.provenance?.contains_osm_geometry)||Boolean(selection?.route?.provenance?.contains_osm_geometry)} initialView={initial.map.view} autoLocate={false} onTileStatus={setTileError} onReady={onReady} onViewportChange={onViewport} onSelectDestination={onDestination} onSelectRoute={onRoute} onClearSelection={clearSelection}/></div>
    {tileError?<div role="alert" className="absolute left-3 right-16 top-28 z-20 rounded-media border border-border bg-page p-3 text-sm shadow-float md:left-[26rem] md:right-24 md:top-20"><p>Some map tiles could not load.</p><button type="button" onClick={()=>mapRef.current?.retryTiles()} className="min-h-11 font-medium text-accent-text underline">Retry map</button><span className="mx-2 text-muted">or switch map style.</span></div>:null}
    <aside aria-label="Map results" className="absolute bottom-5 left-5 top-5 z-20 hidden w-[380px] flex-col overflow-hidden rounded-media border border-border bg-page shadow-float md:flex">{panel(true)}</aside>
    <h1 className="sr-only md:hidden">Explore the map</h1>
    {!catalogActive?<ExploreChips types={types} onToggle={id=>setTypes(current=>toggleMapType(current,id))} onSelectAll={()=>setTypes(MAP_TYPES.map(type=>type.id))} className="absolute left-3 right-3 top-3 z-20 md:left-[26rem] md:right-24 md:top-5"/>:<Link href={catalogHref("/discover",filterSearch)} className="absolute left-3 top-3 z-20 inline-flex min-h-11 items-center rounded-full border border-border bg-page px-4 text-sm font-semibold text-accent-text shadow-float md:left-[26rem] md:top-5">List view</Link>}
    <ExploreControls onZoomIn={()=>mapRef.current?.zoomIn()} onZoomOut={()=>mapRef.current?.zoomOut()} onLocate={locate} locating={locating} basemap={basemap} onToggleBasemap={()=>setBasemap(current=>current==="topo"?"satellite":"topo")} className="absolute right-3 top-16 z-20 md:right-5 md:top-5"/>
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">{sheetOpen?<div className="pointer-events-auto flex h-[min(65dvh,calc(100dvh-160px))] flex-col overflow-hidden rounded-t-media border-x border-t border-border bg-page shadow-float"><button type="button" onClick={()=>setSheetOpen(false)} aria-expanded="true" aria-label="Collapse results" className="flex min-h-11 w-full shrink-0 items-center justify-center"><span className="h-1 w-9 rounded-full bg-border"/></button>{panel(false)}</div>:<div className="p-3"><button type="button" onClick={()=>setSheetOpen(true)} aria-expanded="false" className="pointer-events-auto flex min-h-16 w-full flex-col items-center gap-2 rounded-media border border-border bg-page px-4 py-3 text-left shadow-float"><span className="h-1 w-9 rounded-full bg-border"/><span className="flex w-full items-center justify-between gap-3"><span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{selection?.name||query||"Search peaks, parks, and routes"}</span><span className="text-xs text-muted">{error?"Try again":loading?"Loading…":`${results.length} shown`}</span></span></button></div>}</div>
  </>;
}
