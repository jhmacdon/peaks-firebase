import { isNationalParkService, type ProtectedArea } from "../lib/area-types";
import { ParkShield } from "./icons/park-shield";

function Trees({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2 L7 11 H10 L6 18 H18 L14 11 H17 Z" />
      <rect x="11" y="17" width="2" height="5" />
    </svg>
  );
}

function Mountain({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 20 L10 7 L14 14 L16 11 L21 20 Z" />
    </svg>
  );
}

function Landmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2 L3 7 H21 Z" />
      <rect x="4" y="9" width="2" height="9" />
      <rect x="9" y="9" width="2" height="9" />
      <rect x="13" y="9" width="2" height="9" />
      <rect x="18" y="9" width="2" height="9" />
      <rect x="2" y="19" width="20" height="2" />
    </svg>
  );
}

function Hiker({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="4.5" r="2" fill="currentColor" stroke="none" />
      <path d="M12 8 V14 M12 11 L7 13 M12 11 L17 13 M12 14 L8 21 M12 14 L16 21" />
    </svg>
  );
}

function Bird({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 9 Q7 15 11 9 Q15 3 22 9" />
    </svg>
  );
}

function Waves({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 9 q3 -3 6 0 t6 0 t6 0" />
      <path d="M2 15 q3 -3 6 0 t6 0 t6 0" />
    </svg>
  );
}

function Leaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M5 19 C5 10 12 4 20 4 C20 13 13 19 5 19 Z" />
    </svg>
  );
}

export function AreaKindIcon({ area, className }: { area: ProtectedArea; className?: string }) {
  if (isNationalParkService(area)) return <ParkShield className={className} />;
  switch (area.kind) {
    case "national_forest":
    case "national_grassland":
    case "national_park":
      return <Trees className={className} />;
    case "national_monument":
      return <Landmark className={className} />;
    case "wilderness":
      return <Mountain className={className} />;
    case "national_recreation_area":
      return <Hiker className={className} />;
    case "wildlife_refuge":
      return <Bird className={className} />;
    case "wild_and_scenic_river":
      return <Waves className={className} />;
    case "national_conservation_area":
    case "other_federal_area":
    case "unknown":
    default:
      return <Leaf className={className} />;
  }
}
