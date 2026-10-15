import { expandNameAbbreviations } from '../lib/place-names';

export function displayName(value: string | null): string | null {
  if (!value) return null;
  let name = value.trim();
  if (/^(?:PCT|PCNST)\s*:/i.test(name)) return 'Pacific Crest Trail';
  name = name.replace(/\b(?:PCNST|PCT)\b/gi, 'Pacific Crest Trail').replace(/\bSand Pt\.?\b/gi, 'Sand Point');
  name = expandNameAbbreviations(name);
  name = name.replace(/\b[A-Z][A-Z'’-]+\b/g, word => word[0] + word.slice(1).toLowerCase());
  return expandNameAbbreviations(name).replace(/\s+/g, ' ').trim();
}
export function assertDisplayName(name: string | null): void {
  if (name && /\b(?:mt|mtn|pk)\b\.?/i.test(name)) throw new Error(`Abbreviated segment display name: ${name}`);
}
