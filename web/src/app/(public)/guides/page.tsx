import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "../../../lib/guides";
import { absoluteUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Mountain maps and hiking guides",
  description: "Maps and practical reading for Colorado 14ers, state high points, Cascade volcanoes, Washington waterfalls, and Alpine Lakes Wilderness.",
  alternates: { canonical: absoluteUrl("/guides") },
};

export default function GuidesPage() {
  return <div className="mx-auto max-w-[1200px] px-6 py-12 sm:py-20">
    <h1 className="font-display max-w-[22ch] text-4xl leading-tight font-semibold text-ink sm:text-5xl">Where do you want to go?</h1>
    <p className="mt-6 max-w-[62ch] text-lg leading-[1.8] text-ink-2">Pick a mountain list to work through, a waterfall to walk to, or a part of the map you have been meaning to explore. These guides put the places in context before you choose a route.</p>
    <div className="mt-12 grid gap-x-16 gap-y-12 md:grid-cols-2">
      {GUIDES.map((guide) => <article key={guide.slug}>
        <h2 className="font-display text-2xl font-semibold text-ink"><Link href={guide.href} className="hover:underline">{guide.title}</Link></h2>
        <p className="mt-4 max-w-[54ch] leading-[1.8] text-ink-2">{guide.intro}</p>
        <Link href={guide.href} className="mt-4 inline-block text-sm font-medium text-accent-text hover:underline">Read the guide and open the map →</Link>
      </article>)}
    </div>
  </div>;
}
