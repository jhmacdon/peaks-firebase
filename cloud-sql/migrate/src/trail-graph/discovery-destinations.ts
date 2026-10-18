import { join, resolve } from 'node:path';
import { ndjson } from './io';
import { Grid, haversine } from './geo';
import { databaseFeature, placeKey } from './names';
import { DestinationResolver } from './load-matching';
import type { AccessPoint, ComposedRoute, DraftRoute, PeaksDestination, PlaceRef } from './catalog-types';
import type { StateCode } from './state';
import type { Coord, NamedFeature } from './types';

/** Use the loader's OSM identities and source snapshots before geometry is final. */
export class DiscoveryDestinations {
  readonly byId: Map<string, PeaksDestination>;
  readonly stats = { resolved: 0, summit_connectors: 0, summit_refused: 0 };
  private resolver: DestinationResolver;
  private grid = new Grid<PeaksDestination>(400);
  private sourceMatches = new Map<string, string>();
  constructor(readonly destinations: PeaksDestination[]) {
    this.byId = new Map(destinations.map(d => [d.id, d]));
    this.resolver = new DestinationResolver(destinations);
    for (const d of destinations) this.grid.add([d.lng, d.lat], [d.lng, d.lat], d);
  }
  resolve(ref: PlaceRef): PlaceRef {
    if (ref.peaks_id || !ref.new) return ref;
    const identity = ref.new.source.osm_id, known = identity && this.sourceMatches.get(identity);
    if (known) { this.stats.resolved++; return { peaks_id: known }; }
    const matched = this.resolver.resolve(ref);
    if (matched.peaks_id && this.byId.has(matched.peaks_id)) {
      if (identity) this.sourceMatches.set(identity, matched.peaks_id);
      this.stats.resolved++; return matched;
    }
    // The bulk importer also accepts a same-name, same-kind Peaks point within
    // 400 m. Never return the resolver's transient within-load destination IDs.
    const p = ref.new, point: Coord = [p.lng, p.lat], feature = databaseFeature(p.feature);
    const candidates = this.grid.near(point, 400).filter(d => d.features.includes(feature) && placeKey(d.name) === placeKey(p.name))
      .map(d => ({ d, distance: haversine(point, [d.lng, d.lat]) })).filter(x => x.distance <= 400)
      .sort((a, b) => a.distance - b.distance || a.d.id.localeCompare(b.d.id));
    if (!candidates.length) return ref;
    if (identity) this.sourceMatches.set(identity, candidates[0].d.id);
    this.stats.resolved++; return { peaks_id: candidates[0].d.id };
  }
  resolveRow(row: ComposedRoute): NonNullable<DraftRoute['source_places']> {
    const sources: NonNullable<DraftRoute['source_places']> = {};
    for (const key of ['trailhead', 'objective', 'end_trailhead'] as const) {
      const ref = row[key]; if (!ref) continue;
      if (ref.new) sources[key] = ref.new;
      row[key] = this.resolve(ref);
    }
    return sources;
  }
  graphContacts(features: NamedFeature[], access: AccessPoint[]): Map<string, { coord: Coord; summit: boolean }> {
    const contacts = new Map<string, { coord: Coord; summit: boolean }>();
    const add = (osm_id: string, name: string, feature: string, coord: Coord) => {
      const ref = this.resolve({ new: { name, feature, lng: coord[0], lat: coord[1], source: { kind: 'osm', osm_id } } });
      const destination = this.byId.get(ref.peaks_id ?? '');
      if (destination) contacts.set(osm_id, { coord: [destination.lng, destination.lat], summit: destination.features.includes('summit') });
    };
    for (const f of features) add(f.osm_id, f.name, f.feature, [f.lon, f.lat]);
    for (const p of access) if (p.parking && p.name && !contacts.has(p.osm_id)) add(p.osm_id, p.name, 'trailhead', p.coord);
    return contacts;
  }
}
export function discoverySnapshotPath(state: StateCode, input: string): string {
  return state === 'WA' ? join(input, 'peaks-snapshot/wa-destinations.ndjson')
    : resolve(input, '../peaks-snapshot', `${state.toLowerCase()}-destinations.ndjson`);
}
export async function loadDiscoveryDestinations(state: StateCode, input: string): Promise<DiscoveryDestinations> {
  const rows: PeaksDestination[] = [];
  for await (const row of ndjson<PeaksDestination>(discoverySnapshotPath(state, input))) {
    if (!row.id || !row.name || !Array.isArray(row.features) || !Number.isFinite(row.lng) || !Number.isFinite(row.lat)) throw new Error('Invalid Peaks destination snapshot row');
    rows.push(row);
  }
  return new DiscoveryDestinations(rows);
}
