import Link from "next/link";
import {
  formatAreaKm2,
  formatAreaMi2,
  glacierMountainPath,
  type GlacierMountain,
  type GlacierSummary,
} from "../../lib/glaciers";
import { SectionHeading } from "../ui/section-heading";
import { GlacierRosterTable } from "./glacier-sections";

/** The glacier roster on a parent mountain's own destination page, linking
 * each glacier and the mountain's glacier hub. */
export function MountainGlaciers({
  mountain,
  glaciers,
  className = "",
}: {
  mountain: GlacierMountain;
  glaciers: GlacierSummary[];
  className?: string;
}) {
  const area = mountain.context?.area_km2 ?? null;
  return (
    <section id="mountain-glaciers" className={`scroll-mt-24 ${className}`.trim()} aria-labelledby="mountain-glaciers-heading">
      <SectionHeading eyebrow={`${glaciers.length} mapped`}>
        <span id="mountain-glaciers-heading">Glaciers on {mountain.name}</span>
      </SectionHeading>
      {area != null ? (
        <p className="mt-2 max-w-[68ch] text-sm text-ink-2">
          {mountain.context?.named_glacier_count ? `${mountain.context.named_glacier_count} named glaciers` : "Its glaciers"} covered{" "}
          {formatAreaMi2(area)} ({formatAreaKm2(area)})
          {mountain.context?.observed_year ? ` in ${mountain.context.observed_year}` : ""}.
        </p>
      ) : null}
      <GlacierRosterTable glaciers={glaciers} caption={`Glaciers on ${mountain.name}`} className="mt-4" />
      <Link href={glacierMountainPath(mountain)} className="mt-4 inline-block text-sm font-medium text-accent-text hover:underline">
        Map of every {mountain.name} glacier →
      </Link>
    </section>
  );
}
