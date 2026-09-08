import type { ListDestination, ListCompletionEntry } from "./actions/lists";
import { formatRegion } from "./regions";

export function filterListRoster(destinations: readonly ListDestination[], options: {
  query: string;
  status: "all" | "reached" | "remaining";
  sort: "list" | "name" | "elevation";
  entries: Record<string, ListCompletionEntry> | null;
}): ListDestination[] {
  const query = options.query.trim().toLocaleLowerCase("en-US");
  return destinations.filter((place) => {
    const searchable = [place.name, place.state_code, place.country_code, formatRegion(place.state_code, place.country_code)]
      .filter(Boolean).join(" ").toLocaleLowerCase("en-US");
    if (query && !searchable.includes(query)) return false;
    if (options.status === "all" || !options.entries) return true;
    return options.status === "reached" ? Boolean(options.entries[place.id]) : !options.entries[place.id];
  }).sort((a, b) => {
    if (options.sort === "name") return (a.name ?? "").localeCompare(b.name ?? "");
    if (options.sort === "elevation") return (b.elevation ?? -Infinity) - (a.elevation ?? -Infinity) || a.ordinal - b.ordinal;
    return a.ordinal - b.ordinal;
  });
}
