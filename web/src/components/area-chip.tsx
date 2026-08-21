import Link from "next/link";
import { sortAreasByProminence, type ProtectedArea } from "../lib/area-types";
import { AreaKindIcon } from "./area-kind-icon";

// Retinted to tokens with Task 13 (the destination re-skin renders these
// right under the H1). Outlined, not filled: chips are small and plural, so
// a filled chip per area would spend the accent budget on decoration — same
// reasoning as ui/chip.tsx. Focus comes from the global :focus-visible rule
// in globals.css rather than a hand-rolled ring.
export function AreaChip({ area }: { area: ProtectedArea }) {
  return (
    <Link
      href={`/areas/${encodeURIComponent(area.id)}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-2"
      aria-label={`View ${area.name}`}
    >
      <AreaKindIcon area={area} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{area.name}</span>
    </Link>
  );
}

export function AreaChips({
  areas,
  className = "",
}: {
  areas: ProtectedArea[];
  className?: string;
}) {
  if (!areas || areas.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {sortAreasByProminence(areas).map((a) => (
        <AreaChip key={a.id} area={a} />
      ))}
    </div>
  );
}
