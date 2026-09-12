import Link from "next/link";
import ListMap from "./list/list-map-embed";
import { JsonLdScript } from "./json-ld-script";
import { GuideOpening, GuideReading } from "./guide-reading";
import { GUIDES } from "../lib/guides";
import { getStateLookouts } from "../lib/actions/cached-lookouts";
import { buildListJsonLd } from "../lib/json-ld";
import { absoluteUrl, formatFeet } from "../lib/seo";

export async function FireLookoutGuide({ state }: { state: "washington" | "california" }) {
  const guide = GUIDES.find((entry) => entry.slug === `${state}-fire-lookouts`)!;
  const stateName = state === "washington" ? "Washington" : "California";
  const lookouts = await getStateLookouts(state === "washington" ? "WA" : "CA");
  const markers = lookouts.flatMap((lookout) => lookout.lat != null && lookout.lng != null
    ? [{ ...lookout, lat: lookout.lat, lng: lookout.lng, completed: false }] : []);

  return <div className="mx-auto max-w-[1200px] px-6 py-10 sm:py-16">
    <JsonLdScript data={buildListJsonLd({ name: guide.title, url: absoluteUrl(guide.href), numberOfItems: lookouts.length,
      items: lookouts.map((lookout) => ({ name: lookout.name ?? "Unnamed lookout", url: absoluteUrl(`/destinations/${encodeURIComponent(lookout.id)}`) })) })} />
    <article>
      <GuideOpening guide={guide}>
        <a href="#lookout-map" className="inline-flex min-h-11 items-center text-accent-text hover:underline">Map & lookouts ↓</a>
      </GuideOpening>
      <div className="mt-10"><GuideReading guide={guide} /></div>
    </article>
    <section id="lookout-map" aria-labelledby="map-heading" className="mt-14 scroll-mt-24 border-t border-border pt-10">
      <p className="text-sm text-muted">Out in the field</p>
      <h2 id="map-heading" className="mt-3 font-serif text-3xl text-ink">Find a lookout in {stateName}</h2>
      <p className="mt-4 mb-6 max-w-[70ch] leading-relaxed text-ink-2">{lookouts.length.toLocaleString("en-US")} lookout locations to explore. Open a marker for its place guide, or <a href="#lookout-list" className="text-accent-text underline">browse by name</a>.</p>
      {markers.length ? <div className="h-[360px] overflow-hidden rounded-media sm:h-[480px]" aria-label={`Map of ${stateName} fire lookout locations`}>
        <ListMap markers={markers} className="h-full w-full" />
      </div> : <p className="text-muted">Map coordinates are not yet available. Browse the lookout guides below.</p>}
      <p className="mt-4 max-w-[75ch] text-sm leading-relaxed text-muted">These are lookout sites in Peaks; a marker alone doesn’t tell you whether a tower still stands or welcomes visitors. Check the land manager’s current notes before you go.
        {markers.length < lookouts.length ? ` ${lookouts.length - markers.length} sites have no map coordinates and appear only in the list.` : ""}
      </p>
    </section>
    <section id="lookout-list" aria-labelledby="list-heading" className="mt-12 scroll-mt-24">
      <h2 id="list-heading" className="font-serif text-3xl text-ink">Lookouts by name</h2>
      <p className="mt-3 text-sm text-muted">Elevations refer to the site above sea level.</p>
      <ul className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
        {lookouts.map((lookout) => <li key={lookout.id} className="border-b border-hairline py-4">
          <Link href={`/destinations/${encodeURIComponent(lookout.id)}`} className="font-medium text-accent-text hover:underline">{lookout.name ?? "Unnamed lookout"}</Link>
          {lookout.elevation != null ? <p className="mt-1 text-sm text-muted">{formatFeet(lookout.elevation)}</p> : null}
        </li>)}
      </ul>
    </section>
    <p className="mt-10"><Link href={`/peaks/${state}`} className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">More of {stateName} →</Link></p>
  </div>;
}
