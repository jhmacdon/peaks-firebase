import { difference, union } from "polyclip-ts";
import { createHash } from "node:crypto";
import { stableMetric, type Outline, type OutlineMetrics } from "./outline-geometry";
import type { GlacierManifestPlace } from "../import-glacier-manifest";
import type { OutlineSource, SelectionCandidate } from "./outline-refresh";

export type InventoryMember = Pick<GlacierManifestPlace, "id" | "osm_key" | "name" | "boundary">;
export type CombinedInventoryRow = {
  key: string;
  inventory_id: string;
  area_km2: number;
  observed_at: string;
  source: Pick<OutlineSource, "key" | "source_url" | "source_sha256" | "credit" | "license" | "license_url" | "license_ok">;
  boundary: Outline;
  /** Place keys, not inventory rows. One row may cover several named places. */
  members: string[];
  /** Explain dated contour/divide differences after checking the residual
   * geometry. A passing area ratio alone never clears missing branches. */
  coverage_review?: { reason: string; evidence: string[] };
  /** Every other snapshot outline overlapping the row needs a reason why
   * it is not a member. Include unnamed ice in this check too; a route may
   * qualify it for the roster. Missing branches fail closed. */
  nonmembers?: Record<string, string>;
  branch_fact_search: Record<string, { source: string; result: string }[]>;
  candidates?: (SelectionCandidate & { boundary: Outline })[];
};
export type CombinedInventoryDecision = {
  independent_fact_rows?: { inventory_id: string; area_km2: number; observed_at: string; source: CombinedInventoryRow["source"]; member: string }[];
  rows: { key: string; inventory_id: string; area_km2: number; observed_at: string; source: CombinedInventoryRow["source"]; members: string[] }[];
  key: string; inventory_id: string; area_km2: number; observed_at: string;
  source: CombinedInventoryRow["source"];
  members: { id: string; osm_key: string; name: string }[];
  summed_osm_area_km2: number; union_osm_area_km2: number; osm_ratio: number;
  inventory_outline_area_km2: number; inventory_outline_sha256: string;
  inventory_covered_km2: number; inventory_covered_share: number;
  residual_parts_km2: number[];
  other_overlaps: { osm_key: string; name: string; area_km2: number; reason: string }[];
  coverage_review: CombinedInventoryRow["coverage_review"] | null;
  branch_fact_search: CombinedInventoryRow["branch_fact_search"];
  candidates: SelectionCandidate[];
  chosen_source: string; flagged: boolean; reason: string;
  facts_flag: "facts: combined rows";
};
type Selection = Pick<CombinedInventoryDecision, "chosen_source" | "flagged" | "reason">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Counts describe places assigned to a parent, including every member of
 * a combined inventory row. No area total or rank is inferred here. */
export function inventoryMemberCounts(places: Pick<GlacierManifestPlace, "id" | "parent_key">[], defaultParent: string) {
  if (new Set(places.map(p => p.id)).size !== places.length) throw new Error("Duplicate inventory member place");
  const counts: Record<string, { named_glacier_count: number; scope: string }> = {};
  for (const p of places) {
    const key = p.parent_key ?? defaultParent;
    counts[key] ??= { named_glacier_count: 0,
      scope: "Included glacier places assigned to this parent; combined inventory rows count each member place" };
    counts[key].named_glacier_count++;
  }
  return counts;
}

/** Connected components of the reviewed, spatially checked row/place crosswalk.
 * Multiple rows sharing a place belong to one group. Edge exclusions (nearby
 * margins rather than branches) remain explicit in nonmembers and the audit. */
export function inventoryComponents(rows: CombinedInventoryRow[]) {
  if (new Set(rows.map(r => r.key)).size !== rows.length) throw new Error("Duplicate inventory row key");
  for (const r of rows) if (!r.key || !r.inventory_id || !Number.isFinite(r.area_km2) || r.area_km2 <= 0
    || !/^\d{4}(-\d{2}-\d{2})?$/.test(r.observed_at) || Number.isNaN(Date.parse(r.observed_at))
    || !r.members.length || new Set(r.members).size !== r.members.length || !r.source.license_ok
    || !r.source.credit || !r.source.license || !/^https?:\/\//.test(r.source.source_url)
    || !/^[a-f0-9]{64}$/.test(r.source.source_sha256)) throw new Error(`Invalid combined inventory row: ${r.key}`);
  const left = new Set(rows), groups: CombinedInventoryRow[][] = [];
  while (left.size) {
    const group = [left.values().next().value!]; left.delete(group[0]);
    for (let i = 0; i < group.length; i++) for (const row of left) {
      if (row.members.some(key => group[i].members.includes(key))) { group.push(row); left.delete(row); }
    }
    groups.push(group.sort((a, b) => a.key < b.key ? -1 : 1));
  }
  return groups;
}

/** Only a one-row/one-place component supplies individual facts. */
export function individualInventoryRows(rows: CombinedInventoryRow[]) {
  return inventoryComponents(rows).filter(g => g.length === 1 && g[0].members.length === 1).map(g => g[0]);
}

export function reviewCombinedInventoryRows(places: InventoryMember[], snapshotPlaces: InventoryMember[],
  rows: CombinedInventoryRow[], metrics: OutlineMetrics,
  select: (osmArea: number, factsArea: number, candidates: SelectionCandidate[]) => Selection): CombinedInventoryDecision[] {
  const components = inventoryComponents(rows);
  return components.flatMap(group => {
    if (group.length === 1 && group[0].members.length === 1) return [];
    for (const row of group) {
      if (!row.members.length || new Set(row.members).size !== row.members.length) throw new Error("Invalid combined inventory row");
      for (const key of row.members) {
        const p = places.find(p => p.osm_key === key);
        if (!p || metrics.overlap(p.boundary, row.boundary).intersection_km2 <= 0)
          throw new Error(`${row.key}: crosswalk edge ${key} has no outline overlap`);
      }
    }
    const members = [...new Set(group.flatMap(r => r.members))].sort();
    const merged: CombinedInventoryRow = { ...group[0],
      key: group.map(r => r.key).join("+"), inventory_id: group.map(r => r.inventory_id).join(" + "),
      area_km2: stableMetric(group.reduce((n, r) => n + r.area_km2, 0)),
      boundary: { type: "MultiPolygon", coordinates: union(group[0].boundary.coordinates, ...group.slice(1).map(r => r.boundary.coordinates)) },
      members, nonmembers: Object.assign({}, ...group.map(r => r.nonmembers)),
      branch_fact_search: Object.assign({}, ...group.map(r => r.branch_fact_search)),
      coverage_review: { reason: group.map(r => r.coverage_review?.reason ?? "").join("; "),
        evidence: group.flatMap(r => r.coverage_review?.evidence ?? []) },
    };
    if (group.length > 1) merged.candidates = new Set(group.map(r => r.source.key)).size === 1
      ? [{ key: group[0].source.key, boundary: merged.boundary, area_km2: metrics.area(merged.boundary),
        observed_at: group.map(r => r.observed_at).sort()[0], license_ok: group.every(r => r.source.license_ok) }] : [];
    const result = reviewGroup(places, snapshotPlaces, [merged], metrics, select)[0];
    result.rows = group.map(({ key, inventory_id, area_km2, observed_at, source, members }) =>
      ({ key, inventory_id, area_km2, observed_at, source, members }));
    return [result];
  });
}

/** Compare a combined inventory figure with the complete group. Never put
 * that figure on a member or divide it in proportion to mapped geometry. */
function reviewGroup(places: InventoryMember[], snapshotPlaces: InventoryMember[],
  rows: CombinedInventoryRow[], metrics: OutlineMetrics,
  select: (osmArea: number, factsArea: number, candidates: SelectionCandidate[]) => Selection): CombinedInventoryDecision[] {
  const used = new Set<string>(), keys = new Set<string>();
  const snapshot = new Map(snapshotPlaces.map(p => [p.osm_key, p]));
  if (snapshot.size !== snapshotPlaces.length) throw new Error("Duplicate snapshot place in combined-row check");
  return rows.map(row => {
    if (!row.key || keys.has(row.key) || !row.inventory_id || !Number.isFinite(row.area_km2) || row.area_km2 <= 0
      || !/^\d{4}(-\d{2}-\d{2})?$/.test(row.observed_at) || Number.isNaN(Date.parse(row.observed_at))
      || !row.source.license_ok || !row.source.credit || !row.source.license
      || !/^https?:\/\//.test(row.source.source_url) || !/^[a-f0-9]{64}$/.test(row.source.source_sha256)
      || row.members.length < 1 || new Set(row.members).size !== row.members.length)
      throw new Error(`Invalid combined inventory row: ${row.key}`);
    keys.add(row.key);
    metrics.validate(row.boundary);
    const members = row.members.map(key => {
      const place = places.find(p => p.osm_key === key), raw = snapshot.get(key);
      if (!place || !raw || hash(place.boundary) !== hash(raw.boundary))
        throw new Error(`${row.key}: member ${key} is missing from the original OSM roster/snapshot`);
      if (used.has(key)) throw new Error(`${row.key}: member ${key} is counted in two combined rows`);
      used.add(key);
      const overlap = metrics.overlap(place.boundary, row.boundary);
      if (!(overlap.intersection_km2 > 0 && (overlap.iou >= 0.1 || overlap.osm_share >= 0.5)))
        throw new Error(`${row.key}: member ${key} does not spatially match the combined row`);
      if (!row.branch_fact_search[key]?.length || row.branch_fact_search[key].some(s => !s.source.trim() || !s.result.trim()))
        throw new Error(`${row.key}: search dated branch facts before leaving ${key} null`);
      return place;
    });
    // Test each pair as well as the union, so a small double-counted branch
    // cannot hide in a large group's sum.
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const overlap = metrics.overlap(members[i].boundary, members[j].boundary).intersection_km2;
      const smaller = Math.min(metrics.area(members[i].boundary), metrics.area(members[j].boundary));
      if (overlap > 0.01 || overlap / smaller > 0.01)
        throw new Error(`${row.key}: members ${members[i].name} and ${members[j].name} double-count ice`);
    }
    const joined: Outline = { type: "MultiPolygon", coordinates: union(members[0].boundary.coordinates,
      ...members.slice(1).map(p => p.boundary.coordinates)) };
    metrics.validate(joined);
    const summed = stableMetric(members.reduce((sum, p) => sum + metrics.area(p.boundary), 0));
    const rowArea = metrics.area(row.boundary), overlap = metrics.overlap(joined, row.boundary);
    const residual = difference(row.boundary.coordinates, joined.coordinates);
    const residualParts = residual.map(p => metrics.area({ type: "MultiPolygon", coordinates: [p] }))
      .filter(a => a > 1e-9).sort((a, b) => b - a);
    const otherOverlaps = snapshotPlaces.filter(p => !row.members.includes(p.osm_key)).flatMap(p => {
      const bounds = (g: Outline) => { const v = g.coordinates.flat(2); return [Math.min(...v.map(p => p[0])), Math.min(...v.map(p => p[1])), Math.max(...v.map(p => p[0])), Math.max(...v.map(p => p[1]))]; };
      const a = bounds(p.boundary), b = bounds(row.boundary);
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) return [];
      const o = metrics.overlap(p.boundary, row.boundary);
      if (o.intersection_km2 < 0.01 && o.osm_share < 0.5) return [];
      const reason = row.nonmembers?.[p.osm_key];
      if (!reason?.trim()) throw new Error(`${row.key}: possible missing branch ${p.name} (${p.osm_key}); include it or review the crosswalk`);
      return [{ osm_key: p.osm_key, name: p.name, area_km2: o.intersection_km2, reason }];
    }).sort((a, b) => a.osm_key < b.osm_key ? -1 : 1);
    if (rowArea - overlap.intersection_km2 > 0.01 && (!row.coverage_review?.reason.trim() || !row.coverage_review.evidence.length))
      throw new Error(`${row.key}: combined inventory outline has uncovered ice; review residual parts and missing branches`);
    const candidates = (row.candidates ?? []).map(({ boundary, ...c }) => {
      metrics.validate(boundary);
      const o = metrics.overlap(joined, boundary);
      if (!(o.intersection_km2 > 0 && (o.iou >= 0.1 || o.candidate_share >= 0.5)))
        throw new Error(`${row.key}: combined candidate ${c.key} fails spatial overlap`);
      if (c.area_km2 !== metrics.area(boundary)) throw new Error(`${row.key}: candidate area is not measured from its outline`);
      return c;
    });
    const ratio = stableMetric(summed / row.area_km2);
    const choice = ratio >= 0.67 && ratio <= 1.5
      ? { chosen_source: "osm", flagged: false, reason: "Combined group OSM/facts ratio is within [0.67, 1.5]; keep every member's OSM outline" }
      : select(summed, row.area_km2, candidates);
    return { rows: [], key: row.key, inventory_id: row.inventory_id, area_km2: row.area_km2, observed_at: row.observed_at,
      source: row.source, members: members.map(({ id, osm_key, name }) => ({ id, osm_key, name })),
      summed_osm_area_km2: summed, union_osm_area_km2: metrics.area(joined), osm_ratio: ratio,
      inventory_outline_area_km2: rowArea, inventory_outline_sha256: hash(row.boundary),
      inventory_covered_km2: overlap.intersection_km2, inventory_covered_share: stableMetric(overlap.intersection_km2 / rowArea),
      residual_parts_km2: residualParts, other_overlaps: otherOverlaps, coverage_review: row.coverage_review ?? null,
      branch_fact_search: row.branch_fact_search, candidates, ...choice, facts_flag: "facts: combined rows" as const };
  });
}
