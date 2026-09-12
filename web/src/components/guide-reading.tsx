import Link from "next/link";
import type { Guide } from "../lib/guides";

export function guideReadingMinutes(guide: Guide) {
  const words = [guide.intro, ...guide.sections.flatMap((section) => section.paragraphs)].join(" ").split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function GuideOpening({ guide, children }: { guide: Guide; children?: React.ReactNode }) {
  return <header className="mx-auto max-w-[720px]">
    <Link href="/guides" className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">Peaks field guides</Link>
    <h1 className="mt-5 font-serif text-[42px] leading-[1.08] tracking-[-0.025em] text-ink sm:text-[64px]">{guide.title}</h1>
    <p className="mt-5 font-serif text-xl italic leading-relaxed text-muted sm:text-2xl">{guide.subtitle}</p>
    <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
      <span>{guideReadingMinutes(guide)} min read</span>
      {children}
    </div>
    <div className="my-9 h-px w-12 bg-accent" aria-hidden="true" />
    <GuideIntro guide={guide} />
  </header>;
}

export function GuideIntro({ guide }: { guide: Guide }) {
  return <p className="font-serif text-[21px] leading-[1.8] text-ink sm:text-[23px]">{guide.intro}</p>;
}

export function GuideReading({ guide }: { guide: Guide }) {
  return <div className="mx-auto max-w-[720px]">
    <div className="space-y-10">
      {guide.sections.map((section) => <section key={section.title}>
        <h2 className="font-serif text-[27px] leading-tight text-ink sm:text-[32px]">{section.title}</h2>
        <div className="mt-5 space-y-5 font-serif text-[19px] leading-[1.85] text-ink-2 sm:text-xl">
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </section>)}
    </div>
    <aside aria-label="Sources and further reading" className="mt-10 border-t border-hairline pt-6">
      <h2 className="text-sm font-medium text-ink">Sources & further reading</h2>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
        {guide.sections.map((section) => <li key={section.title}>
          <a href={section.source.url} className="underline hover:text-ink">{section.source.label}</a>
        </li>)}
      </ul>
    </aside>
    <Link href="/guides" className="mt-6 inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">Find another field guide →</Link>
  </div>;
}
