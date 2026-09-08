"use client";

import { searchDestinations } from "../lib/actions/search";
import CatalogPicker from "./catalog-picker";

async function search(query: string) {
  return (await searchDestinations(query)).map((place) => ({
    id: place.id,
    name: place.name || "Unnamed place",
    detail: [place.elevation == null ? null : `${Math.round(place.elevation * 3.28084).toLocaleString()} ft`, ...place.features].filter(Boolean).join(" · "),
  }));
}

export default function DestinationPicker({ selectedIds, onChange, selectedDestinations }: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  selectedDestinations?: { id: string; name: string }[];
}) {
  return <CatalogPicker label="Places" selectedIds={selectedIds} selectedItems={selectedDestinations} onChange={onChange} search={search} />;
}
