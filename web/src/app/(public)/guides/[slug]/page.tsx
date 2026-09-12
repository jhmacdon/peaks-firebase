import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES } from "../../../../lib/guides";
import { getWashingtonWaterfalls } from "../../../../lib/actions/cached-guides";
import { absoluteUrl } from "../../../../lib/seo";
import { buildListJsonLd } from "../../../../lib/json-ld";
import { JsonLdScript } from "../../../../components/json-ld-script";
import { GuideOpening, GuideReading } from "../../../../components/guide-reading";
import ListMap from "../../../../components/list/list-map-embed";

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDES.find((entry) => entry.slug === slug);
  if (!guide || guide.href !== `/guides/${slug}`) return { title: "Guide not found", robots: { index: false } };
  return {
    title: guide.title, description: guide.description,
    alternates: { canonical: absoluteUrl(guide.href) },
    openGraph: { title: guide.title, description: guide.description, url: absoluteUrl(guide.href), type: "website" },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = GUIDES.find((entry) => entry.slug === slug);
  if (!guide || guide.href !== `/guides/${slug}`) notFound();
  const destinations = await getWashingtonWaterfalls();
  const markers = destinations.flatMap((place) => place.lat != null && place.lng != null
    ? [{ ...place, lat: place.lat, lng: place.lng, completed: false }] : []);
  return <div className="mx-auto max-w-[1200px] px-6 py-12 sm:py-20">
    <JsonLdScript data={buildListJsonLd({ name: guide.title, url: absoluteUrl(guide.href), numberOfItems: destinations.length,
      items: destinations.map((place) => ({ name: place.name, url: absoluteUrl(`/destinations/${encodeURIComponent(place.id)}`) })) })} />
    <article>
      <GuideOpening guide={guide}>
        <a href="#waterfall-map" className="inline-flex min-h-11 items-center text-accent-text hover:underline">Map & waterfalls ↓</a>
      </GuideOpening>
      <div className="mt-10"><GuideReading guide={guide} /></div>
    </article>
    <section id="waterfall-map" className="mt-14 scroll-mt-24 border-t border-border pt-10" aria-labelledby="map-title">
      <h2 id="map-title" className="font-serif text-3xl text-ink">Find a waterfall</h2>
      <p className="mt-3 mb-5 text-ink-2">{destinations.length.toLocaleString("en-US")} named waterfalls in Peaks. Select a marker to open its place guide, or <a href="#waterfalls" className="text-accent-text underline">browse the names below</a>.</p>
      {markers.length ? <div className="h-[360px] overflow-hidden rounded-media sm:h-[480px]"><ListMap markers={markers} className="h-full w-full" /></div> : <p>Coordinates are not available. The place guides remain listed below.</p>}
      {markers.length < destinations.length ? <p className="mt-3 text-sm text-muted">{destinations.length - markers.length} {destinations.length - markers.length === 1 ? "place has no map coordinates and appears" : "places have no map coordinates and appear"} only in the list.</p> : null}
    </section>
    <section id="waterfalls" className="mt-12 scroll-mt-24" aria-labelledby="waterfalls-title">
      <h2 id="waterfalls-title" className="font-serif text-3xl text-ink">Waterfalls by name</h2>
      <ul className="mt-6 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((place) => <li key={place.id} className="border-b border-hairline py-3"><Link href={`/destinations/${encodeURIComponent(place.id)}`} className="text-accent-text hover:underline">{place.name}</Link></li>)}
      </ul>
    </section>
  </div>;
}
