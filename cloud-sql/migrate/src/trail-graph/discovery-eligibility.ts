import { join } from 'node:path';
import { geojsonFeatures, lines } from './io';
import { parseTags } from './opl';
import type { SourceFeature } from './features';
import type { NamedFeature, Segment, Tags } from './types';

/** These designations describe motor recreation rather than a hiking trail. */
export function isMotorizedName(value: string | null | undefined): boolean {
  const name = (value ?? '').replace(/\bnon[- ]?motor(?:ized|ised)\b/gi, '');
  return /\b(?:ohv|atv|utv|motorcycles?|motorized|motorised|motor[- ]?bike|dirt[- ]?bike|4wd)\b|\b4\s*[x×]\s*4\b|\bfour[- ]wheel[- ]drive\b|\boff[- ]highway(?:\s+vehicle)?\b|\ball[- ]terrain\s+vehicles?\b/i.test(name);
}

export function motorizedTags(tags: Tags): boolean {
  const allowed = /^(?:yes|designated|official|permissive|destination|true|1)$/i;
  return Object.entries(tags).some(([key, value]) => /^(?:motorcycle|ohv|atv|utv)(?::(?:designation|designated))?$/i.test(key) && allowed.test(value)
    || /^(?:designation|trail:designation|trail_type|trail:type|use|designated_use)$/i.test(key) && isMotorizedName(value)
    || /^(?:motor_vehicle|motorcar)$/i.test(key) && /^(?:designated|official)$/i.test(value));
}

/** USFS managed-use fields contain either an affirmative designation or the
 * dates on which that motor use is managed. Restriction fields mean the reverse. */
export function usfsMotorizedDesignation(properties: Record<string, unknown>): boolean {
  if (/^(?:y|yes|true|1)$/i.test(String(properties.terra_motorized ?? '').trim())) return true;
  return ['motorcycle_managed', 'atv_managed'].some(key => {
    const value = String(properties[key] ?? '').trim();
    return /^(?:y|yes|true|1|designated|managed|official|year[- ]round)$/i.test(value)
      || /(?:^|[,; ])\d{2}\/\d{2}-\d{2}\/\d{2}(?:$|[,; ])/.test(value);
  });
}

/** NPS combines permitted uses in a pipe-separated description. A denied use
 * is not a motor designation; terrain/accessibility wording alone is harmless. */
export function npsMotorizedDesignation(properties: Record<string, unknown>): boolean {
  return String(properties.TRLUSE ?? '').split(/[|,;]/).some(use => isMotorizedName(use)
    && !/\b(?:no|not|non[- ]?motor(?:ized|ised)|prohibited|forbidden|restricted)\b/i.test(use));
}

/** Keep local multi-use trails, but exclude paths named for a highway corridor. */
export function isHighwayPathName(value: string | null | undefined): boolean {
  const name = value ?? '';
  return /\b(?:i(?:nterstate)?|u\.?s\.?|sr|state\s+route|state\s+highway|highway|hwy)\s*[- ]?\s*\d+[a-z]?\b/i.test(name)
    && /\b(?:multi[- ]?use|path|trail|greenway|bikeway|bike\s+route)\b/i.test(name);
}

function highwayPathTags(tags: Tags): boolean {
  return isHighwayPathName(tags.name) || ['path', 'footway', 'cycleway', 'track'].includes(tags.highway)
    && /^(?:i|us|u\.s\.|sr|or|ca|id|wa)\s*[- ]?\s*\d+[a-z]?$/i.test(tags.ref ?? '');
}

export function eligibleDiscoverySegment(segment: Segment): boolean {
  const names = [segment.name, ...segment.trail_names, ...segment.relation_names, ...segment.alt_sources.map(source => source.name)];
  if (names.some(name => isMotorizedName(name) || isHighwayPathName(name))) return false;
  const tags = [...segment.alt_sources.flatMap(source => source.tags ? [source.tags] : []), ...segment.relations.flatMap(relation => relation.tags ? [relation.tags] : [])];
  return !tags.some(value => motorizedTags(value) || highwayPathTags(value))
    && !segment.alt_sources.some(source => source.source === 'usfs' && usfsMotorizedDesignation(source.tags ?? {}) || source.source === 'nps' && npsMotorizedDesignation(source.tags ?? {}));
}

/** Graph rows omit way access tags. Stream only disallowed source IDs and map
 * those IDs back to the current graph; no OPL geometry is held in memory. */
export async function loadExcludedDiscoverySegments(input: string, segments: Segment[]): Promise<Set<string>> {
  const ways = new Set<number>(), agencyIds = { usfs: new Set<string>(), nps: new Set<string>() };
  try {
    for await (const line of lines(join(input, 'extract', 'trails.opl'))) {
      if (line[0] !== 'w' || !/(?: T|,)(?:motorcycle|ohv|atv|utv|motor_vehicle|motorcar|designation|trail:designation|trail_type|trail:type|use|designated_use|ref|name)=/i.test(line)) continue;
      const field = /(?:^| )T([^ ]*)/.exec(line); if (!field) continue;
      const tags = parseTags(field[1]);
      if (motorizedTags(tags) || highwayPathTags(tags)) ways.add(Number(line.slice(1, line.indexOf(' '))));
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const source of ['usfs', 'nps'] as const) try {
    for await (const feature of geojsonFeatures<SourceFeature>(join(input, 'raw', 'agency', `${source}_trails.geojson`))) {
      if (!(source === 'usfs' ? usfsMotorizedDesignation(feature.properties) : npsMotorizedDesignation(feature.properties))) continue;
      const id = feature.id ?? feature.properties.objectid ?? feature.properties.OBJECTID;
      if (id !== null && id !== undefined) agencyIds[source].add(String(id));
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return new Set(segments.filter(segment => segment.osm_way_ids.some(id => ways.has(id)) || !eligibleDiscoverySegment(segment)
    || segment.alt_sources.some(source => source.source === 'usfs' && agencyIds.usfs.has(source.id) || source.source === 'nps' && agencyIds.nps.has(source.id))).map(segment => segment.id));
}

/** A drainage or treatment facility is not a hiking destination even when OSM
 * classifies its water polygon as a lake. Natural reservoirs remain eligible. */
export function isUtilityObjective(feature: NamedFeature): boolean {
  if (/\b(?:detention|retention|storm[- ]?water|waste[- ]?water|sewage|sewerage|clarifier|flood[- ]?control)\b/i.test(feature.name)) return true;
  const tags = feature.tags ?? {};
  return ['basin', 'wastewater'].includes(tags.water) || /^(?:detention|retention|infiltration|settling|stormwater|wastewater|sewage)$/i.test(tags.basin ?? '')
    || /^(?:wastewater_basin|sewage_treatment_pond|clarifier|wastewater_plant|water_works|pumping_station|reservoir_covered)$/i.test(tags.man_made ?? '')
    || /^(?:wastewater|sewage)$/i.test(tags.substance ?? '');
}
