import type { Coord, NamedFeature, Provenance, Segment } from './types';
import type { RouteStep } from './router';

export interface Seed {
  name: string; aliases: string[]; kind: 'summit' | 'destination' | 'loop' | 'traverse';
  objective: { name: string; feature: string } | null; trailhead: { name: string; land_manager?: string };
  trails: string[]; region: string; approx_roundtrip_mi: number; approx_gain_ft: number;
  tier: number; season: string; requires_permit: string | null; wta_url: string | null; notes: string | null;
}
export interface PeaksDestination { id: string; name: string; features: string[]; lng: number; lat: number; elevation?: number; has_boundary?: boolean; external_links?: unknown[]; external_ids?: Record<string, string | number> }
export interface PeaksRoute {
  id: string; name: string; status: string; catalog_reviewed: boolean; distance: number;
  objective_destination_id?: string | null; path?: { type: 'LineString'; coordinates: number[][] } | null; n_sessions: number; destinations: { id: string; ordinal: number }[];
  start: { coordinates: number[] } | null; end: { coordinates: number[] } | null;
}
export interface PlaceSource { kind: 'osm' | 'graph' | 'inferred_road_contact' | 'trail_end' | 'curated'; osm_id?: string; node_id?: string; provenance?: Provenance; access_name?: string; access_gap_m?: number; note?: string; official_name?: boolean; name_is_fallback?: boolean }
export interface NewPlace { name: string; feature: string; lng: number; lat: number; source: PlaceSource; ele?: number; boundary?: NamedFeature['boundary'] }
export interface PlaceRef { peaks_id?: string; new?: NewPlace }
export interface ResolvedPlace { ref: PlaceRef; name: string; feature: string; coord: Coord; osm?: NamedFeature; route_coord: Coord; gap_m: number }
export type ComposeStatus = 'ok' | 'review' | 'needs_geometry' | 'failed';
export interface ExistingMatch { id: string; name: string; catalog_reviewed: boolean; n_sessions: number; start_gap_m: number; end_gap_m: number | null }
export interface Waypoint extends PlaceRef { name: string; feature: string; lng: number; lat: number; fraction: number; osm_id: string; distance_from_route_m: number }
export interface ComposedRoute {
  state_code?: 'WA' | 'OR' | 'CA' | 'ID';
  discovery_source?: 'relation' | 'objective' | 'named_trail' | 'lollipop';
  discovery_identity?: string;
  popularity_score?: number;
  popularity?: number;
  popularity_signals?: Record<string, number>;
  flags?: string[];
  seed_index: number; name: string; aliases: string[]; kind: Seed['kind']; region: string; tier: number;
  trailhead: PlaceRef | null; objective: PlaceRef | null; end_trailhead?: PlaceRef | null;
  segments: { id: string; direction: 'forward' | 'reverse' }[]; length_m: number;
  shape: 'out_and_back' | 'loop' | 'point_to_point'; waypoints: Waypoint[];
  wta_url: string | null; requires_permit: string | null; season: string;
  existing_route_match: ExistingMatch | null; existing_route_matches: ExistingMatch[];
  name_duplicates: { type: 'seed' | 'prod'; id: string; name: string }[];
  status: ComposeStatus; reasons: string[]; expected_length_m: number; deviation_fraction: number | null;
  preferred_fraction: number; road_fraction: number; approx_roundtrip_mi: number;
  route_start: Coord | null; route_end: Coord | null; segment_sources: { id: string; provenance: Provenance }[];
  provenance?: Provenance; route_id?: string; composition_hash?: string; geometry_hash?: string; segment_manifest_hash?: string;
  approximate?: boolean; notes?: string[]; stretches?: { display_name: string | null; kind: Segment['kind']; length_m: number; segment_ids: string[] }[];
  dropped_links?: { id: string; name: string; gap_m: number; reason: string }[];
}
export interface DraftRoute { row: ComposedRoute; walk: RouteStep[]; xc?: RouteStep[]; source_places?: { trailhead?: NewPlace; objective?: NewPlace; end_trailhead?: NewPlace } }
export interface AccessPoint { osm_id: string; coord: Coord; parking: boolean; name?: string }
export interface CatalogInputs { seeds: Seed[]; destinations: PeaksDestination[]; routes: PeaksRoute[]; popularity: { route_id: string; n: number; users: number }[]; segments: Segment[]; features: NamedFeature[]; access?: AccessPoint[] }
