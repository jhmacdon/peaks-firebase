import type { SavedDestination } from "./actions/saved-destinations";
import type { PublicPlanBundle } from "./public-plan";

export type SavedSort = "recent" | "name" | "elevation";

export function selectSavedDestinations(items: SavedDestination[], query: string, sort: SavedSort) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) =>
    [item.name, item.location, ...item.features].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)
  ).sort((a, b) => {
    if (sort === "name") return (a.name ?? "").localeCompare(b.name ?? "");
    if (sort === "elevation") return (b.elevation ?? -Infinity) - (a.elevation ?? -Infinity);
    return b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id);
  });
}

export function tripPrefill(params: Pick<URLSearchParams, "get">) {
  const routeId = params.get("route") || params.get("routeId") || "";
  const destinationId = params.get("destination") || params.get("destinationId") || "";
  const validId = (value: string) => value.length <= 1500 && !value.includes("/") ? value.trim() : "";
  return {
    routeId: validId(routeId),
    destinationId: validId(destinationId),
    sourceTripId: validId(params.get("fromTrip") || ""),
    name: (params.get("name") || "").trim().slice(0, 120),
  };
}

/** Start a new itinerary from public catalog records, with no personal fields. */
export function sharedTripPrefill(bundle: PublicPlanBundle) {
  return {
    name: (bundle.plan.name || "Trip idea").trim().slice(0, 120),
    destinations: bundle.destinations.map(({ id, name }) => ({ id, name: name || "Selected place" })),
    routes: bundle.routes.filter((route) => route.isCatalog).map(({ id, name }) => ({ id, name: name || "Selected route" })),
  };
}

export function tripGroup(date: string | null, today: string): "Upcoming" | "Ideas" | "Past" {
  if (!date) return "Ideas";
  return date >= today ? "Upcoming" : "Past";
}
