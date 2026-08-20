// The parking, as a reader sees it.
//
// One row, and which fact fills it depends on what the catalog holds. A
// counted number of spaces is the better answer and wins whenever there is
// one. Where there is none — every National Park Service lot, since NPS
// publishes 6,740 lot polygons and no capacity field — the kind of parking is
// still worth a line: "Parking lot" tells a driver there is somewhere to leave
// the car, which is most of what the question was.
//
// **No number is ever derived from a lot's size here or anywhere upstream.**
// docs/trailheads/research-parking.md §2.5 offers polygon area as a proxy at
// 30 m² a space and says in the same paragraph that the ratio was never
// calibrated against ground truth. An uncalibrated estimate reads exactly like
// a counted one.
//
// Everything here reads unvalidated JSONB out of `destinations.amenities`, so
// nothing is trusted: a leaf is used only when its value is the shape the
// contract says it is, and an unusable leaf prints nothing at all.

import type { TrailheadParking } from "./amenities";
import {
  dedupeCredits,
  leafCredit,
  leafValue,
  type AmenityCredit,
  type AmenityRow,
} from "./trailhead-road-access";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What kind of parking this is, in words.
 *
 * `other` is the vocabulary's "somewhere to park that is none of the above",
 * so it prints as the plain fact and no more. A value outside the vocabulary
 * prints nothing: the field is data, and an unknown string rendered as a label
 * would be the database read aloud.
 */
export function parkingTypeLabel(raw: unknown): string | null {
  switch (raw) {
    case "lot":
      return "Parking lot";
    case "roadside":
      return "Roadside parking";
    case "garage":
      return "Parking garage";
    case "other":
      return "Parking available";
    default:
      return null;
  }
}

/**
 * The number of spaces, when the catalog really holds one.
 *
 * A number and nothing else. The importers only ever write a counted integer
 * here, so anything else in this leaf is a malformed row, and "[object Object]
 * vehicles" is worse than a missing line.
 */
function capacityVehicles(parking: TrailheadParking): number | null {
  const value = leafValue(parking.capacity_vehicles);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The whole parking row, or null when the block says nothing worth printing.
 *
 * Capacity outranks kind because it answers the harder question. Where a lot
 * has a counted capacity the kind adds nothing — thirty spaces is a lot — so
 * the two never print together.
 */
export function parkingRow(block: TrailheadParking | undefined | null): AmenityRow | null {
  if (!isRecord(block)) return null;
  const parking = block as TrailheadParking;

  const capacity = capacityVehicles(parking);
  if (capacity !== null) {
    return {
      label: "Parking capacity",
      value: `${capacity} vehicles`,
      credits: dedupeCredits([leafCredit(parking.capacity_vehicles)]),
    };
  }

  const label = parkingTypeLabel(leafValue(parking.type));
  if (label === null) return null;
  const credits: Array<AmenityCredit | null> = [leafCredit(parking.type)];
  return { label: "Parking", value: label, credits: dedupeCredits(credits) };
}

/** The parking row as one short chip, for the admin page's badge list. */
export function parkingBadge(block: TrailheadParking | undefined | null): string | null {
  const capacity = isRecord(block) ? capacityVehicles(block as TrailheadParking) : null;
  if (capacity !== null) return `${capacity} parking spaces`;
  const label = parkingTypeLabel(leafValue(isRecord(block) ? block.type : undefined));
  return label === null ? null : label.toLowerCase();
}
