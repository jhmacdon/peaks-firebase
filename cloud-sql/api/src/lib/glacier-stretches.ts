/** Display decisions use metres along the original track, never sample counts. */
export const GLACIER_STRETCH_THRESHOLDS = Object.freeze({
  // Round decision distances/support to 5 m; keep exact distances in the response.
  decision_step_m: 5,
  // An isolated neighbour excursion between two visits to the same glacier.
  sliver_max_m: 40,
  // Bridge brief rock gaps only when the glacier on both sides is the same.
  same_glacier_gap_m: 200,
  // Alternation must be nearly continuous to count as boundary jitter.
  border_gap_m: 20,
  // Preserve substantial, unambiguous runs as anchors beside a jitter zone.
  settled_run_m: 400,
  // A border needs both meaningful distance and repeated switches.
  border_min_span_m: 300,
  border_min_switches: 3,
  // At least 20% of support must belong to glaciers other than the leader.
  border_min_minor_share: 0.2,
  // Absorb a transition only up to 600 m AND half the shorter settled flank.
  transition_max_span_m: 600,
  transition_flank_fraction: 0.5,
});

/** The subset of stored crossing fields used by the display layer. */
export interface GlacierCrossing {
  destination_id: string;
  name: string;
  kind: "glacier" | "snowfield";
  pass_index?: number;
  entered_distance_m: number;
  exited_distance_m: number;
  entered_at?: string | null;
  exited_at?: string | null;
  segment_number?: number | null;
  min_elevation_m: number | null;
  max_elevation_m: number | null;
}

export interface GlacierStretch {
  kind: "glacier" | "border";
  destinations: { id: string; name: string; kind: GlacierCrossing["kind"]; share: number }[];
  entered_distance_m: number;
  exited_distance_m: number;
  entered_at?: string | null;
  exited_at?: string | null;
  segment_number?: number | null;
  min_elevation_m: number | null;
  max_elevation_m: number | null;
  crossing_indexes: number[];
}

type IndexedCrossing = { crossing: GlacierCrossing; index: number };
type Events = { entries: IndexedCrossing[]; exits: IndexedCrossing[] };
interface Run {
  start: number;
  end: number;
  // Matched length per destination; gaps contribute no support.
  support: Map<string, number>;
  indexes: number[];
  entered_at?: string | null;
  exited_at?: string | null;
  segment_number?: number | null;
}

const thresholds = GLACIER_STRETCH_THRESHOLDS;
const decisionMetres = (value: number): number =>
  Math.round(value / thresholds.decision_step_m) * thresholds.decision_step_m;
const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const singleId = (run: Run): string | undefined =>
  run.support.size === 1 ? run.support.keys().next().value : undefined;
const gap = (a: Run, b: Run): number => decisionMetres(Math.max(0, b.start - a.end));

function combine(runs: readonly Run[], absorbInto?: string): Run {
  const first = runs[0], last = runs[runs.length - 1];
  const support = new Map<string, number>();
  for (const run of runs) for (const [id, length] of run.support) {
    const key = absorbInto ?? id;
    support.set(key, (support.get(key) ?? 0) + length);
  }
  return { start: first.start, end: last.end, support,
    indexes: [...new Set(runs.flatMap(run => run.indexes))].sort((a, b) => a - b),
    entered_at: first.entered_at, exited_at: last.exited_at, segment_number: first.segment_number };
}

function coalesce(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  for (const run of runs) {
    const previous = result[result.length - 1];
    const id = singleId(run);
    if (previous && id !== undefined && singleId(previous) === id
      && gap(previous, run) <= thresholds.same_glacier_gap_m) {
      result[result.length - 1] = combine([previous, run]);
    } else result.push(run);
  }
  return result;
}

/** Use endpoint times already present in the input, including explicit nulls. */
function endpointTime(events: Events, entry: boolean): string | null | undefined {
  const values = entry
    ? [...events.entries.map(c => c.crossing.entered_at), ...events.exits.map(c => c.crossing.exited_at)]
    : [...events.exits.map(c => c.crossing.exited_at), ...events.entries.map(c => c.crossing.entered_at)];
  return values.find(value => value !== undefined);
}

/** Sweep endpoints so overlapping outlines do not double-count the same glacier.
 * Each active destination gets the interval's length; simultaneous destinations
 * share that interval when support is normalized in the final row.
 */
function buildRuns(crossings: readonly IndexedCrossing[]): Run[] {
  const events = new Map<number, Events>();
  for (const item of crossings) {
    for (const [distance, key] of [[item.crossing.entered_distance_m, "entries"],
      [item.crossing.exited_distance_m, "exits"]] as const) {
      if (!events.has(distance)) events.set(distance, { entries: [], exits: [] });
      events.get(distance)![key].push(item);
    }
  }
  const distances = [...events.keys()].sort((a, b) => a - b);
  const active = new Map<number, IndexedCrossing>();
  const runs: Run[] = [];
  for (let i = 0; i < distances.length - 1; i++) {
    const start = distances[i], end = distances[i + 1];
    const event = events.get(start)!;
    for (const item of event.exits) active.delete(item.index);
    for (const item of event.entries) active.set(item.index, item);
    if (!active.size) continue;
    const support = new Map([...active.values()].map(({ crossing }) => [crossing.destination_id, end - start]));
    const run: Run = { start, end, support, indexes: [...active.keys()].sort((a, b) => a - b),
      entered_at: endpointTime(event, true), exited_at: endpointTime(events.get(end)!, false),
      segment_number: crossings[0].crossing.segment_number };
    const previous = runs[runs.length - 1];
    // A sweep endpoint alone must not count as another switch.
    if (previous?.end === start && previous.support.size === support.size
      && [...support.keys()].every(id => previous.support.has(id))) {
      runs[runs.length - 1] = combine([previous, run]);
    } else runs.push(run);
  }
  return coalesce(runs);
}

function absorbSlivers(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  // Resolve overlapping candidates in travel order, rather than by input order.
  for (const run of runs) {
    result.push(run);
    while (result.length >= 3) {
      const [before, middle, after] = result.slice(-3);
      const id = singleId(before);
      if (id === undefined || singleId(after) !== id || singleId(middle) === undefined
        || singleId(middle) === id || decisionMetres(middle.end - middle.start) > thresholds.sliver_max_m
        || gap(before, middle) > thresholds.border_gap_m || gap(middle, after) > thresholds.border_gap_m) break;
      result.splice(-3, 3, combine([before, middle, after], id));
    }
  }
  return coalesce(result);
}

function rankedSupport(run: Run): { id: string; length: number }[] {
  return [...run.support].map(([id, length]) => ({ id,
    length: Math.max(thresholds.decision_step_m, decisionMetres(length)) }))
    .sort((a, b) => b.length - a.length || compareIds(a.id, b.id));
}

function isSettled(run: Run): boolean {
  const id = singleId(run);
  return id !== undefined && decisionMetres(run.support.get(id)!) >= thresholds.settled_run_m;
}

function displayBlock(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  for (let i = 0; i < runs.length;) {
    if (isSettled(runs[i])) { result.push(runs[i++]); continue; }
    const start = i;
    while (i < runs.length && !isSettled(runs[i])) i++;
    const group = runs.slice(start, i);
    const combined = combine(group);
    const before = start > 0 ? runs[start - 1] : undefined;
    const after = runs[i];
    const beforeId = before && singleId(before), afterId = after && singleId(after);
    const transitionLimit = before && after ? Math.min(thresholds.transition_max_span_m,
      thresholds.transition_flank_fraction * Math.min(decisionMetres(before.support.get(beforeId!)!),
        decisionMetres(after.support.get(afterId!)!))) : 0;
    if (beforeId !== undefined && afterId !== undefined && beforeId !== afterId
      && [...combined.support.keys()].every(id => id === beforeId || id === afterId)
      && decisionMetres(combined.end - combined.start) <= transitionLimit) {
      // Keep the settled glacier after the last switch. All earlier jitter goes
      // to the preceding glacier; the boundary is an existing crossing endpoint.
      result[result.length - 1] = combine([result[result.length - 1], combined], beforeId);
      continue;
    }
    // A new glacier at either end is a separate visit, not evidence of border
    // jitter. Keep it even just below the settled threshold (e.g. crater ice).
    const occurrences = new Map<string, number>();
    for (const run of group) for (const id of run.support.keys())
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    const isolated = (run: Run): boolean => {
      const id = singleId(run);
      return id !== undefined && occurrences.get(id) === 1;
    };
    let first = 0, last = group.length;
    while (first < last && isolated(group[first])) first++;
    while (last > first && isolated(group[last - 1])) last--;
    if (first === last) { result.push(...group); continue; }
    const section = group.slice(first, last);
    const border = combine(section);
    const support = rankedSupport(border);
    const total = support.reduce((sum, item) => sum + item.length, 0);
    const sustained = support.length > 1
      && decisionMetres(border.end - border.start) >= thresholds.border_min_span_m
      && (section.length - 1 >= thresholds.border_min_switches || section.some(run => run.support.size > 1))
      && support[0].length / total <= 1 - thresholds.border_min_minor_share;
    if (sustained) result.push(...group.slice(0, first), border, ...group.slice(last));
    else result.push(...group);
  }
  return coalesce(result);
}

function displayRuns(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  for (let i = 0; i < runs.length;) {
    const start = i++;
    while (i < runs.length && gap(runs[i - 1], runs[i]) <= thresholds.border_gap_m) i++;
    result.push(...displayBlock(runs.slice(start, i)));
  }
  return result;
}

/** Derive display spans without changing crossings or joining recording segments.
 * Indexes always refer to the original input, even when it arrives unsorted.
 * A source crossing can contribute to several rows when outlines overlap.
 */
export function buildGlacierStretches(crossings: readonly GlacierCrossing[]): GlacierStretch[] {
  const sorted = crossings.map((crossing, index) => ({ crossing, index }))
    .filter(({ crossing: c }) => Number.isFinite(c.entered_distance_m) && Number.isFinite(c.exited_distance_m)
      && c.exited_distance_m > c.entered_distance_m)
    .sort((a, b) => a.crossing.entered_distance_m - b.crossing.entered_distance_m
      || compareIds(a.crossing.destination_id, b.crossing.destination_id)
      || (a.crossing.pass_index ?? 0) - (b.crossing.pass_index ?? 0) || a.index - b.index);
  const segments = new Map<number | null | undefined, IndexedCrossing[]>();
  const destinations = new Map<string, GlacierCrossing>();
  for (const item of sorted) {
    const segment = item.crossing.segment_number;
    if (!segments.has(segment)) segments.set(segment, []);
    segments.get(segment)!.push(item);
    if (!destinations.has(item.crossing.destination_id)) destinations.set(item.crossing.destination_id, item.crossing);
  }
  const runs = [...segments.values()].flatMap(segment => displayRuns(absorbSlivers(buildRuns(segment))));
  return runs.map(run => {
    const support = rankedSupport(run);
    const total = support.reduce((sum, item) => sum + item.length, 0);
    const elevations = (key: "min_elevation_m" | "max_elevation_m"): number[] =>
      run.indexes.map(index => crossings[index][key]).filter((value): value is number =>
        typeof value === "number" && Number.isFinite(value));
    const minimums = elevations("min_elevation_m"), maximums = elevations("max_elevation_m");
    return {
      kind: support.length === 1 ? "glacier" as const : "border" as const,
      destinations: support.map(({ id, length }) => {
        const destination = destinations.get(id)!;
        return { id, name: destination.name, kind: destination.kind, share: length / total };
      }),
      entered_distance_m: run.start, exited_distance_m: run.end,
      ...(run.entered_at !== undefined ? { entered_at: run.entered_at } : {}),
      ...(run.exited_at !== undefined ? { exited_at: run.exited_at } : {}),
      ...(run.segment_number !== undefined ? { segment_number: run.segment_number } : {}),
      min_elevation_m: minimums.length ? Math.min(...minimums) : null,
      max_elevation_m: maximums.length ? Math.max(...maximums) : null,
      crossing_indexes: run.indexes,
    };
  }).sort((a, b) => a.entered_distance_m - b.entered_distance_m
    || (a.segment_number ?? -1) - (b.segment_number ?? -1)
    || a.exited_distance_m - b.exited_distance_m
    || compareIds(a.destinations[0].id, b.destinations[0].id));
}
