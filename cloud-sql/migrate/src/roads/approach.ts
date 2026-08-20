// The approach-path derivation: what one trailhead's drive in adds up to.
//
// The question in docs/trailheads/research-roads.md §A4 is not "what road is
// the trailhead on" but "what is the worst thing between the trailhead and a
// road built for passenger cars". So this module does two things:
//
//   1. Walks the graph from the snapped edge to the nearest anchor — a
//      maintenance level 4 or 5 road, which is the contract's `approachTerminus`
//      — and returns the edges driven.
//   2. Turns that path into the answers a hiker reads: vehicle, surface, gate
//      window and the segment that set each.
//
// The fold over the path itself belongs to `summarizeApproach` in graph.ts,
// which already carries the unknown rule. Nothing here re-implements it.
//
// Three rules from the handover contract are load-bearing and easy to lose:
//
// **An unranked edge poisons the path.** `summarizeApproach` returns a null
// vehicle answer for a path holding one unrated edge. A caller must render
// that as unknown, never as the second-worst known edge — which is why
// `deriveApproach` refuses to emit a vehicle leaf at all in that case.
//
// **Store the segment key, never the edge id.** Edge ids carry an `@piece`
// suffix from the noding and renumber on every refresh.
//
// **A window nobody recorded is not an open gate.** Windows come only from
// MVUM segments flagged seasonal, they are intersected rather than picked
// from, and a path with no window at all yields no seasonal leaf.

import {
  metresBetween,
  otherNode,
  summarizeApproach,
  type Adjacency,
  type ApproachSummary,
  type Endpoint,
  type SnapCandidate,
  type TraversalEdge,
} from "./graph";
import type { SeasonWindow } from "./mvum-seasons";
import type { RoadSurface, VehicleRequirement } from "./road-enums";

/** Miles per metre, for the straight-line fallbacks. */
const MILES_PER_METRE = 1 / 1609.344;

/**
 * How far from the trailhead the walk may wander, in straight-line metres.
 *
 * A search inside a large component would otherwise cross a whole national
 * forest looking for an anchor it will never find. Forty kilometres is roughly
 * twice the longest approach the measurement found, so it bounds the work
 * without cutting a real answer short.
 */
export const DEFAULT_MAX_STRAIGHT_LINE_M = 40_000;

/** How long a drive may be before it stops being an approach, in road miles. */
export const DEFAULT_MAX_PATH_MILES = 60;

/** Everything the walk needs, as `loadGraph` returns it. */
export interface WalkGraph {
  adjacency: Adjacency;
  byId: Map<string, TraversalEdge>;
  nodes: Map<number, Endpoint>;
}

/**
 * Which path to call the approach when a trailhead has more than one.
 *
 * `nearest` is §A4 read literally — walk outward to the first level 4/5 road.
 * `easiest` prefers the way out that demands least of a vehicle and breaks
 * ties on distance, which is what a driver actually does: nobody takes the
 * rough short cut when a graded road leaves the same trailhead. `easiest` is
 * the default — see `DEFAULT_PATH_PREFERENCE` for the measurement behind that.
 */
export type PathPreference = "nearest" | "easiest";

/**
 * The preference the pipeline ships with.
 *
 * Measured over the catalog: `easiest` agrees with `nearest` on 320 of 328
 * answers, and on the other 8 it finds a passenger-car way out where `nearest`
 * reports high clearance — for 3.11 extra miles across every trailhead
 * derived, the longest single detour being 1.37 mi, and no seasonal window
 * changing at all. Eight wrong "high clearance required" answers is eight
 * trips that do not happen.
 *
 * **Watch item.** `UNRANKED_SEARCH_RANK` makes `easiest` route *around* an
 * unranked edge, so once BLM-served trailheads enter the catalog it can return
 * a confident answer down a longer known road where `nearest` would have
 * crossed the unranked edge and honestly returned nothing. That is the better
 * answer only while the detour is a road somebody would really drive. Revisit
 * at the first desert-peak data.
 */
export const DEFAULT_PATH_PREFERENCE: PathPreference = "easiest";

export interface WalkLimits {
  maxStraightLineMetres?: number;
  maxPathMiles?: number;
  prefer?: PathPreference;
}

/**
 * The rank an unranked edge searches as under `easiest`.
 *
 * One worse than `not_maintained`, the worst real value, so a path we can
 * describe is preferred to one we cannot. It is an ordering, not an answer:
 * a path that ends up crossing an unranked edge still has no vehicle answer.
 */
const UNRANKED_SEARCH_RANK = 7;

/** The drive from the trailhead out to a maintained road. */
export interface ApproachPath {
  /** The edges driven, snapped edge first, anchor last. */
  edges: TraversalEdge[];
  /** The maintenance level 4/5 edge the walk stopped on. */
  anchor: TraversalEdge;
  /**
   * Miles as the search counted them, which fills a missing length with the
   * straight line between its nodes. An ordering, not an answer.
   */
  searchMiles: number;
  /**
   * The drive: from the trailhead to the end of the maintained road, counting
   * only the part of the snapped edge actually driven and none of the anchor.
   * Null when an edge on it has no length — a missing length is not a zero.
   */
  driveMiles: number | null;
  /** How many nodes the search settled before it stopped. */
  nodesSettled: number;
}

/**
 * The measured drive, from the snap point to the near end of the anchor.
 *
 * The path itself carries the whole snapped edge and the whole anchor edge,
 * because both are roads that get driven and both can carry a gate. The
 * distance is the narrower thing: a trailhead half way along a two-mile spur
 * is one mile from the junction, not two, and the anchor is where the drive
 * stops being an approach.
 */
function measureDrive(
  path: readonly TraversalEdge[],
  snapFraction: number,
): number | null {
  const driven = path.slice(0, -1);
  let miles = 0;
  for (let index = 0; index < driven.length; index += 1) {
    const edge = driven[index]!;
    if (edge.lengthMiles === null) return null;
    miles += index === 0 ? edge.lengthMiles * snapFraction : edge.lengthMiles;
  }
  return miles;
}

/** A tiny binary heap. The walk pops a few thousand nodes per trailhead. */
class NodeHeap {
  private readonly costs: number[] = [];
  private readonly ids: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, cost: number): void {
    this.ids.push(id);
    this.costs.push(cost);
    let child = this.ids.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.costs[parent]! <= this.costs[child]!) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  pop(): { id: number; cost: number } | null {
    if (this.ids.length === 0) return null;
    const id = this.ids[0]!;
    const cost = this.costs[0]!;
    const lastId = this.ids.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.costs[0] = lastCost;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.ids.length && this.costs[left]! < this.costs[smallest]!) smallest = left;
        if (right < this.ids.length && this.costs[right]! < this.costs[smallest]!) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return { id, cost };
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]!;
    this.ids[a] = this.ids[b]!;
    this.ids[b] = id;
    const cost = this.costs[a]!;
    this.costs[a] = this.costs[b]!;
    this.costs[b] = cost;
  }
}

/** An edge's length for search purposes only, never for the stored answer. */
function searchLengthMiles(edge: TraversalEdge, nodes: Map<number, Endpoint>): number {
  if (edge.lengthMiles !== null) return edge.lengthMiles;
  const from = nodes.get(edge.fromNode);
  const to = nodes.get(edge.toNode);
  if (from === undefined || to === undefined) return 0;
  return metresBetween(from, to) * MILES_PER_METRE;
}

/**
 * Walk from a snapped trailhead out to an anchor.
 *
 * Nearest by road miles, not by edge count: the edges are artefacts of the
 * noding, so a path of four long segments is a shorter drive than one of
 * twelve short ones. The search starts at both ends of the snapped edge, each
 * charged its share of that edge, and settles nodes cheapest-first, so the
 * first anchor it meets is the nearest one. Under `easiest` the same search
 * runs with the worst rank on the path ahead of miles in the ordering, so the
 * first anchor it meets is instead the one behind the gentlest drive.
 *
 * The path returned always includes the snapped edge and the anchor edge. The
 * anchor is a level 4/5 road, so including it can never worsen the vehicle or
 * surface answer, and it is what carries the gate window on the road you turn
 * off — the closure most likely to end the trip before it starts.
 */
export function findApproachPath(
  graph: WalkGraph,
  snap: SnapCandidate,
  origin: Endpoint,
  limits: WalkLimits = {},
): ApproachPath | null {
  const maxStraightLine = limits.maxStraightLineMetres ?? DEFAULT_MAX_STRAIGHT_LINE_M;
  const maxMiles = limits.maxPathMiles ?? DEFAULT_MAX_PATH_MILES;
  const prefer = limits.prefer ?? DEFAULT_PATH_PREFERENCE;
  const snapEdge = graph.byId.get(snap.edgeId);
  if (snapEdge === undefined) return null;

  // A trailhead already on a maintained road has no rough approach to describe.
  if (snapEdge.approachTerminus) {
    return {
      edges: [snapEdge],
      anchor: snapEdge,
      searchMiles: 0,
      driveMiles: 0,
      nodesSettled: 0,
    };
  }

  // Under `easiest` the two halves of the cost are packed into one number so
  // the heap stays a plain comparison: the worst rank on the path decides, and
  // miles only settle ties. Under `nearest` the rank half is always zero.
  const mileScale = maxMiles + 1;
  const rankOf = (edge: TraversalEdge): number =>
    prefer === "nearest" ? 0 : edge.vehicleRank ?? UNRANKED_SEARCH_RANK;

  const snapMiles = searchLengthMiles(snapEdge, graph.nodes);
  const position = Math.min(Math.max(snap.positionAlongEdge, 0), 1);
  const best = new Map<number, number>();
  const bestMiles = new Map<number, number>();
  const bestRank = new Map<number, number>();
  const arrival = new Map<number, TraversalEdge>();
  const heap = new NodeHeap();
  const snapRank = rankOf(snapEdge);
  const start: [number, number][] = [
    [snapEdge.fromNode, snapMiles * position],
    [snapEdge.toNode, snapMiles * (1 - position)],
  ];
  for (const [node, miles] of start) {
    if (miles > maxMiles) continue;
    const cost = snapRank * mileScale + miles;
    const existing = best.get(node);
    if (existing === undefined || cost < existing) {
      best.set(node, cost);
      bestMiles.set(node, miles);
      bestRank.set(node, snapRank);
      heap.push(node, cost);
    }
  }

  let settled = 0;
  for (;;) {
    const top = heap.pop();
    if (top === null) return null;
    const settledCost = best.get(top.id);
    if (settledCost === undefined || top.cost > settledCost) continue;
    const milesHere = bestMiles.get(top.id)!;
    const rankHere = bestRank.get(top.id)!;
    settled += 1;

    const incident = graph.adjacency.get(top.id) ?? [];
    // An anchor incident to the cheapest unsettled node is the nearest anchor:
    // every other one lies behind a node that costs at least as much to reach.
    let anchor: TraversalEdge | null = null;
    for (const edge of incident) {
      const candidate = edge as TraversalEdge;
      if (!candidate.approachTerminus) continue;
      if (anchor === null || candidate.edgeId < anchor.edgeId) anchor = candidate;
    }
    if (anchor !== null) {
      const edges: TraversalEdge[] = [];
      let node = top.id;
      for (;;) {
        const step = arrival.get(node);
        if (step === undefined) break;
        edges.push(step);
        node = otherNode(step, node);
      }
      edges.reverse();
      // `node` is now the end of the snapped edge the drive left through, so
      // it says which share of that edge was actually driven.
      const fraction =
        snapEdge.fromNode === snapEdge.toNode
          ? Math.min(position, 1 - position)
          : node === snapEdge.fromNode
            ? position
            : 1 - position;
      const path = [snapEdge, ...edges, anchor];
      return {
        edges: path,
        anchor,
        searchMiles: milesHere,
        driveMiles: measureDrive(path, fraction),
        nodesSettled: settled,
      };
    }

    for (const edge of incident) {
      const step = edge as TraversalEdge;
      // The snapped edge is already paid for in the two starting costs, and
      // driving back across it is a U-turn through the trailhead.
      if (step.edgeId === snapEdge.edgeId) continue;
      const next = otherNode(step, top.id);
      if (next === top.id) continue;
      const where = graph.nodes.get(next);
      if (where === undefined) continue;
      if (metresBetween(origin, where) > maxStraightLine) continue;
      const miles = milesHere + searchLengthMiles(step, graph.nodes);
      if (miles > maxMiles) continue;
      const rank = Math.max(rankHere, rankOf(step));
      const cost = rank * mileScale + miles;
      const known = best.get(next);
      if (known !== undefined && known <= cost) continue;
      best.set(next, cost);
      bestMiles.set(next, miles);
      bestRank.set(next, rank);
      arrival.set(next, step);
      heap.push(next, cost);
    }
  }
}

// ---------------------------------------------------------------------------
// Seasonal windows
// ---------------------------------------------------------------------------

// The windows are month and day with no year, so they are intersected on a
// 366-slot calendar — leap-year shaped, because 02-29 is a real value in this
// data and dropping it would quietly widen a window by a day.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = DAYS_IN_MONTH.reduce<number[]>((starts, days, index) => {
  starts.push((starts[index - 1] ?? 0) + (index === 0 ? 0 : DAYS_IN_MONTH[index - 1]!));
  return starts;
}, []);

/** Days in the leap-shaped year the intersection runs on. */
export const CALENDAR_DAYS = 366;

/** "MM-DD" to its slot in the leap-shaped year, or null if it is not a date. */
export function dayOfYear(monthDay: string): number | null {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (match === null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]!) return null;
  return MONTH_START[month - 1]! + day - 1;
}

/** The slot back to "MM-DD". */
export function monthDayOfYear(index: number): string {
  let month = 0;
  while (month < 11 && index >= MONTH_START[month + 1]!) month += 1;
  const day = index - MONTH_START[month]! + 1;
  return `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function maskForWindows(windows: readonly SeasonWindow[]): Uint8Array {
  const mask = new Uint8Array(CALENDAR_DAYS);
  for (const window of windows) {
    const opens = dayOfYear(window.opens);
    const closes = dayOfYear(window.closes);
    if (opens === null || closes === null) continue;
    let day = opens;
    for (;;) {
      mask[day] = 1;
      if (day === closes) break;
      day = (day + 1) % CALENDAR_DAYS;
    }
  }
  return mask;
}

function windowsFromMask(mask: Uint8Array): SeasonWindow[] {
  let open = 0;
  for (let day = 0; day < CALENDAR_DAYS; day += 1) open += mask[day]!;
  // Nothing survives, or everything does. A gate open every day of the year is
  // the §A3 filler value wearing another hat, so it is reported as no window
  // rather than as a road that is always open.
  if (open === 0 || open === CALENDAR_DAYS) return [];

  const runs: { start: number; end: number }[] = [];
  for (let day = 0; day < CALENDAR_DAYS; day += 1) {
    if (mask[day] !== 1) continue;
    const previous = runs[runs.length - 1];
    if (previous !== undefined && previous.end === day - 1) previous.end = day;
    else runs.push({ start: day, end: day });
  }
  // A run touching both ends of the calendar is one window through New Year.
  if (runs.length > 1 && runs[0]!.start === 0 && runs[runs.length - 1]!.end === CALENDAR_DAYS - 1) {
    const first = runs.shift()!;
    runs[runs.length - 1]!.end = first.end + CALENDAR_DAYS;
  }
  return runs.map((run) => ({
    opens: monthDayOfYear(run.start),
    closes: monthDayOfYear(run.end % CALENDAR_DAYS),
    wrapsYear: run.end >= CALENDAR_DAYS,
  }));
}

/**
 * Intersect every window set crossed on the path.
 *
 * The contract's rule, twice over: a RoadCore segment can link to several MVUM
 * segments and a path crosses several roads, and in both cases picking one
 * would publish a road as open on a date one of its own stretches calls shut.
 * A set with no window is not a constraint and is simply not passed in — an
 * unrecorded gate is not an open gate, and it is not a shut one either.
 *
 * Returns every surviving interval. Callers that can print only one window
 * should take the longest and say how many there were.
 */
export function intersectSeasonWindows(
  sets: readonly (readonly SeasonWindow[])[],
): SeasonWindow[] {
  const usable = sets.filter((set) => set.length > 0);
  if (usable.length === 0) return [];
  const mask = new Uint8Array(CALENDAR_DAYS).fill(1);
  for (const set of usable) {
    const other = maskForWindows(set);
    for (let day = 0; day < CALENDAR_DAYS; day += 1) mask[day]! &= other[day]!;
  }
  return windowsFromMask(mask);
}

/** The window a caller should print when the intersection left several. */
export function longestWindow(windows: readonly SeasonWindow[]): SeasonWindow | null {
  let best: SeasonWindow | null = null;
  let bestDays = -1;
  for (const window of windows) {
    const opens = dayOfYear(window.opens);
    const closes = dayOfYear(window.closes);
    if (opens === null || closes === null) continue;
    const days = closes >= opens ? closes - opens + 1 : CALENDAR_DAYS - opens + closes + 1;
    if (days > bestDays) {
      bestDays = days;
      best = window;
    }
  }
  return best;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The window as two ISO dates.
 *
 * The source carries a month and a day and no year, but the client parses
 * `yyyy-MM-dd` first and falls back to `MM/dd` only for providers that give
 * nothing better — so a bare `MM-DD` is a downgrade we choose not to ship. The
 * year is a carrier, not a claim: the same gate recurs every season, and the
 * client prints the month and day alone.
 *
 * February 29 is a real value here, so a window that touches it is anchored to
 * the next leap year rather than moved to the 28th. A window through New Year
 * closes in the following year, which is what makes it read as one span.
 */
export function seasonWindowToIsoDates(
  window: SeasonWindow,
  anchorYear: number,
): { opens: string; closes: string } | null {
  if (dayOfYear(window.opens) === null || dayOfYear(window.closes) === null) return null;
  const needsLeap =
    window.opens === "02-29" || (window.closes === "02-29" && !window.wrapsYear);
  const closeNeedsLeap = window.closes === "02-29" && window.wrapsYear;
  let year = anchorYear;
  for (let tries = 0; tries < 8; tries += 1) {
    const openYearOk = !needsLeap || isLeapYear(year);
    const closeYearOk = !closeNeedsLeap || isLeapYear(year + 1);
    if (openYearOk && closeYearOk) break;
    year += 1;
  }
  return {
    opens: `${year}-${window.opens}`,
    closes: `${window.wrapsYear ? year + 1 : year}-${window.closes}`,
  };
}

// ---------------------------------------------------------------------------
// The answers a hiker reads
// ---------------------------------------------------------------------------

export type HighClearanceAnswer = "required" | "recommended" | "not_required";

/** What the worst edge on the path demands of a vehicle. */
export interface VehicleAnswer {
  highClearance: HighClearanceAnswer | null;
  fourWheelDrive: boolean | null;
  /** False where no highway vehicle belongs at all: ATV-only or unmaintained. */
  carPassable: boolean;
}

/**
 * Map the worst vehicle requirement on the path onto the stored leaves.
 *
 * Maintenance levels 3, 4 and 5 all give `passenger_car`, and this reports
 * that as `not_required` rather than `recommended`. §A3 is explicit that the
 * difference between those levels is comfort, not capability, and the
 * roughness a level 3 road can carry is said by the surface leaf beside it —
 * "Gravel", "Dirt". Softening every level 3 road to "high clearance
 * recommended" would tell a hiker with a Civic to stay home from a road the
 * Forest Service maintains for passenger cars, and it would leave nothing left
 * to say about the level 2 road that genuinely needs the clearance.
 *
 * A four-wheel-drive class also sets `high_clearance: required`: BLM's `4WD
 * Low` and `4WD High Clearance/Specialized` are both observed classes for
 * roads no ordinary car should attempt, and a driver who needs four-wheel
 * drive needs the clearance that comes with it.
 */
export function vehicleAnswerFor(requirement: VehicleRequirement): VehicleAnswer {
  switch (requirement) {
    case "passenger_car":
      return { highClearance: "not_required", fourWheelDrive: false, carPassable: true };
    case "high_clearance":
      // Nothing here says a car with clearance needs four-wheel drive, so the
      // four-wheel-drive leaf is left unsaid rather than claimed false.
      return { highClearance: "required", fourWheelDrive: null, carPassable: true };
    case "four_wheel_drive":
    case "four_wheel_drive_high_clearance":
      return { highClearance: "required", fourWheelDrive: true, carPassable: true };
    case "atv_only":
    case "not_maintained":
      return { highClearance: null, fourWheelDrive: null, carPassable: false };
  }
}

/**
 * The surface as a driver names it.
 *
 * The client understands "paved", "gravel" and "dirt" and prints anything else
 * verbatim, so these are words rather than the internal enum: `improved_native`
 * on a detail sheet would read as a database column, which it is.
 */
export function surfaceWord(surface: RoadSurface): string | null {
  switch (surface) {
    case "asphalt":
      return "paved";
    case "bituminous":
      return "chip seal";
    case "aggregate":
      return "gravel";
    case "improved_native":
      return "improved dirt";
    case "native":
      return "dirt";
    case "other":
      return null;
  }
}

/** Enough of a segment to name it in a sentence. */
export interface SegmentIdentity {
  source: string;
  routeId: string | null;
  name: string | null;
  segmentKey: string;
}

/**
 * The road as a human would write it: "FR 8040-500".
 *
 * Forest Service route numbers are stored solid — `8040500` — but a seven
 * digit number is a four-digit road and a three-digit spur, and the agency
 * writes it with the hyphen on its own maps. A trailing `000` is the road
 * itself and is dropped. Everything else is left exactly as the agency has it:
 * the ids run from `2` to `34N17` to `505.1`, and inventing structure in those
 * would name a road that does not exist. BLM route numbers mean nothing to a
 * driver, so its roads are named, not numbered.
 */
export function humanSegmentRef(segment: SegmentIdentity): string {
  const routeId = segment.routeId?.trim() ?? "";
  const name = segment.name?.trim() ?? "";
  if (segment.source === "blm_gtlf") {
    if (name !== "") return name;
    if (routeId !== "") return `BLM route ${routeId}`;
    return segment.segmentKey;
  }
  if (routeId !== "") {
    if (/^\d{7}$/.test(routeId)) {
      const road = routeId.slice(0, 4).replace(/^0+(?=\d)/, "");
      const spur = routeId.slice(4);
      return spur === "000" ? `FR ${road}` : `FR ${road}-${spur}`;
    }
    return `FR ${routeId}`;
  }
  if (name !== "") return name;
  return segment.segmentKey;
}

/** Why a trailhead has no stored answer. */
export type SkipReason =
  | "no_snap"
  | "no_anchor"
  | "unranked_path"
  | "not_car_passable";

/** The derived facts for one trailhead, before they are dressed with sources. */
export interface ApproachDerivation {
  summary: ApproachSummary;
  vehicle: VehicleAnswer | null;
  surface: string | null;
  /** The segment that set the vehicle answer, or the surface when there is no vehicle. */
  limiting: SegmentIdentity | null;
  skipReason: SkipReason | null;
}

/**
 * Fold a path into answers.
 *
 * The vehicle answer, the surface and the distance each come from
 * `summarizeApproach`, which is where the worst-on-the-path rule and the
 * unknown rule live together. A path with an unrated edge on it has no vehicle
 * answer at all — not the second-worst known one.
 *
 * **Ties go to the first segment on the path.** `summarizeApproach` keeps a
 * limiting segment only for a strictly worse rank, and the path runs from the
 * trailhead outward, so where several segments share the worst rank — 204 of
 * the 328 derived answers today — the one named is the one nearest the
 * trailhead. That is the right end to name: it is the first rough road a
 * driver meets, and the one they can still turn round on.
 */
export function deriveApproach(path: readonly TraversalEdge[]): ApproachDerivation {
  const summary = summarizeApproach(path);
  const vehicle = summary.vehicle === null ? null : vehicleAnswerFor(
    summary.vehicle.value as VehicleRequirement,
  );
  const surface = summary.surface === null
    ? null
    : surfaceWord(summary.surface.value as RoadSurface);

  const limitingFrom = summary.vehicle ?? summary.surface;
  const limiting = limitingFrom === null
    ? null
    : {
        source: path.find((edge) => edge.segmentKey === limitingFrom.limitingSegmentKey)?.source
          ?? "",
        routeId: limitingFrom.limitingRouteId,
        name: limitingFrom.limitingName,
        segmentKey: limitingFrom.limitingSegmentKey,
      };

  let skipReason: SkipReason | null = null;
  if (summary.vehicle === null) skipReason = "unranked_path";
  else if (vehicle !== null && !vehicle.carPassable) skipReason = "not_car_passable";

  return { summary, vehicle, surface, limiting, skipReason };
}
