import { join } from 'node:path';
import { Grid, hash, length, lineIndex, midpoint, nearest, pointDistance, samples, unique, type Primitive } from './geo';
import { vertexIndex, type SourceFeature } from './features';
import { classify, glacierIndex, provenance, refresh, SOURCES } from './topology';
import type { AltSource, Coord, Glacier, Segment, Tags } from './types';
import { geojsonFeatures } from './io';
import { displayName } from './display-names';
import { intersectsBbox, type Bbox } from './state';

export interface AgencyLine { coords: Coord[]; source: keyof typeof SOURCES; id: string; name: string | null; number: string | null; names: string[]; group: string; retrieved_at: string; tags?: Tags }
const clean = (v: unknown): string | null => { const s = String(v ?? '').trim(); return !s || /^(n\/a|none|unknown|unnamed)$/i.test(s) ? null : s; };
export function agencyLine(f: SourceFeature, source: AgencyLine['source'], retrievedAt: string): AgencyLine[] {
  if (!f.geometry) return [];
  const p = f.properties;
  // These are pedestrian graphs. Winter-only USFS lines need their own graph.
  if (source === 'usfs' && (p.trail_type === 'SNOW' || /^(yes|restricted)$/i.test(p.hiker_pedestrian_restricted ?? ''))) return [];
  if (source === 'nps' && ((p.TRLSTATUS && p.TRLSTATUS !== 'Existing') || /^(no|false)$/i.test(p.OPENTOPUBLIC ?? ''))) return [];
  if (source === 'wa_state_parks' && /closed|private|no access|planned|decommissioned|abandoned/i.test(String(p.ACCESS_STA ?? '') + ' ' + String(p.TrailStatus ?? ''))) return [];
  const name = displayName(clean(source === 'usfs' ? p.trail_name : source === 'nps' ? p.TRLNAME : p.TR_NM));
  const number = clean(source === 'usfs' ? p.trail_no : source === 'nps' ? p.TRLNUM : p.TR_NUM || p.trail_number);
  const alt = displayName(clean(source === 'nps' ? p.TRLALTNAME : source === 'wa_state_parks' ? p.TR_ALT_NM : null));
  const official = name && number ? `${name}${/\btrail\b/i.test(name) ? '' : ' Trail'} #${number}` : name ?? (number ? `Trail #${number}` : null);
  const names = unique([official, name, alt].filter((s): s is string => !!s));
  const id = String(f.id ?? p.objectid ?? p.OBJECTID);
  const paths: Coord[][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  const tags: Tags = {};
  for (const [key, value] of Object.entries(p)) if (/national.*trail|designation|scenic|historic/i.test(key) && value !== null && value !== undefined) tags[key] = String(value);
  return paths.filter(coords => coords.length >= 2).map(coords => ({ coords: coords.map(c => [c[0], c[1]]), source, id, name, number, names,
    group: JSON.stringify([source, name ?? id, number]), retrieved_at: retrievedAt, ...(Object.keys(tags).length ? { tags } : {}) }));
}
export async function readAgencies(dir: string, bbox?: Bbox): Promise<{ lines: AgencyLine[]; counts: Record<string, { input: number; excluded: number; parts: number }> }> {
  const { stat } = await import('node:fs/promises'); const lines: AgencyLine[] = [], counts: Record<string, { input: number; excluded: number; parts: number }> = {};
  for (const source of Object.keys(SOURCES) as AgencyLine['source'][]) {
    const path = join(dir, `${source}_trails.geojson`); let retrieved: string;
    try { retrieved = (await stat(path)).mtime.toISOString(); }
    catch (error) { if (source === 'wa_state_parks' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const count = { input: 0, excluded: 0, parts: 0 };
    for await (const f of geojsonFeatures<SourceFeature>(path)) {
      count.input++; const parts = agencyLine(f, source, retrieved).filter(a => !bbox || intersectsBbox(a.coords, bbox));
      if (!parts.length) count.excluded++; count.parts += parts.length; lines.push(...parts);
    }
    counts[source] = count;
  } return { lines, counts };
}
/** Union multipart/record pieces with the same official identity before the 80% test. */
export function matchedAgencies(coords: Coord[], agencies: AgencyLine[], index: Grid<Primitive>): AltSource[] {
  const covered = new Map<string, number>(), touched = new Map<string, Set<number>>(); const total = length(coords);
  for (const { point, weight } of samples(coords)) {
    const groups = new Set<string>();
    for (const edge of index.near(point, 15)) if (pointDistance(point, edge.a, edge.b) <= 15) {
      const group = agencies[edge.owner].group; groups.add(group); const set = touched.get(group) ?? new Set<number>(); set.add(edge.owner); touched.set(group, set);
    }
    for (const group of groups) covered.set(group, (covered.get(group) ?? 0) + weight);
  }
  const result = new Map<string, AltSource>();
  for (const [group, metres] of covered) if (total > 0 && metres / total >= 0.8 - 1e-9)
    for (const i of touched.get(group)!) { const a = agencies[i]; result.set(`${a.source}:${a.id}`, { source: a.source, id: a.id, name: a.name, number: a.number, ...(a.tags ? { tags: a.tags } : {}) }); }
  return [...result.values()].sort((a, b) => `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`));
}
export function unmatchedStretches(coords: Coord[], osm: Grid<Primitive>): Coord[][] {
  const stretches: Coord[][] = []; let current: Coord[] = [], previousA: Coord | null = null, unmatchedLength = 0;
  const flush = () => { if (current.length > 1 && unmatchedLength >= 1000) stretches.push(current); current = []; unmatchedLength = 0; };
  for (const { point, a, b, weight } of samples(coords)) {
    const matched = osm.near(point, 15).some(e => pointDistance(point, e.a, e.b) <= 15);
    // Keep one overlap sample at transitions, so the new stretch can node to
    // the graph it just left. Otherwise its new endpoint starts >15 m away.
    if (matched) { if (current.length) current.push(b); flush(); }
    else { if (!current.length) { if (previousA) current.push(previousA); current.push(a); } current.push(b); unmatchedLength += weight; }
    previousA = a;
  } flush(); return stretches;
}
export function conflate(segments: Segment[], agencies: AgencyLine[], glaciers: Glacier[] = []): { segments: Segment[]; stats: Record<string, number> } {
  const stats = { matched_osm_segments: 0, agency_only_segments: 0, agency_only_length_m: 0, snapped_agency_ends: 0, osm_splits: 0 };
  {
    const index = lineIndex(agencies), names = new Map(agencies.map(a => [`${a.source}:${a.id}`, a.names]));
    for (const segment of segments) {
      segment.alt_sources = matchedAgencies(segment.coords, agencies, index);
      if (segment.alt_sources.length) stats.matched_osm_segments++;
      segment.trail_names = unique([...segment.alt_sources.flatMap(a => names.get(`${a.source}:${a.id}`) ?? []), ...segment.trail_names]);
    }
  }
  console.log(`Agency names: ${stats.matched_osm_segments} OSM segments matched`);
  const osm = lineIndex(segments), vertices = vertexIndex(segments), added: Segment[] = [], cuts = new Map<number, Set<number>>(), ice = glacierIndex(glaciers);
  for (const a of agencies) for (const coords of unmatchedStretches(a.coords, osm)) {
    const ids = coords.map(c => `agency-${hash(JSON.stringify(c))}`);
    for (const i of [0, coords.length - 1]) {
      const hit = nearest(vertices, coords[i], 30);
      if (hit) {
        coords[i] = hit.value.coord; ids[i] = hit.value.id; stats.snapped_agency_ends++;
        const set = cuts.get(hit.value.segment) ?? new Set<number>(); set.add(hit.value.vertex); cuts.set(hit.value.segment, set);
      }
    }
    const kind = classify({ id: 0, nodes: [], tags: { highway: 'path' }, relations: [] }, midpoint(coords), ice);
    const segment = refresh({ id: '', name: a.name, trail_names: a.names, kind, sac_scale: null, trail_visibility: null,
      osm_way_ids: [], osm_edge_way_ids: [], relation_names: [], relations: [], start_node: '', end_node: '', coords, node_ids: ids, length_m: 0,
      provenance: provenance([], a.retrieved_at, a.source, a.id), alt_sources: [{ source: a.source, id: a.id, name: a.name, number: a.number, ...(a.tags ? { tags: a.tags } : {}) }] });
    added.push(segment); stats.agency_only_segments++; stats.agency_only_length_m += segment.length_m;
  }
  const split: Segment[] = [];
  segments.forEach((s, i) => {
    const indices = [...new Set([0, ...(cuts.get(i) ?? []), s.coords.length - 1])].sort((a, b) => a - b);
    for (let j = 1; j < indices.length; j++) {
      const from = indices[j - 1], to = indices[j];
      split.push(refresh({ ...s, coords: s.coords.slice(from, to + 1), node_ids: s.node_ids.slice(from, to + 1), osm_edge_way_ids: s.osm_edge_way_ids.slice(from, to) }));
    } stats.osm_splits += indices.length - 2;
  });
  return { segments: [...split, ...added], stats };
}
