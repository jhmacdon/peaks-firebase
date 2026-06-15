import { sortAreasByProminence, type ProtectedArea } from "../lib/area-types";
import { AreaKindIcon } from "./area-kind-icon";

export function AreaChip({ area }: { area: ProtectedArea }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
      <AreaKindIcon area={area} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{area.name}</span>
    </span>
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
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {sortAreasByProminence(areas).map((a) => (
        <AreaChip key={a.id} area={a} />
      ))}
    </div>
  );
}
