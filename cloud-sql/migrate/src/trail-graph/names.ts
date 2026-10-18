export function normalizeName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bmt\.?\b/g, 'mount').replace(/\bmtn\.?\b/g, 'mountain').replace(/\bpk\.?\b/g, 'peak').replace(/\bst\.?\b/g, 'saint').replace(/\bth\b/g, 'trailhead')
    .replace(/\btwenty[ -]?two\b/g, '22')
    .replace(/\b(first|1st)\b/g, '1').replace(/\b(second|2nd)\b/g, '2').replace(/\b(third|3rd)\b/g, '3')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function cleanTrail(value: string): string { return value.replace(/\?/g, '').replace(/\s*#\s*[\d]+[\w.-]*/g, '').trim(); }
export const trailKey = (value: string): string => normalizeName(cleanTrail(value)).replace(/\bloop\b/g, '').replace(/^(upper|lower|north|south)\s+/, '').replace(/\s+(trail|route|path)$/, '').trim().replace(/\s+/g, ' ');
export const placeKey = (value: string): string => normalizeName(value.split(/\s*\/\s*/)[0]).replace(/\s+trailhead$/, '').trim();
const generic = new Set('trailhead trail th parking lot upper lower route path via the of to at and lake lakes mount mountain peak summit lookout viewpoint overlook basin meadow meadows loop creek ridge campground visitor center observatory north south east west'.split(' '));
export const distinctiveTokens = (name: string): string[] => normalizeName(cleanTrail(name)).split(' ').filter(t => (t.length > 1 || /^\d+$/.test(t)) && !generic.has(t));
export function tokenMatch(a: string, b: string): boolean {
  const x = distinctiveTokens(a), y = new Set(distinctiveTokens(b));
  return x.length > 0 && x.every(t => y.has(t));
}
export function featureCompatible(want: string, features: string[]): boolean {
  if (want === 'other') return features.some(f => f !== 'trailhead');
  const groups: Record<string, string[]> = { summit: ['summit', 'volcano'], camp: ['campsite'], campsite: ['campsite'], lookout: ['lookout', 'fire-lookout', 'viewpoint'],
    viewpoint: ['viewpoint', 'summit', 'fire-lookout'], pass: ['pass', 'saddle', 'landform'], saddle: ['saddle', 'pass', 'landform'], other: ['landform', 'viewpoint'], meadow: ['landform', 'campsite'], beach: ['landform'], glacier: ['glacier', 'landform'], ridge: ['ridge', 'landform'] };
  return (groups[want] ?? [want]).some(f => features.includes(f));
}
export function databaseFeature(feature: string): string {
  if (feature === 'camp') return 'campsite'; if (feature === 'lookout') return 'fire-lookout';
  return ['volcano', 'fire-lookout', 'summit', 'trailhead', 'hut', 'lookout', 'lake', 'landform', 'viewpoint', 'waterfall', 'campsite'].includes(feature) ? feature : 'landform';
}
