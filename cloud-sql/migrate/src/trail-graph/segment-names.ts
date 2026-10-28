import { displayName } from './display-names';
import type { Segment } from './types';

/** A trail's name is not the name of the ice it crosses. */
export function principalName(segment: Segment): string | null {
  if (segment.legacy_tail) return null;
  if (segment.kind === 'glacier' || segment.kind === 'snowfield') {
    const terrain = segment.terrain;
    return (terrain?.kind === segment.kind ? terrain.name?.trim() : null)
      || (segment.kind === 'glacier' ? 'Glacier crossing' : 'Snowfield crossing');
  }
  return segment.trail_names[0] || segment.relation_names[0] || null;
}

export function segmentDisplayName(segment: Segment): string | null {
  return segment.display_name === undefined ? displayName(principalName(segment)) : segment.display_name;
}
