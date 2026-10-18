import { displayName } from './display-names';
import { isMotorizedName } from './discovery-eligibility';
import type { AccessPoint } from './catalog-types';
import type { NamedFeature } from './types';

export interface DiscoveryName {
  name: string | null;
  aliases: string[];
  flags: string[];
}
export interface DiscoveryNameOptions {
  kind?: 'trail' | 'objective' | 'trailhead' | 'route';
  /** Only mapped trailheads can retain an official road-containing name. */
  officialTrailhead?: boolean;
}

/** Match road words anywhere, including a road hidden before a trail suffix. */
export function isRoadName(value: string | null | undefined): boolean {
  const name = value ?? '';
  return /\b(?:road|rd\.?|street|avenue|ave\.?|highway|hwy\.?|freeway|motorway|drive|boulevard|blvd\.?|lane|ln\.?)\b/i.test(name)
    || /\b(?:st\.?|dr\.?)\s*(?:#?\s*\d+[a-z]?)?(?:\s+(?:trail|connector|viewpoint|trailhead))?(?:\s+(?:north(?:east|west)?|south(?:east|west)?|east|west|n|s|e|w|ne|nw|se|sw))?$/i.test(name)
    || /\bforest\s+(?:(?:development|develop|dev\.?|service)\s+)?(?:road|rd)(?=\b|\d)/i.test(name)
    || /\b(?:nfdr|ndfr|nfr|fsr|fdr|frd|fr)\s*[-#]?\s*\d+[a-z0-9]*\b/i.test(name)
    || /\bf\s+r(?:\s+d)?\s*[-#]?\s*\d+[a-z0-9]*\b/i.test(name)
    || /^(?:(?:nfd|nf|fs|usfs)\s*[-#]?\s*|forest\s+service\s+)\d+[a-z]?(?:[.-]\d+[a-z]?)*$/i.test(name)
    || /\b(?:place|pl\.?)\s*(?:#?\s*\d+[a-z]?)?(?:\s+(?:north(?:east|west)?|south(?:east|west)?|east|west|n|s|e|w|ne|nw|se|sw))?$/i.test(name)
    || /^(?:north|south|east|west|northeast|northwest|southeast|southwest|n|s|e|w|ne|nw|se|sw)\s*\d+(?:st|nd|rd|th)?\s*(?:north|south|east|west|n|s|e|w|way)$/i.test(name);
}

const generic = new Set('trail trails traill tr foot path paths route routes hiking hike loop connector spur access unnamed unknown unmaintained main mid middle alternate alt old new off to from via a an the and of parking lot trailhead head seasonal north south east west upper lower way national recreation scenic historic nat forest for development develop dev service serv system nf nfd fs fsd usfs nfs nfst idl blm frd f r atv bia'.split(' '));
const genericFeature = new Set('viewpoint overlook summit lake pond mountain peak meadow pass saddle waterfall lookout hut spring arch'.split(' '));
const words = (name: string): string[] => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** A number or a source inventory code cannot carry a hike's identity. */
export function isJunkDiscoveryName(name: string): boolean {
  if (/^(?:foot\s+)?(?:trail|path|route)\s+(?:from|to)\b/i.test(name.trim())) return true;
  // A coded relation section can sit beside its full parent trail name.
  if (/[-‐‑‒–—−]\s*(?:seg(?:ment)?|section)\.?\s*[-#]?\s*\d+[a-z]?(?:\s+(?:trail|path|route))?\s*$/i.test(name.trim())) return true;
  // An entire short prefix plus a numeric reference is an inventory label.
  // Keep numbered landforms such as Lake 22 and Peak 1.
  const inventory = /^([a-z]{1,4})[\s-]*(\d+[a-z0-9]*(?:[./-]\d+[a-z0-9]*)*)(?:\s+[a-z]{1,2})?(?:\s+(?:trail|path|route|loop))?$/i.exec(name.trim());
  if (inventory && !genericFeature.has(inventory[1].toLowerCase())) return true;
  if (/^[a-z]{2,4}\s+(?:fs|usfs|nfs|nfst)\s*[-#]?\s*\d+[a-z0-9.-]*$/i.test(name.trim())) return true;
  if (/^national\s+forest\s+(?:development|system(?:\s+trail)?)\s*[-#]?\s*\d[\w\s./-]*(?:\s+trail)?$/i.test(name.trim())) return true;
  const tokens = words(name);
  if (!tokens.length) return true;
  if (tokens.length === 1 && genericFeature.has(tokens[0])) return true;
  if (tokens.some(token => /\d/.test(token)) && tokens.every(token => generic.has(token) || /^[a-z](?:\d+[a-z]?)?$/.test(token) || /^\d/.test(token))) return true;
  return !tokens.some(token => !generic.has(token) && !/^\d/.test(token) && !/^(?:[a-z]{1,3}|foresttrail)\d+[a-z\d]*$/.test(token)
    && !( /\d/.test(token) && generic.has(token.replace(/\d.*$/, '')) ) && !/^(?:x{2,}|tbd|todo|unnamed|unknown)$/.test(token));
}

function parentheticalName(value: string): string {
  // An explicit named trail in brackets is more useful than a short local
  // alias. A bracketed nickname inside an otherwise complete name is dropped.
  return value.replace(/([^()]*)\(([^()]*)\)/g, (_whole, before: string, inside: string) => {
    const trimmed = before.trim(), bracket = inside.trim();
    if (/\b(?:trail|path|route)\b/i.test(bracket) && (!/\b(?:trail|path|route|loop)\b/i.test(trimmed) || isJunkDiscoveryName(trimmed)) && !isJunkDiscoveryName(bracket)) return ` ${bracket} `;
    return `${before} `;
  }).replace(/[()]/g, '');
}

/** Shared source-name cleanup; originals remain available as aliases. */
export function cleanDiscoveryName(value: string | null | undefined, options: DiscoveryNameOptions = {}): DiscoveryName {
  const original = displayName(value ?? null), flags: string[] = [];
  if (!original || isMotorizedName(original)) return { name: null, aliases: [], flags };
  if (/\(\s*seasonal\s*\)/i.test(original)) flags.push('seasonal');
  // A route title can include an objective plus a trail. Pick a parenthetical
  // trail alias within that clause without replacing the objective itself.
  let name = original.split(/(\s+via\s+|\s+from\s+)/i).map(part => parentheticalName(part)).join('');
  const road = isRoadName(original) || isRoadName(name), rawJunk = isJunkDiscoveryName(name);
  name = name.replace(/\bNRT\b/gi, 'National Recreation Trail').replace(/\bNST\b/gi, 'National Scenic Trail')
    .replace(/(?:^|\s)(?:x{2,}|tbd|todo)(?=\s|$)/gi, ' ')
    .replace(/\s*#\s*(?:[a-z]+[- ]*)?\d+[\w]*(?:\s*[-.]\s*[\w]+)*/gi, '')
    .replace(/\b(trail|path|route)\s*(?:(?:number|no\.?)\s*)?\d+[a-z0-9]*(?:[./-]\d+[a-z0-9]*)*$/gi, '$1')
    .replace(/([\p{L}])(\s*[-‐‑‒–—−]\s*)([\p{Ll}])/gu, (_whole, a: string, separator: string, b: string) => a + separator + b.toLocaleUpperCase('en-US'))
    .replace(/\s+/g, ' ').trim();
  // A local numbered trail label is an alias; retain the named landform.
  // Numbered objectives such as Lake 22 and Peak 1 keep their identities.
  if (options.kind === 'trail' || options.kind === 'route') {
    name = name.replace(/^(.+?\s+[^\s]+)\s+(?:(?:number|no\.?)\s+)?(?!\d+[x×]\d+\b)\d+[a-z0-9]*(?:[./-]\d+[a-z0-9]*)*\s+(trail|path|route)(?=\s+(?:loop|connector|spur)$|$)/i, '$1 $2');
    name = name.replace(/^(?!.*\b(?:via|from)\b)(.+?\s+[^\s]+)\s+\d+[a-z]?$/i, '$1');
    if (/\btrailhead$/i.test(name)) name = '';
  }
  if (!name || rawJunk || isJunkDiscoveryName(name) || road && !(options.kind === 'trailhead' && options.officialTrailhead)) name = '';
  return { name: name || null, aliases: name && name !== original ? [original] : [], flags };
}

/** Keep the source generic word, and supply Trail where the source omits it. */
export function viaTrailName(value: string | null | undefined): string | null {
  const name = cleanDiscoveryName(value, { kind: 'trail' }).name;
  if (!name) return null;
  return /\b(?:trail|path|route|way|walk|loop|traverse)\b/i.test(name) ? name : `${name} Trail`;
}

/** Parking codes and road contacts must not become invented trailhead names. */
export function usableTrailheadName(place: NamedFeature | AccessPoint): string | null {
  const official = 'feature' in place && place.feature === 'trailhead' && !place.osm_id.startsWith('graph/');
  const name = cleanDiscoveryName(place.name, { kind: 'trailhead', officialTrailhead: official }).name;
  if (!name || /(?:…|\.\.\.)/.test(name) || /^(?:p|lot|parking(?:\s+lot)?)\s*[-#]?\s*[a-z]?\d+[a-z]?$/i.test(name)) return null;
  return name;
}
