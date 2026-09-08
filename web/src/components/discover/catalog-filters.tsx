"use client";

import { useState } from "react";
import { allUsStateCodes, subdivisionName } from "../../lib/regions";
import { parseCatalogFilters } from "../../lib/catalog-search";

export function CatalogFilters({ search, onChange, compact = false }: {
  search: string;
  onChange: (changes: Record<string, string | number | null>) => void;
  compact?: boolean;
}) {
  const filters = parseCatalogFilters(search);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const control = "min-h-11 w-full rounded-ctl border border-border bg-page px-3 text-sm text-ink";
  function locate() {
    if (!navigator.geolocation) { setLocationError("Location is unavailable. Choose a state instead."); return; }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(position => {
      setLocating(false);
      onChange({nearLat:position.coords.latitude.toFixed(5),nearLng:position.coords.longitude.toFixed(5),state:null,area:null,sort:"nearest"});
    },()=>{setLocating(false);setLocationError("Couldn't find your location. Choose a state or try again.");},{timeout:10000,maximumAge:600000});
  }
  const fields = [
    {label:"Activity",key:"activity",value:filters.activity,route:false,options:[["","Any activity"],["hiking","Hiking"],["skiing","Skiing"],["motorized","Motorized"]]},
    {label:"Route distance",key:"maxDistance",value:filters.maxDistance??"",route:true,options:[["","Any distance"],["3","Up to 3 mi"],["5","Up to 5 mi"],["10","Up to 10 mi"],["20","Up to 20 mi"],["50","Up to 50 mi"]]},
    {label:"Elevation gain",key:"maxGain",value:filters.maxGain??"",route:true,options:[["","Any gain"],["500","Up to 500 ft"],["1000","Up to 1,000 ft"],["2000","Up to 2,000 ft"],["4000","Up to 4,000 ft"]]},
    {label:"Estimated effort",key:"difficulty",value:filters.difficulty,route:true,options:[["","Any effort"],["easy","Easy"],["moderate","Moderate"],["hard","Hard"],["strenuous","Strenuous"]]},
    {label:"Sort",key:"sort",value:filters.sort,route:false,options:[["relevance","Best match"],...(filters.nearLat!==null?[["nearest","Nearest"]]:[]),["distance","Shortest route"],["elevation","Highest peak"],["name","Name"]]},
  ];
  return <div className="space-y-3">
    <div className={`grid gap-3 ${compact?"grid-cols-1":"grid-cols-[minmax(0,1fr)_auto]"}`}>
      <label className="block min-w-0 text-xs font-medium text-muted">Where do you want to go?
        <select aria-label="Choose a state" value={filters.state} onChange={event=>onChange({state:event.target.value,nearLat:null,nearLng:null,area:null,sort:"relevance"})} className={`${control} mt-1.5`}>
          <option value="">{filters.nearLat!==null?"Within 50 miles of you":"All locations"}</option>
          {allUsStateCodes().map(code=><option key={code} value={code}>{subdivisionName("US",code)}</option>)}
        </select>
      </label>
      <button type="button" disabled={locating} onClick={locate} className="min-h-11 self-end rounded-ctl border border-border px-4 text-sm font-medium text-accent-text hover:bg-fill disabled:opacity-60">{locating?"Finding you…":"Use my location"}</button>
    </div>
    {locationError?<p role="alert" className="text-sm text-alert">{locationError}</p>:null}
    {filters.area?<div className="flex items-center justify-between gap-3 rounded-ctl bg-fill px-3 py-2 text-sm"><span>Within this protected area</span><button type="button" className="min-h-9 text-accent-text underline" onClick={()=>onChange({area:null})}>Clear</button></div>:null}
    {filters.nearLat!==null?<div className="flex items-center justify-between gap-3 text-sm text-muted"><span>Within 50 miles of your chosen location</span><button type="button" className="min-h-9 text-accent-text underline" onClick={()=>onChange({nearLat:null,nearLng:null,sort:"relevance"})}>Clear location</button></div>:null}
    <details><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink">Filters & sort{filters.activity||filters.difficulty||filters.maxDistance||filters.maxGain?" · applied":""}</summary>
      <div className={`grid gap-3 pt-2 ${compact?"grid-cols-2":"sm:grid-cols-3 lg:grid-cols-5"}`}>
        {fields.map(field=><label key={field.key} className="text-xs text-muted">{field.label}<select className={`${control} mt-1.5`} value={field.value} onChange={event=>onChange({[field.key]:event.target.value,...(field.route?{type:"routes"}:{})})}>{field.options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}
      </div>
      {filters.difficulty?<p className="mt-3 text-xs leading-5 text-muted">Effort estimates use distance and gain. Read the guide for terrain, exposure, and current conditions.</p>:null}
    </details>
  </div>;
}
