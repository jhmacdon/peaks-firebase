import type { Segment, Tags } from './types';
import { cleanDiscoveryName } from './discovery-names';

// Include bare and protocol-relative domain links, and malformed values such
// as wikipedia=en:https://www.alltrails.com/.... Do not match another host
// whose name merely contains the same letters or adds a domain suffix.
const ALLTRAILS_DOMAIN = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*alltrails\.com(?=$|[^a-z0-9.-]|\.(?:$|[^a-z0-9.-]))/i;

function catalogTags(tags: Tags | undefined): Tags | undefined {
  if (!tags) return tags;
  let result = tags;
  for (const [key, value] of Object.entries(tags)) if (ALLTRAILS_DOMAIN.test(value)) {
    if (result === tags) result = { ...tags };
    delete result[key];
  }
  return result;
}

function catalogMetadata<T extends { tags?: Tags }>(items: T[]): T[] {
  let result = items;
  for (let i = 0; i < items.length; i++) {
    const tags = catalogTags(items[i].tags);
    if (tags === items[i].tags) continue;
    if (result === items) result = items.slice();
    result[i] = { ...items[i], tags };
  }
  return result;
}

/** Clean catalog display labels and excluded links before manifest hashing.
 * Raw trail names, source identities, geometry, and rights remain available. */
export function catalogSegment(segment: Segment): Segment {
  const relations = catalogMetadata(segment.relations), alt_sources = catalogMetadata(segment.alt_sources);
  const name = segment.kind === 'road' ? segment.name : cleanDiscoveryName(segment.name, { kind: 'trail' }).name;
  const display = segment.display_name === undefined ? undefined : segment.kind === 'road' ? segment.display_name : cleanDiscoveryName(segment.display_name, { kind: 'trail' }).name;
  return relations === segment.relations && alt_sources === segment.alt_sources && name === segment.name && display === segment.display_name ? segment
    : { ...segment, name, ...(display === undefined ? {} : { display_name: display }), relations, alt_sources };
}
