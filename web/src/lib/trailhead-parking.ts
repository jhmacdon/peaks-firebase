// The parking, as a reader sees it.
//
// One row, and which fact fills it depends on what the catalog holds. A
// counted number of spaces is the better answer and wins whenever there is
// one. Where there is none — every National Park Service lot, since NPS
// publishes 6,740 lot polygons and no capacity field — the kind of parking is
// still worth a line: "Parking lot" tells a driver there is somewhere to leave
// the car, which is most of what the question was. The lot's own name stands
// under either answer.
//
// It prints as a caption, the same way the road row already prints its last
// rough stretch. The two notes that stay unprinted — bathrooms.season_note and
// parking.fills_early_note — stay unprinted by the phase-0 product call that
// this compact list carries structured facts and the sentences that qualify
// them, not every note in the block. The lot name earns its place because it
// resolves an ambiguity the structured fact creates rather than adding a new
// one: Paradise has four lots, and "Parking lot" alone does not say which.
//
// **A lot's size never becomes a number of cars, here or anywhere upstream.**
// It can become a range. docs/trailheads/research-parking.md §2.5 offered
// polygon area as a proxy at 30 m² a space and said in the same paragraph that
// the ratio had never been calibrated; the calibration exists now and its
// honest unit is a bucket, because the fitted curve runs through a cloud a full
// order of magnitude wide. So `capacity_range` prints as a range and says
// "roughly", `capacity_vehicles` prints as a count, and neither is ever
// rendered in the other's words. A counted 30 beats an estimated 25-50 and
// wins the row outright.
//
// Everything here reads unvalidated JSONB out of `destinations.amenities`, so
// nothing is trusted: a leaf is used only when its value is the shape the
// contract says it is, and an unusable leaf prints nothing at all.

import type { TrailheadParking, TrailheadParkingCapacityRange } from "./amenities";
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
 * How much parking, when the only evidence is how much ground the lot covers.
 *
 * One phrasing per bucket, written out rather than assembled from the numbers,
 * because the two ends are not the same kind of thing: `under_10` has no lower
 * bound to print and `100_plus` no upper one, and "Roughly under 10 cars" is
 * two hedges in four words. The en dash is the one a range takes.
 *
 * "Roughly" is doing real work. The estimate comes from the lot's mapped area
 * through a curve whose residual spread is a factor of 1.6, so the word is the
 * difference between what this is and what a count would be.
 */
const CAPACITY_RANGE_LABELS: Record<TrailheadParkingCapacityRange, string> = {
  under_10: "Under 10 cars",
  "10_to_25": "Roughly 10–25 cars",
  "25_to_50": "Roughly 25–50 cars",
  "50_to_100": "Roughly 50–100 cars",
  "100_plus": "Roughly 100+ cars",
};

/**
 * The range in words, or null when the leaf holds something else.
 *
 * A value outside the five is data this page does not know how to read, and
 * printing it raw would be the database read aloud.
 */
export function capacityRangeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return CAPACITY_RANGE_LABELS[raw as TrailheadParkingCapacityRange] ?? null;
}

function capacityRange(parking: TrailheadParking): string | null {
  return capacityRangeLabel(leafValue(parking.capacity_range));
}

/**
 * Which lot, in the words the land manager uses for it.
 *
 * The highest-value note this block carries: "Paradise Parking (Upper Lot)"
 * is the sign a driver is looking for, and Paradise has four lots. It prints
 * under the answer rather than beside it — the row's job is to say whether
 * there is parking, and this says which parking.
 */
function locationNote(parking: TrailheadParking): string | null {
  const value = leafValue(parking.location_note);
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note.length > 0 ? note : null;
}

/**
 * The whole parking row, or null when the block says nothing worth printing.
 *
 * Three answers, in the order of how much they say. A counted capacity is
 * best and wins outright — thirty spaces is a lot, so the kind adds nothing
 * beside it. An estimated range comes next: it is less than a count and much
 * more than "there is a lot here". The kind of parking answers last. The lot's
 * name stands under whichever of them prints.
 *
 * **The count and the range never print together and never merge.** They are
 * different claims — one somebody made by counting, one a curve made by
 * measuring ground — and a row reading "30 vehicles (roughly 25-50)" would
 * invite the reader to average them.
 */
export function parkingRow(block: TrailheadParking | undefined | null): AmenityRow | null {
  if (!isRecord(block)) return null;
  const parking = block as TrailheadParking;

  const note = locationNote(parking);
  const captions = note === null ? [] : [note];
  const noteCredit = note === null ? null : leafCredit(parking.location_note);

  const capacity = capacityVehicles(parking);
  if (capacity !== null) {
    return {
      label: "Parking capacity",
      value: `${capacity} vehicles`,
      captions,
      credits: dedupeCredits([leafCredit(parking.capacity_vehicles), noteCredit]),
    };
  }

  const range = capacityRange(parking);
  if (range !== null) {
    return {
      label: "Parking capacity",
      value: range,
      captions,
      credits: dedupeCredits([leafCredit(parking.capacity_range), noteCredit]),
    };
  }

  const label = parkingTypeLabel(leafValue(parking.type));
  if (label === null) {
    // A name with nothing to hang it on is still a fact: the catalog knows
    // which lot, and printing it beats printing nothing.
    if (note === null) return null;
    return { label: "Parking", value: note, credits: dedupeCredits([noteCredit]) };
  }
  const credits: Array<AmenityCredit | null> = [leafCredit(parking.type), noteCredit];
  return { label: "Parking", value: label, captions, credits: dedupeCredits(credits) };
}

/**
 * The parking row as one short chip, for the admin page's badge list.
 *
 * The lot's name rides along in brackets, because the admin page is where
 * someone checks whether an import landed on the right lot, and "parking lot"
 * on its own cannot answer that.
 */
export function parkingBadge(block: TrailheadParking | undefined | null): string | null {
  if (!isRecord(block)) return null;
  const parking = block as TrailheadParking;
  const note = locationNote(parking);
  const capacity = capacityVehicles(parking);
  const range = capacityRange(parking);
  const answer =
    capacity !== null
      ? `${capacity} parking spaces`
      : range !== null
        ? range.charAt(0).toLowerCase() + range.slice(1)
        : (parkingTypeLabel(leafValue(parking.type))?.toLowerCase() ?? null);
  if (answer === null) return note;
  return note === null ? answer : `${answer} (${note})`;
}
