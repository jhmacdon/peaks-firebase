"use client";

import { searchCatalogRoutes } from "../lib/actions/routes";
import CatalogPicker from "./catalog-picker";

async function search(query: string) {
  return (await searchCatalogRoutes(query, 20)).map((route) => ({
    id: route.id,
    name: route.name || "Unnamed route",
    detail: [route.distance == null ? null : `${(route.distance / 1609.34).toFixed(1)} mi`, route.gain == null ? null : `${Math.round(route.gain * 3.28084).toLocaleString()} ft gain`].filter(Boolean).join(" · "),
  }));
}

export default function RoutePicker({ selectedIds, onChange, selectedRoutes }: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  selectedRoutes?: { id: string; name: string }[];
}) {
  return <CatalogPicker label="Routes" selectedIds={selectedIds} selectedItems={selectedRoutes} onChange={onChange} search={search} />;
}
