import RouteCard from "../route-card";
import { EmptyState } from "../ui/empty-state";
import { DISCOVER_GRID, DiscoverSection } from "./discover-section";
import type { SearchRouteResult } from "../../lib/actions/search";

export function DiscoverRoutes({ routes }: { routes: SearchRouteResult[] }) {
  return (
    <DiscoverSection
      id="featured-routes"
      title="Featured routes"
      description="Public route pages with distance, gain, maps, and segment detail."
    >
      {routes.length === 0 ? (
        <EmptyState>No published routes yet</EmptyState>
      ) : (
        <div className={DISCOVER_GRID}>
          {routes.map((route) => (
            <RouteCard key={route.id} route={route} />
          ))}
        </div>
      )}
    </DiscoverSection>
  );
}
