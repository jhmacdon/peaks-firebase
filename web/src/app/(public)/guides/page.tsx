import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "../../../lib/guides";
import { guideReadingMinutes } from "../../../components/guide-reading";
import { absoluteUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Field guides",
  description: "A little reading before the next day outside. Fire lookouts, mountain ranges, waterfalls, and wilderness, with maps to help you find your way.",
  alternates: { canonical: absoluteUrl("/guides") },
};

export default function GuidesPage() {
  return <div className="mx-auto max-w-[960px] px-6 py-12 sm:py-20">
    <header className="max-w-[680px]">
      <p className="text-sm text-accent-text">The Peaks bookshelf</p>
      <h1 className="mt-5 font-serif text-5xl leading-tight tracking-tight text-ink sm:text-6xl">A little reading.<br />A reason to go.</h1>
      <p className="mt-6 font-serif text-xl leading-[1.8] text-ink-2">There’s more to a place than its pin on a map. Take a few minutes to get to know a corner of the outdoors, and see where you’d like to go.</p>
    </header>
    <div className="mt-12 border-t border-border">
      {GUIDES.map((guide, index) => <article key={guide.slug} className="grid gap-3 border-b border-border py-8 sm:grid-cols-[48px_1fr] sm:gap-6 sm:py-10">
        <span aria-hidden="true" className="font-serif text-xl text-muted">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2 className="font-serif text-[29px] leading-tight text-ink sm:text-4xl"><Link href={guide.href} className="hover:underline">{guide.title}</Link></h2>
          <p className="mt-3 font-serif text-lg italic leading-relaxed text-muted">{guide.subtitle}</p>
          <p className="mt-4 max-w-[62ch] text-base leading-[1.8] text-ink-2">{guide.description}</p>
          <Link href={guide.href} className="mt-3 inline-flex min-h-11 items-center gap-4 text-sm text-accent-text hover:underline">Read the guide <span className="text-muted">{guideReadingMinutes(guide)} min</span><span aria-hidden="true">→</span></Link>
        </div>
      </article>)}
    </div>
  </div>;
}
