import { join } from 'node:path';
import { lines } from './io';
import { parseTags } from './opl';
import { Grid, haversine } from './geo';
import type { AccessPoint, ComposedRoute } from './catalog-types';
import type { DiscoveryCandidate } from './discovery';
import type { Coord, Segment, Tags } from './types';

interface Amenity { coord: Coord; tags: Tags }
/** Compact source tags omitted from graph geometry. Raw files remain streamed. */
export interface RankingContext {
  ways: Map<number, Tags>;
  places: Map<string, Tags>;
  amenities: Grid<Amenity>;
  source_files: string[];
}
const positive = (value: string | undefined): boolean => !!value && !/^(?:no|none|unknown|0|false)$/i.test(value);
const sourceKeys = /^(?:wikidata|wikipedia|operator|protect_class|protection_title|designation|wilderness|national_park|is_in(?::.*)?|amenity|parking|capacity|fee|toilets|drinking_water|information|tourism|highway)$/;
const usefulTags = (tags: Tags): Tags => Object.fromEntries(Object.entries(tags).filter(([key]) => sourceKeys.test(key)));
const emptyContext = (): RankingContext => ({ ways: new Map(), places: new Map(), amenities: new Grid<Amenity>(200), source_files: [] });

export async function loadRankingContext(input: string, access: AccessPoint[]): Promise<RankingContext> {
  const context = emptyContext();
  for (const name of ['trails.opl', 'roads-parking.opl']) {
    const path = join(input, 'extract', name);
    try {
      for await (const line of lines(path)) {
        // No nodes, relation members or geometry need to be retained here.
        if (!/(?: T|,)(?:wikidata|wikipedia|operator|protect_class|protection_title|designation|wilderness|national_park|is_in(?::[^=, ]+)?|amenity|parking|capacity|fee|toilets|drinking_water|information|tourism)=/.test(line)) continue;
        const field = /(?:^| )T([^ ]*)/.exec(line); if (!field) continue;
        const tags = usefulTags(parseTags(field[1])); if (!Object.keys(tags).length) continue;
        const id = Number(line.slice(1, line.indexOf(' ')));
        if (line[0] === 'w' && (tags.wikidata || tags.wikipedia || protectedTags(tags))) context.ways.set(id, { ...context.ways.get(id), ...tags });
        if (tags.amenity === 'parking' || tags.highway === 'trailhead' || positive(tags.toilets) || positive(tags.drinking_water) || tags.amenity === 'toilets' || tags.amenity === 'drinking_water' || tags.information === 'guidepost') {
          const key = `${line[0] === 'n' ? 'node' : line[0] === 'w' ? 'way' : 'relation'}/${id}`;
          context.places.set(key, { ...context.places.get(key), ...tags });
          const x = / x(-?[\d.]+)(?: |$)/.exec(line), y = / y(-?[\d.]+)(?: |$)/.exec(line);
          if (x && y) { const coord: Coord = [Number(x[1]), Number(y[1])]; context.amenities.add(coord, coord, { coord, tags }); }
        }
      }
      context.source_files.push(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  // Parking ways have no coordinates in OPL; graph access retains their contact.
  for (const point of access) if (point.parking) {
    const tags = { amenity: 'parking', ...context.places.get(point.osm_id) };
    context.amenities.add(point.coord, point.coord, { coord: point.coord, tags });
  }
  return context;
}

function protectedTags(tags: Tags): boolean {
  return Object.entries(tags).some(([key, value]) => positive(value) && (
    /^(?:wilderness|national_park)$/.test(key) || key === 'protect_class' && ['1a', '1b', '2'].includes(value)
    || /^(?:operator|protection_title|designation|is_in(?::.*)?)$/.test(key) && /\b(?:national park|wilderness|national park service)\b/i.test(value)));
}
const wiki = (tags: Tags, key: 'wikidata' | 'wikipedia'): boolean => positive(tags[key]);
function nationalTrail(segment: Segment): boolean {
  if ([...segment.trail_names, ...segment.relation_names].some(name => /\bnational\s+(?:scenic|recreation|historic)\s+trail\b/i.test(name))) return true;
  return segment.alt_sources.some(source => Object.entries(source.tags ?? {}).some(([key, value]) => /national.*trail|trail.*designation/i.test(key)
    // USFS codes 0/1 mean no known national designation. Do not reward them.
    && (/^(?:2|3|4)$/.test(value) || /\b(?:national\s+)?(?:scenic|recreation|historic)\b/i.test(value))));
}
const numeric = (value: string | undefined): number => Number.parseFloat((value ?? '').replace(/,/g, '')) || 0;

export interface PopularityResult { popularity: number; signals: Record<string, number> }
/** A tag-based loading priority, not a visit estimate. No route names are special-cased. */
export function rankDiscovery(candidate: DiscoveryCandidate, byId: Map<string, Segment>, junctionNames = 0, context?: RankingContext): PopularityResult {
  const signals: Record<string, number> = { mapped_route: .035 };
  const total = candidate.walk.reduce((sum, step) => sum + step.length_m, 0);
  let hiking = 0, network = 0, national = 0, protectedM = 0, wikiM = 0, wikipediaM = 0;
  for (const step of candidate.walk) {
    const segment = byId.get(step.segment_id); if (!segment) continue;
    const relations = segment.relations.filter(r => /^(?:hiking|foot|mountain_hiking)$/.test(r.route ?? r.tags?.route ?? ''));
    const tags = segment.osm_way_ids.flatMap(id => context?.ways.get(id) ? [context.ways.get(id)!] : []);
    const relationTags = relations.flatMap(r => r.tags ? [r.tags] : []);
    if (relations.length) hiking += step.length_m;
    const importance: Record<string, number> = { iwn: 1, nwn: .85, rwn: .55, lwn: .3 };
    network += step.length_m * Math.max(0, ...relations.map(r => importance[(r.network ?? r.tags?.network ?? '').replace(/^US:/i, '').toLowerCase()] ?? 0));
    if ([...tags, ...relationTags].some(t => wiki(t, 'wikidata'))) wikiM += step.length_m;
    if ([...tags, ...relationTags].some(t => wiki(t, 'wikipedia'))) wikipediaM += step.length_m;
    if (nationalTrail(segment)) national += step.length_m;
    if (/nps|national.?park/i.test(segment.provenance.source_kind) || segment.alt_sources.some(source => /^(?:nps|national_park_service)$/.test(source.source)) || [...tags, ...relationTags].some(protectedTags)) protectedM += step.length_m;
  }
  const fraction = (metres: number): number => total ? Math.min(1, metres / total) : 0;
  signals.hiking_relation = .10 * Math.sqrt(fraction(hiking));
  signals.hiking_network = .16 * Math.sqrt(fraction(network));
  signals.trail_wikidata = .09 * Math.sqrt(fraction(wikiM));
  signals.trail_wikipedia = .13 * Math.sqrt(fraction(wikipediaM));
  signals.national_trail = .10 * Math.sqrt(fraction(national));
  // These often describe the same national route. Discount their correlated
  // evidence rather than counting its network, wiki and designation as visits.
  const hierarchy = signals.hiking_relation + signals.hiking_network + signals.trail_wikidata + signals.trail_wikipedia + signals.national_trail;
  signals.correlated_trail_discount = .30 * (1 - Math.exp(-hierarchy / .30)) - hierarchy;
  signals.protected_area = .09 * Math.sqrt(fraction(protectedM));
  const objective = candidate.objective, objectiveTags = objective?.tags ?? {};
  signals.objective_wikidata = wiki(objectiveTags, 'wikidata') ? .13 : 0;
  signals.objective_wikipedia = wiki(objectiveTags, 'wikipedia') ? .20 : 0;
  if (objective) {
    signals.objective_kind = ({ waterfall: .055, summit: .025, lake: .025, hot_spring: .025, arch: .025, lookout: .02, viewpoint: .01, hut: .01 } as Record<string, number>)[objective.feature] ?? 0;
    const ele = objective.ele ?? numeric(objectiveTags.ele), prominence = numeric(objectiveTags.prominence ?? objectiveTags['prominence:meters']);
    if (objective.feature === 'summit') {
      signals.summit_elevation = ele > 0 ? .015 + .07 * Math.min(1, Math.max(0, ele - 1500) / 2500) : 0;
      signals.summit_prominence = prominence > 0 ? .10 * Math.min(1, Math.log1p(prominence / 100) / Math.log(16)) : 0;
    }
    if (objective.feature === 'waterfall') signals.waterfall_height = .12 * Math.min(1, Math.log1p(Math.max(0, numeric(objectiveTags.height)) / 10) / Math.log(51));
    if (objectiveTags.tourism === 'attraction' || positive(objectiveTags.landmark)) signals.mapped_landmark = .035;
    if (protectedTags(objectiveTags)) signals.objective_protected = .04;
  }
  const th = candidate.trailhead, thTags = { ...context?.places.get(th.osm_id), ...('tags' in th ? th.tags : {}) };
  signals.mapped_trailhead = 'feature' in th && th.feature === 'trailhead' && !th.osm_id.startsWith('graph/') ? .035 : 0;
  signals.trailhead_junction = .06 * Math.min(1, Math.max(0, junctionNames - 1) / 4);
  const nearby = context?.amenities.near(candidate.trailheadCoord, 150).filter(a => haversine(a.coord, candidate.trailheadCoord) <= 150).map(a => a.tags) ?? [];
  const amenities = [thTags, ...nearby];
  signals.trailhead_parking = ('parking' in th && th.parking || amenities.some(t => t.amenity === 'parking')) ? .035 : 0;
  signals.parking_capacity = .035 * Math.min(1, Math.max(0, ...amenities.map(t => numeric(t.capacity))) / 100);
  signals.trailhead_facilities = Math.min(.045, (amenities.some(t => positive(t.toilets) || t.amenity === 'toilets') ? .02 : 0)
    + (amenities.some(t => positive(t.drinking_water) || t.amenity === 'drinking_water') ? .015 : 0)
    + (amenities.some(t => t.information === 'guidepost') ? .01 : 0));
  const oneWay = candidate.shape === 'loop' ? total / 2 : total;
  // Long national trails must not outrank practical day hikes just by collecting tags.
  const lengthMultiplier = oneWay > 25000 ? Math.max(.15, 25000 / oneWay) : 1;
  signals.length_multiplier = lengthMultiplier;
  const sum = Object.entries(signals).reduce((n, [key, value]) => n + (key === 'length_multiplier' ? 0 : value), 0);
  return { popularity: Math.round(Math.min(.999999, Math.max(.001, sum * lengthMultiplier)) * 1e6) / 1e6, signals };
}

export interface TierThresholds { tier_1_min: number; tier_2_min: number }
export function popularityThresholds(scores: number[]): TierThresholds {
  const values = [...scores].sort((a, b) => a - b);
  return { tier_1_min: values[Math.floor(values.length * 2 / 3)] ?? .55, tier_2_min: values[Math.floor(values.length / 3)] ?? .25 };
}
export function popularityTier(score: number, thresholds: TierThresholds = { tier_1_min: .55, tier_2_min: .25 }): 1 | 2 | 3 {
  return score >= thresholds.tier_1_min ? 1 : score >= thresholds.tier_2_min ? 2 : 3;
}
export function comparePopularity(a: Pick<ComposedRoute, 'popularity' | 'seed_index'>, b: Pick<ComposedRoute, 'popularity' | 'seed_index'>): number {
  return (b.popularity ?? 0) - (a.popularity ?? 0) || a.seed_index - b.seed_index;
}
