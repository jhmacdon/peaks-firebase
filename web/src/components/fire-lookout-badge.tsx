import { Badge } from "./ui/badge";

// Shared with map markers and the iOS tower asset.
export const FIRE_LOOKOUT_PATH =
  "M5 8 12 3 19 8M6 8h12v5H6zM12 8v5M4 14h16M8 14 5 22M16 14l3 8M8 15l9 6M16 15l-9 6";

export function FireLookoutIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={FIRE_LOOKOUT_PATH} />
    </svg>
  );
}

export function FireLookoutBadge() {
  return (
    <Badge className="gap-1.5 whitespace-nowrap">
      <FireLookoutIcon className="h-4 w-4 text-accent-text" />
      Fire lookout
    </Badge>
  );
}
