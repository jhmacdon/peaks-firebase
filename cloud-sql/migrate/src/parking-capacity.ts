// Parking-lot area -> a capacity *range*, calibrated 2026-08-20.
//
// research-parking.md §2.5 offered polygon area as a capacity proxy at 30 m² a
// space and said in the same breath that the ratio was never calibrated,
// because Overpass went down before the regression could run. This module is
// that regression, and the reason `npsParkingFacts` may finally say something
// about how much parking a lot has.
//
// Two findings shape everything below, and both are worth reading before
// touching a constant.
//
// **A trailhead lot is not a shopping-centre lot.** Across 56,124 US
// `amenity=parking` ways carrying a numeric `capacity` tag, the median lot
// spends 28.5 m² a car. Restrict to lots that sit within 150 m of a
// `highway=trailhead` node or are named for a trail, and the median rises to
// 39.3 m²; the US Forest Service's own prose about its own trailheads puts it
// at 57.0 m². A gravel turnaround with no stripes, room to swing a truck and a
// snow pile in the corner simply holds fewer cars per hectare than a striped
// lot behind a supermarket. Calibrating on the national OSM population and
// applying the result to trailheads would have over-counted them by roughly a
// factor of two — one whole bucket, every time. So the shipped constants come
// from the trailhead-context subset, not from the larger and much better
// measured national one.
//
// **The relationship is not a ratio.** Area per car falls as lots get bigger:
// the fixed overhead of an approach, a turnaround and an apron is most of a
// four-car pullout and almost none of a 250-car lot. The fitted exponent is
// 0.735 with a 95% bootstrap interval of 0.698-0.773, so a through-origin
// ratio — exponent 1 — is not merely worse, it is excluded by the data. A
// single m²-per-car number would under-read big lots and over-read small ones.
//
// **This module deliberately exposes no vehicle count.** The fitted curve is a
// centre line through a cloud a full order of magnitude wide (real trailhead
// lots run from 11 to 250 m² a car), and the honest unit of publication is the
// bucket. An exported `estimateCapacityVehicles` would end up in
// `capacity_vehicles` beside counts that somebody actually made, and a number
// nobody checked reads exactly like a number somebody did.

/**
 * The published range, in cars. The bucket edges are a product decision, not a
 * fitted one; the calibration chooses the areas at which each edge is crossed.
 *
 * Proposed for `TrailheadParking.capacity_range` as a sibling of
 * `capacity_vehicles` — a source that counted spaces keeps writing the count.
 * `amenities.ts` is deliberately not edited here; wiring the schema is a
 * separate change, and this type is its input.
 */
export type TrailheadParkingCapacityRange =
  | "under_10"
  | "10_to_25"
  | "25_to_50"
  | "50_to_100"
  | "100_plus";

/** What a source says the lot is surfaced with, when it says anything. */
export type ParkingSurfaceHint = "paved" | "unpaved";

/** The ranges in ascending order, so a caller can compare or iterate them. */
export const CAPACITY_RANGES: readonly TrailheadParkingCapacityRange[] = [
  "under_10",
  "10_to_25",
  "25_to_50",
  "50_to_100",
  "100_plus",
];

/** The car counts the ranges break at, for anyone rendering a label. */
export const CAPACITY_RANGE_BOUNDS: readonly number[] = [10, 25, 50, 100];

/**
 * The fit, its provenance, and the gates around it.
 *
 * Fitted 2026-08-20 from OpenStreetMap `amenity=parking` ways with a numeric
 * `capacity` tag, pulled by Overpass over the contiguous United States.
 *
 * - National sample: 67,590 distinct ways, 56,124 usable area/capacity pairs
 *   after dropping decks (`parking=multi-storey|underground|rooftop|
 *   street_side|lane` and friends, 11,119 of them), non-numeric capacities,
 *   and pairs outside 8-1000 m² a car — bounds set by what a car physically
 *   occupies, not by trimming the distribution. Only 186 pairs (0.33%) fell
 *   outside them.
 * - Fit sample: the 658 of the 914 trailhead-context pairs — within 150 m of
 *   an OSM `highway=trailhead`/`information=trailhead` node, or carrying a
 *   trail-ish `name` — that hash into the 70% fitting slice.
 * - Fit: ordinary least squares of log(capacity) on log(area). Residual
 *   standard deviation 0.497 in log space, i.e. a 1σ spread of ×1.64 — which
 *   is why this function returns a range and not a number.
 * - Bootstrap (2,000 resamples): exponent 0.735, 95% CI 0.698-0.773;
 *   coefficient 0.126, 95% CI 0.101-0.159.
 *
 * Accuracy as shipped — gates applied, measured over the lots this function
 * actually answers for, on data never used to fit or to choose the thresholds:
 * - Held-out OSM pairs (30% slice): 15,197 answered of 16,805, 54.8% exact
 *   bucket, 97.8% correct-or-adjacent. Restricted to trailhead-context
 *   held-out pairs: 242 of 256 answered, 62.8% exact, 97.9% correct-or-adjacent.
 * - US Forest Service page prose (trailheads whose stated capacity could be
 *   joined to a mapped lot polygon): 62 of 63 answered, 50.0% exact, 91.9%
 *   correct-or-adjacent. This set was mined from cached fs.usda.gov pages and
 *   never touched the fit.
 *
 * The 1,608 held-out OSM lots the floor declines were nearly all correct
 * `under_10` calls given up on purpose: a 50 m² polygon is a pullout, and the
 * gate costs exact accuracy to buy the right to stay quiet.
 *
 * `surface` is accepted and does not move the answer, which is a measurement
 * rather than an oversight — see `estimateCapacityRange`.
 *
 * Recalibrate, don't nudge: the thresholds are the curve evaluated at the
 * bucket edges, and `parking-capacity.test.ts` fails if they stop agreeing.
 */
export const PARKING_CAPACITY_CALIBRATION = {
  /** cars = coefficient * area^exponent, area in m². */
  coefficient: 0.1261,
  exponent: 0.7354,
  /**
   * The areas at which the curve reaches 10, 25, 50 and 100 cars, rounded to
   * whole m². Bootstrap 95% intervals: 364-402, 1236-1448, 3051-3892,
   * 7490-10475 — the top edge is the loosest, because trailhead lots that big
   * are rare in the fit sample.
   */
  thresholdsM2: [383, 1330, 3413, 8759] as const,
  /**
   * Below this, no claim. 75 m² is where the curve reaches three cars (74.4,
   * rounded up), and a three-car gravel apron is a pullout —
   * `TrailheadParkingType` already has a word for that, and it is not `lot`.
   */
  minLotAreaM2: 75,
  /**
   * Above this, no claim. The calibration's own areas reach 38,506 m² at the
   * 99.9th percentile, so anything past 50,000 m² is being extrapolated at,
   * and in the NPS layer such polygons are mis-mapped rather than enormous —
   * eight of 6,739 lots exceed it, up to a 250,506 m² ring that is plainly not
   * one lot.
   */
  maxLotAreaM2: 50_000,
} as const;

/**
 * The range of cars a lot of this area holds, or null when no claim is safe.
 *
 * `surface` is taken and ignored, and the null result is the interesting part
 * of the story. Across the whole national sample an unpaved lot really does
 * spend more area per car than a paved one — 40.5 m² against 29.4 — but almost
 * all of that gap is surface standing in for setting. Inside trailhead context
 * the medians close to 42.6 m² unpaved against 37.8 m² paved, and adding
 * surface dummies moves the residual standard deviation only from 0.496 to
 * 0.489 on n = 914. Scored end to end, the adjustment earns nothing: it left
 * the Forest Service prose set unchanged and cost a point of exact accuracy on
 * held-out trailhead pairs (64.8% to 63.7%, ungated). The parameter
 * stays in the signature because callers have the value and a later
 * recalibration on a bigger trailhead sample may yet find a use for it; today
 * it would be decoration with a coefficient attached.
 *
 * Returns null for a non-finite or non-positive area, for anything below
 * `minLotAreaM2`, and for anything above `maxLotAreaM2`.
 */
export function estimateCapacityRange(
  areaM2: number,
  surface?: ParkingSurfaceHint
): TrailheadParkingCapacityRange | null {
  void surface;
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;
  const { minLotAreaM2, maxLotAreaM2, thresholdsM2 } = PARKING_CAPACITY_CALIBRATION;
  if (areaM2 < minLotAreaM2 || areaM2 > maxLotAreaM2) return null;
  for (let i = 0; i < thresholdsM2.length; i += 1) {
    if (areaM2 < thresholdsM2[i]) return CAPACITY_RANGES[i];
  }
  return CAPACITY_RANGES[CAPACITY_RANGES.length - 1];
}

/**
 * The fitted centre line, in cars, exported for tests and calibration checks.
 *
 * Not for publication: see the note at the top of this file about why no
 * vehicle count leaves this module by any other door.
 */
export function fittedCapacityCurve(areaM2: number): number {
  const { coefficient, exponent } = PARKING_CAPACITY_CALIBRATION;
  return coefficient * Math.pow(areaM2, exponent);
}
