import { lines } from './io';
import type { Coord, Relation, Tags, Way } from './types';

export function decodeOpl(value: string): string {
  return value.replace(/%([a-fA-F0-9]+)%/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}
export function parseTags(value: string): Tags {
  const tags: Tags = {};
  for (const pair of value.split(',')) { const eq = pair.indexOf('='); if (eq >= 0) tags[decodeOpl(pair.slice(0, eq))] = decodeOpl(pair.slice(eq + 1)); }
  return tags;
}
export interface OplRecord { type: string; id: number; tags: Tags; nodes: number[]; members: { type: string; id: number; role: string }[]; coord?: Coord }
export function parseOpl(line: string): OplRecord {
  const fields = line.split(' '), record: OplRecord = { type: fields[0][0], id: Number(fields[0].slice(1)), tags: {}, nodes: [], members: [] };
  let lon: number | undefined, lat: number | undefined;
  for (const field of fields.slice(1)) {
    if (field[0] === 'T') record.tags = parseTags(field.slice(1));
    else if (field[0] === 'N') record.nodes = field.slice(1).split(',').filter(Boolean).map(s => Number(s.replace(/^n/, '')));
    else if (field[0] === 'M') record.members = field.slice(1).split(',').filter(Boolean).map(s => {
      const at = s.indexOf('@'); return { type: s[0], id: Number(s.slice(1, at < 0 ? undefined : at)), role: at < 0 ? '' : decodeOpl(s.slice(at + 1)) };
    });
    else if (field[0] === 'x') lon = Number(field.slice(1));
    else if (field[0] === 'y') lat = Number(field.slice(1));
  }
  if (lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat)) record.coord = [lon, lat];
  return record;
}
export function keepWay(tags: Tags, inRelation: boolean): boolean {
  if (['no', 'private'].includes(tags.access)) return false;
  if (['path', 'bridleway', 'steps'].includes(tags.highway)) return true;
  // Some hiking relation members (notably rail trails) use cycleway geometry.
  if (tags.highway === 'cycleway') return ['yes', 'designated'].includes(tags.foot) && (!!tags.name?.trim() || inRelation);
  const named = !!tags.name?.trim();
  if (tags.highway === 'footway') return !['sidewalk', 'crossing'].includes(tags.footway) && (named || inRelation || !!tags.sac_scale || !!tags.trail_visibility);
  return tags.highway === 'track' && (named || inRelation || !!tags.sac_scale);
}
/** Streaming passes avoid holding the 580 MB text or discarded node records. */
export async function readOsm(path: string): Promise<{ ways: Way[]; connectors: Way[]; nodes: Map<number, Coord>; stats: Record<string, number> }> {
  const relations = new Map<number, OplRecord>(), memberships = new Map<number, Map<number, Relation>>();
  const stats: Record<string, number> = { relations: 0, input_ways: 0, filtered_ways: 0, missing_node_ways: 0, kept_ways: 0 };
  for await (const line of lines(path)) if (line[0] === 'r') {
    const r = parseOpl(line); if (['hiking', 'foot', 'mountain_hiking'].includes(r.tags.route)) relations.set(r.id, r);
  }
  for (const r of relations.values()) {
    const meta: Relation = { id: r.id, name: r.tags.name, ref: r.tags.ref, network: r.tags.network };
    const visit = (record: OplRecord, seen: Set<number>) => {
      if (seen.has(record.id)) return; seen.add(record.id);
      for (const member of record.members) {
        if (member.type === 'w') { const set = memberships.get(member.id) ?? new Map<number, Relation>(); set.set(r.id, meta); memberships.set(member.id, set); }
        else if (member.type === 'r' && relations.has(member.id)) visit(relations.get(member.id)!, seen);
      }
    }; visit(r, new Set());
  }
  stats.relations = relations.size;
  const ways: Way[] = [], required = new Set<number>();
  for await (const line of lines(path)) if (line[0] === 'w') {
    stats.input_ways++; const w = parseOpl(line), rels = [...(memberships.get(w.id)?.values() ?? [])].sort((a, b) => a.id - b.id);
    if (!keepWay(w.tags, !!rels.length) || w.nodes.length < 2) { stats.filtered_ways++; continue; }
    ways.push({ id: w.id, tags: w.tags, nodes: w.nodes, relations: rels }); w.nodes.forEach(id => required.add(id));
  }
  console.log(`OSM: ${ways.length} ways selected; reading ${required.size} referenced nodes`);
  // Recover only source pedestrian/track links that touch the selected network.
  // They remain separate until a 400 m geometry limit can be checked.
  const connectors: Way[] = [], selectedNodes = new Set(required);
  for await (const line of lines(path)) if (line[0] === 'w') {
    const w = parseOpl(line);
    if (keepWay(w.tags, memberships.has(w.id)) || ['private', 'no'].includes(w.tags.access) || !['footway', 'track'].includes(w.tags.highway) || w.nodes.length < 2 || !w.nodes.some(n => selectedNodes.has(n))) continue;
    connectors.push({ id: w.id, nodes: w.nodes, tags: w.tags, relations: [] }); w.nodes.forEach(n => required.add(n));
  }
  const nodes = new Map<number, Coord>();
  for await (const line of lines(path)) if (line[0] === 'n') {
    const space = line.indexOf(' '), id = Number(line.slice(1, space)); if (!required.has(id)) continue;
    // Most node tags are unused; avoid allocating their tag dictionaries.
    const x = / x(-?[\d.]+)(?: |$)/.exec(line), y = / y(-?[\d.]+)(?: |$)/.exec(line);
    if (x && y) nodes.set(id, [Number(x[1]), Number(y[1])]);
  }
  const complete = ways.filter(w => { if (w.nodes.every(id => nodes.has(id))) return true; stats.missing_node_ways++; return false; });
  stats.kept_ways = complete.length;
  return { ways: complete, connectors: connectors.filter(w => w.nodes.every(n => nodes.has(n))), nodes, stats };
}
