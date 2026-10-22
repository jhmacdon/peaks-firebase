import type { Tags } from './types';

/** A specific foot permission overrides a general access restriction. */
export function restrictedFootAccess(tags: Tags): boolean {
  if (/^(?:yes|designated|permissive)$/i.test(tags.foot ?? '')) return false;
  return /^(?:private|no)$/i.test(tags.access ?? '') || /^(?:private|no)$/i.test(tags.foot ?? '');
}
