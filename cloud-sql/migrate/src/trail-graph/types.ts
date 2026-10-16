export type Coord = [number, number];
export type Kind = 'trail' | 'road' | 'snowfield' | 'glacier' | 'scramble' | 'climb' | 'xc';
export type Tags = Record<string, string>;
export interface Relation { id: number; name?: string; ref?: string; network?: string }
export interface Way { id: number; nodes: number[]; tags: Tags; relations: Relation[] }
export interface Provenance {
  source_kind: string; source_url: string; license_name: string; license_url: string;
  attribution: string; retrieved_at: string; osm_way_ids: number[];
  osm_way_urls: string[]; contains_osm_geometry: boolean;
}
export interface AltSource { source: string; id: string; name: string | null; number: string | null }
export interface Segment {
  id: string; name: string | null; trail_names: string[]; kind: Kind;
  display_name?: string | null; description?: string | null; description_source_url?: string | null;
  source_segment_ids?: string[]; informal?: string | null;
  sac_scale: string | null; trail_visibility: string | null; osm_way_ids: number[];
  relation_names: string[]; relations: Relation[]; start_node: string; end_node: string;
  coords: Coord[]; node_ids: string[]; osm_edge_way_ids: number[]; length_m: number; provenance: Provenance;
  alt_sources: AltSource[];
  legacy_tail?: { route_id: string; source_hash: string; attachment_gap_m: number };
}
export interface GraphNode { id: string; lon: number; lat: number; degree: number }
export interface NamedFeature {
  osm_id: string; name: string; feature: 'trailhead' | 'summit' | 'saddle' | 'pass' |
    'campsite' | 'viewpoint' | 'hut' | 'waterfall' | 'lake' | 'glacier' | 'ridge';
  lon: number; lat: number; ele?: number; graph_node: string | null; graph_distance_m: number | null;
  location_method: 'osm_point' | 'boundary_nearest_graph' | 'line_midpoint' | 'area_centroid';
  aliases?: string[];
  boundary?: { type: 'MultiPolygon'; coordinates: Coord[][][] };
  graph_coord?: Coord;
}
export interface Glacier { name: string; polygons: Coord[][][] }
