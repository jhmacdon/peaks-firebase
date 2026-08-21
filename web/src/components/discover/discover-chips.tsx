import Link from "next/link";
import { CURATED_POPULAR_DESTINATIONS } from "../../lib/constants";
import { buildDiscoverHref } from "../../lib/discover-search";

/**
 * Six suggested searches under the box.
 *
 * Hand-picked names from constants.ts, not a "most sessions" slice — that
 * slice surfaced obscure zero-activity rows and changed between page loads.
 * Server rendered, so the six links are in the HTML rather than appearing
 * after hydration.
 *
 * These are links, so they get a link's pill rather than the `Chip`
 * component, which is a button for selecting a filter in place.
 */
export function DiscoverChips() {
  if (CURATED_POPULAR_DESTINATIONS.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
        Popular searches
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {CURATED_POPULAR_DESTINATIONS.map((destination) => (
          <Link
            key={destination.id}
            href={buildDiscoverHref("", { query: destination.name, scope: null })}
            className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-2"
          >
            {destination.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
