import type { Metadata } from "next";
import Link from "next/link";
import ListMap from "../../../../components/list/list-map-embed";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { getWashingtonLookouts } from "../../../../lib/actions/cached-lookouts";
import { buildListJsonLd } from "../../../../lib/json-ld";
import { absoluteUrl, formatFeet } from "../../../../lib/seo";
import {
  WASHINGTON_LOOKOUT_PATH,
  WASHINGTON_LOOKOUT_TITLE,
  WASHINGTON_LOOKOUT_DESCRIPTION,
} from "../../../../lib/washington-lookouts";

// Cache the catalog for an hour; render on request so builds need no live DB.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: WASHINGTON_LOOKOUT_TITLE,
  description: WASHINGTON_LOOKOUT_DESCRIPTION,
  alternates: { canonical: absoluteUrl(WASHINGTON_LOOKOUT_PATH) },
  openGraph: {
    title: WASHINGTON_LOOKOUT_TITLE,
    description: WASHINGTON_LOOKOUT_DESCRIPTION,
    url: absoluteUrl(WASHINGTON_LOOKOUT_PATH),
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: WASHINGTON_LOOKOUT_TITLE,
    description: WASHINGTON_LOOKOUT_DESCRIPTION,
  },
};

export default async function WashingtonLookoutsPage() {
  const lookouts = await getWashingtonLookouts();
  const markers = lookouts.flatMap((lookout) =>
    lookout.lat != null && lookout.lng != null
      ? [{ ...lookout, lat: lookout.lat, lng: lookout.lng, completed: false }]
      : []
  );

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 sm:py-20">
      <JsonLdScript data={buildListJsonLd({
        name: WASHINGTON_LOOKOUT_TITLE,
        url: absoluteUrl(WASHINGTON_LOOKOUT_PATH),
        numberOfItems: lookouts.length,
        items: lookouts.map((lookout) => ({
          name: lookout.name ?? "Unnamed lookout",
          url: absoluteUrl(`/destinations/${encodeURIComponent(lookout.id)}`),
        })),
      })} />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link href="/peaks" className="hover:underline">State guides</Link>
        {" / "}
        <Link href="/peaks/washington" className="hover:underline">Washington</Link>
        {" / Fire lookouts"}
      </nav>
      <h1 className="font-display max-w-[20ch] text-[36px] leading-[1.08] font-[680] tracking-[-0.015em] text-ink sm:text-[52px]">
        Washington state fire lookouts map
      </h1>
      <p className="mt-6 max-w-[65ch] text-lg leading-relaxed text-ink-2">
        Find a lookout for your next day outside. Explore {lookouts.length.toLocaleString("en-US")} fire lookout destinations
        in the Peaks Washington catalog, then open a place guide to see its details and available routes.
      </p>
      <div className="mt-6 flex flex-wrap gap-6 text-sm font-medium text-accent-text">
        <a href="#lookout-map" className="hover:underline">Explore the map ↓</a>
        <a href="#lookout-list" className="hover:underline">Browse all lookouts ↓</a>
        <a href="#plan-a-visit" className="hover:underline">Plan a visit ↓</a>
      </div>

      <section id="lookout-map" aria-labelledby="map-heading" className="mt-12 scroll-mt-24">
        <h2 id="map-heading" className="font-display text-2xl font-semibold text-ink">Find your next lookout</h2>
        <p className="mt-3 mb-5 text-ink-2">Select a marker to open its place guide. Zoom in to explore nearby terrain.</p>
        {markers.length > 0 ? (
          <div className="h-[360px] overflow-hidden rounded-media sm:h-[480px]" aria-label="Map of Washington fire lookout locations">
            <ListMap markers={markers} className="h-full w-full" />
          </div>
        ) : <p className="text-muted">Map coordinates are not yet available. Browse the lookout guides below.</p>}
        <p className="mt-4 max-w-[75ch] text-sm leading-relaxed text-muted">
          This map shows catalog locations, not current access or building status. A marker does not mean a tower is standing,
          open, or available for an overnight stay.
          {markers.length < lookouts.length ? ` ${lookouts.length - markers.length} destinations have no mapped coordinates; their guides remain in the list below.` : ""}
        </p>
      </section>

      <section id="lookout-list" aria-labelledby="list-heading" className="mt-16 scroll-mt-24">
        <h2 id="list-heading" className="font-display text-2xl font-semibold text-ink">Washington fire lookout guides</h2>
        <p className="mt-3 text-ink-2">Browse by name. Elevations describe the destination, not the height of the tower.</p>
        <ul className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {lookouts.map((lookout) => (
            <li key={lookout.id} className="border-b border-hairline py-4">
              <Link href={`/destinations/${encodeURIComponent(lookout.id)}`} className="font-medium text-accent-text hover:underline">
                {lookout.name ?? "Unnamed lookout"}
              </Link>
              {lookout.elevation != null ? <p className="mt-1 text-sm text-muted">{formatFeet(lookout.elevation)}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section id="plan-a-visit" aria-labelledby="visit-heading" className="mt-16 max-w-[70ch] scroll-mt-24 space-y-5 text-ink-2 leading-relaxed">
        <h2 id="visit-heading" className="font-display text-2xl font-semibold text-ink">Before you head out</h2>
        <p>Start with a lookout that catches your eye, then check the route, trailhead, and land manager’s current access notes. A summit elevation alone cannot tell you how hard the hike will be.</p>
        <h3 className="text-lg font-semibold text-ink">Can I visit or stay overnight?</h3>
        <p>Check the rules for the specific lookout before making plans. For example, <a className="text-accent-text underline" href="https://parks.wa.gov/find-parks/state-parks/mount-spokane-state-park/mount-spokane-quartz-mountain-fire-lookout">Quartz Mountain’s official page</a> has its own booking and visitor information. Do not assume those arrangements apply to another lookout.</p>
        <h3 className="text-lg font-semibold text-ink">Where can I check closures?</h3>
        <p>For state-managed land, start with <a className="text-accent-text underline" href="https://www.dnr.wa.gov/recreation">Washington DNR recreation alerts</a>. For other land, check the managing park or national forest before you travel.</p>
        <h3 className="text-lg font-semibold text-ink">Does this include every Washington lookout?</h3>
        <p>This list includes destinations tagged as fire lookouts in Peaks. It is not a complete inventory of standing towers or historic sites. The <a className="text-accent-text underline" href="https://firelookout.org/lookouts/us/wa/">Forest Fire Lookout Association’s Washington inventory</a> is a useful source for lookout history and structure status.</p>
      </section>
      <p className="mt-12"><Link href="/peaks/washington" className="font-medium text-accent-text hover:underline">Explore more of Washington →</Link></p>
    </div>
  );
}
