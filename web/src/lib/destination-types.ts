export type ExternalIdProvider =
  | "alltrails"
  | "gnis"
  | "listsofjohn"
  | "osm"
  | "osm_node"
  | "osm_relation"
  | "osm_way"
  | "peakbagger"
  | "summitpost"
  | "wikidata";

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
