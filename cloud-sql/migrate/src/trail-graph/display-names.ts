import { expandNameAbbreviations } from '../lib/place-names';

// Source labels often omit spaces around slashes and hyphens. Each side keeps
// the shared Mount/Mountain/Peak word rules; separator spelling stays intact.
function expandSeparatedNames(name: string): string {
  return name.split(/([/‐‑‒–—−-])/u).map(expandNameAbbreviations).join('');
}

export function displayName(value: string | null): string | null {
  if (!value) return null;
  let name = value.trim();
  if (/^(?:PCT|PCNST)\s*:/i.test(name)) return 'Pacific Crest Trail';
  if (/^CDT\s*:/i.test(name)) return 'Continental Divide Trail';
  name = name.replace(/\b(?:PCNST|PCT)\b/gi, 'Pacific Crest Trail').replace(/\bCDT\b/gi, 'Continental Divide Trail').replace(/\bSand Pt\.?\b/gi, 'Sand Point');
  name = name.replace(/\bNat(?:l\.?|\.)?\s+Rec\.?/gi, 'National Recreation').replace(/\bN\.R\.T\./gi, 'National Recreation Trail');
  name = expandSeparatedNames(name);
  name = name.replace(/\b[A-Z][A-Z'’-]+\b/g, word => word.split('-').map(part => part ? part[0] + part.slice(1).toLowerCase() : part).join('-'));
  // Spanish and French particles stay as the source wrote them (Paseo del Bosque).
  const small = new Set('of the and a to in on at by for via from del de la las los el y du des le'.split(' '));
  name = name.replace(/\p{L}[\p{L}'’]*/gu, (word, offset: number) => {
    // Preserve source spellings such as McDonald and iPhone.
    if (/[\p{Lu}]/u.test(word.slice(1)) || small.has(word.toLowerCase()) && offset > 0) return word;
    return word[0].toLocaleUpperCase('en-US') + word.slice(1);
  });
  return expandSeparatedNames(name).replace(/\b(trail|path|loop|route)(?:\s+\1)+\b/gi, '$1').replace(/\s+/g, ' ').trim();
}
export function assertDisplayName(name: string | null): void {
  if (name && /\b(?:mt|mtn|pk)\b\.?/i.test(name)) throw new Error(`Abbreviated segment display name: ${name}`);
}
