import Link from "next/link";
import { sortAreasByProminence, type ProtectedArea } from "../lib/area-types";
import { AreaKindIcon } from "./area-kind-icon";

export function AreaChip({ area }: { area: ProtectedArea }) {
  return (
    <Link
      href={`/areas/${encodeURIComponent(area.id)}`}
      className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30 dark:focus-visible:ring-offset-gray-950"
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
