import DestinationCard from "../destination-card";
import { EmptyState } from "../ui/empty-state";
import { DISCOVER_GRID, DiscoverSection } from "./discover-section";
import type { PopularDestinationsResult } from "../../lib/actions/search";

/**
 * The most-recorded destinations in the catalog.
 *
 * `isFallback` is the honesty switch from the popularity work: when too few
 * destinations clear the minimum session count, the query tops the list up
 * with photographed ones, and this section says so by changing its name
 * rather than calling a filler list "Popular".
 */
export function DiscoverPopular({ destinations, isFallback }: PopularDestinationsResult) {
  return (
    <DiscoverSection
      id="popular-destinations"
      title={isFallback ? "Worth a look" : "Popular destinations"}
      description={
        isFallback
          ? "Destination guides with photos, while more recorded activity comes in."
          : "The most recorded mountain and destination guides in Peaks."
      }
    >
      {destinations.length === 0 ? (
        <EmptyState>No popular destinations yet</EmptyState>
      ) : (
        <div className={DISCOVER_GRID}>
          {destinations.map((dest) => (
            <DestinationCard
              key={dest.id}
              id={dest.id}
              name={dest.name}
              elevation={dest.elevation}
              features={dest.features}
            />
          ))}
        </div>
      )}
    </DiscoverSection>
  );
}
