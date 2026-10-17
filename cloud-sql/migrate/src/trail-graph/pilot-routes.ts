/** Josiah approved retirement of these four never-reviewed pending pilots.
 * Membership is an offline plan assumption; every apply verifies live receipts. */
export const PILOT_BATCH = 'wa-cascades-20261013';
export const PILOT_REJECTION = 'superseded_by_wa_graph_catalog';
export const WA_PILOTS = [
  { id: 'trail-6dfd43dc-8f23-4791-ab00-570049a1c39b', name: 'Skyline Loop (Paradise)' },
  { id: 'trail-f39e1eac-83f9-4ce7-b870-e10c04f396b0', name: 'Lake Serene Trail' },
  { id: 'trail-e7e610fd-b4be-4b67-94c5-bc7646cfb346', name: 'Rattlesnake Ledge via Rattlesnake Ledge Trail' },
  { id: 'trail-6391bc0f-8687-4bc8-b465-a2add6d99d58', name: 'Lake Twentytwo via Lake Twenty Two Trail' },
] as const;
const ids = new Set<string>(WA_PILOTS.map(p => p.id));
export const isWaPilot = (id: string): boolean => ids.has(id);
export const onlyWaPilots = (routeIds: string[]): boolean => routeIds.length > 0 && routeIds.every(isWaPilot);
