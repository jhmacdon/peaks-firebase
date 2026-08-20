"use client";

import { Chip } from "../ui/chip";
import {
  MAP_TYPES,
  allTypesSelected,
  type MapTypeId,
} from "../../lib/map-view";

/**
 * The type filters, floating over the top of the map.
 *
 * The design system's `Chip` with a page fill and the float shadow behind
 * it — a chip over tiles needs a background to stay readable, and a
 * floating control is what shadow-float is for. Lakes and waterfalls start
 * off: they outnumber summits in most viewports and used to fill the panel
 * before a peak appeared. "All" turns everything on at once — it reads as
 * selected only when it already is.
 */
export function ExploreChips({
  types,
  onToggle,
  onSelectAll,
  className = "",
}: {
  types: MapTypeId[];
  onToggle: (id: MapTypeId) => void;
  onSelectAll: () => void;
  className?: string;
}) {
  const all = allTypesSelected(types);

  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto pb-1 ${className}`.trim()}
      role="group"
      aria-label="Map filters"
    >
      {MAP_TYPES.map((type) => (
        <Chip
          key={type.id}
          selected={types.includes(type.id)}
          onClick={() => onToggle(type.id)}
          className="shrink-0 bg-page shadow-float"
        >
          {type.label}
        </Chip>
      ))}
      <Chip
        selected={all}
        onClick={onSelectAll}
        className="shrink-0 bg-page shadow-float"
      >
        All
      </Chip>
    </div>
  );
}
