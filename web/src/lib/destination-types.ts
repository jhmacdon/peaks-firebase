export type ExternalIdProvider = 'osm' | 'gnis' | 'wikidata' | 'alltrails';

export type ExternalIds = Partial<Record<ExternalIdProvider, string>>;
