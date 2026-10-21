import { sha, type Plan } from "./apply";

type Span = { start_m: number; end_m: number };

/** Merge coverage before measuring it, so gaps and repeated intervals count correctly. */
function union(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.start_m - b.start_m)) {
    const last = merged[merged.length - 1];
    if (last && span.start_m <= last.end_m) last.end_m = Math.max(last.end_m, span.end_m);
    else merged.push({ ...span });
  }
  return merged;
}

/** Intersection over union of covered route metres, including gaps between intervals. */
export function intervalIoU(a: Span[], b: Span[]): number {
  const left = union(a), right = union(b);
  let intersection = 0, i = 0, j = 0;
  while (i < left.length && j < right.length) {
    intersection += Math.max(0, Math.min(left[i].end_m, right[j].end_m) - Math.max(left[i].start_m, right[j].start_m));
    if (left[i].end_m < right[j].end_m) i++;
    else j++;
  }
  const length = (spans: Span[]) => spans.reduce((sum, s) => sum + s.end_m - s.start_m, 0);
  const total = length(left) + length(right) - intersection;
  return total > 0 ? intersection / total : 1;
}

export interface Comparison {
  agree: boolean;
  escalate: boolean;
  reasons: string[];
  a_plan_hash: string | null;
  b_plan_hash: string | null;
}

/** Agreement can still need a person: holds, technical terrain and flags always do. */
export function comparePlans(a: Plan | null, b: Plan | null, aProblems: string[] = [], bProblems: string[] = []): Comparison {
  const disagreements: string[] = [
    ...aProblems.map(p => `a: ${p}`), ...bProblems.map(p => `b: ${p}`),
  ];
  const escalations: string[] = [];
  if (!a) disagreements.push("a: no valid plan");
  if (!b) disagreements.push("b: no valid plan");
  if (a && b) {
    const kinds = (p: Plan) => new Set(p.intervals.filter(i => i.kind !== "trail").map(i => i.kind));
    const ak = kinds(a), bk = kinds(b);
    if (ak.has("hold") !== bk.has("hold")) disagreements.push("holds appear in only one plan");
    for (const kind of new Set([...ak, ...bk])) {
      if (!ak.has(kind) || !bk.has(kind)) {
        disagreements.push(`${kind} appears in only one plan`);
        continue;
      }
      const iou = intervalIoU(a.intervals.filter(i => i.kind === kind), b.intervals.filter(i => i.kind === kind));
      if (iou < 0.8) disagreements.push(`${kind} coverage IoU ${iou.toFixed(3)} is below 0.8`);
    }
    if ((a.summary === null) !== (b.summary === null)) disagreements.push("only one summary is null");
    if ((a.summary?.hardest_class ?? null) !== (b.summary?.hardest_class ?? null)) disagreements.push("summary.hardest_class differs");
  }
  for (const [name, p] of [["a", a], ["b", b]] as const) {
    if (!p) continue;
    for (const kind of ["climb", "climbers_route", "hold"] as const)
      if (p.intervals.some(i => i.kind === kind)) escalations.push(`${name}: ${kind} needs a person`);
    escalations.push(...p.flags.map(flag => `${name}: plan flag: ${flag}`));
  }
  const reasons = [...disagreements, ...escalations];
  return { agree: disagreements.length === 0, escalate: reasons.length > 0, reasons, a_plan_hash: a ? sha(a) : null, b_plan_hash: b ? sha(b) : null };
}
