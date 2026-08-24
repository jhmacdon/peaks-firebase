import type { LandingFaq } from "../lib/landing-copy";
import { SectionHeading } from "./ui/section-heading";

export function FaqSection({ items }: { items: LandingFaq[] }) {
  if (items.length === 0) return null;

  return (
    <section>
      <SectionHeading eyebrow="Straight answers" size="lg">
        Common questions
      </SectionHeading>
      <dl className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.question} className="border-t border-hairline pt-5">
            <dt className="text-[17px] font-medium leading-snug text-ink">
              {item.question}
            </dt>
            <dd className="mt-2 text-[15px] leading-[1.6] text-ink-2">
              {item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
