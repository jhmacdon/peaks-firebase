import { StatCluster } from "../ui/stat";
import { DiscoverSection } from "./discover-section";
import type { DiscoverStats } from "../../lib/actions/search";

/**
 * What the catalog holds. Four numerals on flat ground — the bordered rail
 * of bordered stat cards this replaced broke both "no box inside a box" and
 * "never box a stat" at once (design-tokens.md laws 1 and 2).
 *
 * Read on the server, so the numbers arrive with the page instead of
 * counting up from a hydrated zero. If the counts fail to load the section
 * is dropped rather than printed as zeroes, which would claim an empty
 * catalog — the same rule the landing page follows.
 */
export function DiscoverCatalogStats({ stats }: { stats: DiscoverStats | null }) {
  if (!stats) return null;

  return (
    <DiscoverSection id="catalog" title="In the catalog">
      <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4">
        <StatCluster
          scale="page"
          value={stats.destinationCount.toLocaleString("en-US")}
          label="Destinations"
        />
        <StatCluster
          scale="page"
          value={stats.areaCount.toLocaleString("en-US")}
          label="Protected areas"
        />
        <StatCluster
          scale="page"
          value={stats.routeCount.toLocaleString("en-US")}
          label="Routes"
        />
        <StatCluster
          scale="page"
          value={stats.listCount.toLocaleString("en-US")}
          label="Curated lists"
        />
      </div>
    </DiscoverSection>
  );
}
