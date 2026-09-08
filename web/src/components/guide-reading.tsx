import Link from "next/link";
import type { Guide } from "../lib/guides";

export function GuideReading({ guide }: { guide: Guide }) {
  return <div className="max-w-[68ch] space-y-9">
    {guide.sections.map((section) => <section key={section.title}>
      <h2 className="font-display text-2xl font-semibold text-ink">{section.title}</h2>
      <div className="mt-4 space-y-4 text-base leading-[1.8] text-ink-2">
        {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      <p className="mt-3 text-sm text-muted">Read more: <a href={section.source.url} className="underline hover:text-ink">{section.source.label}</a></p>
    </section>)}
    <Link href="/guides" className="inline-block text-sm font-medium text-accent-text hover:underline">More maps and hiking guides →</Link>
  </div>;
}
