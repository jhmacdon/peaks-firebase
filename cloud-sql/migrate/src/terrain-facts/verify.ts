import type { Claim, Feature, Research } from "./schema";
import { FEATURE_TYPES, HANDS, TERRAINS, YDS } from "./schema";
import type { Packet } from "./packet";

/**
 * Deterministic checks on a researcher's answer. A check can only take a
 * claim or a finding away; nothing here adds one.
 *
 * What it proves: each quote is on its page word for word, each answer cites
 * claims, the claims' words carry the fact they are cited for, and every place
 * named exists in the packet. What it cannot prove: that a quote is about this
 * route, or that it means what the researcher says. A reviewer reads those.
 */

export type PageStatus = "ok" | "blocked" | "error";
export interface Page { url: string; status: PageStatus; http_status: number | null; via: "https" | "browser" | null; text: string; error: string | null }
export type ClaimStatus = "verified" | "verified_loose" | "not_on_page" | "page_blocked" | "page_error" | "bad_quote" | "bad_url";
export interface ClaimCheck { id: string; status: ClaimStatus; publisher: string; source_url: string; detail: string | null }
export interface FindingCheck { path: string; value: string; ok: boolean; problems: string[] }
export interface Verification {
  route_id: string; packet_sha256: string; ok: boolean;
  structural: string[];
  claims: ClaimCheck[];
  findings: FindingCheck[];
  /** Feature id -> route interval the location resolves to, in metres along the route. */
  locations: Record<string, { start_m: number; end_m: number; how: string } | null>;
}

// ---------- text ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', deg: "°", frac12: "1/2", ft: "ft" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Same characters a reader sees: typographic quotes, dashes and spaces folded. */
export function normalize(s: string): string {
  return s.normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim().toLowerCase();
}

/** Letters and digits only, for pages that split a sentence across tags. */
export function loose(s: string): string {
  return normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }

export function findQuote(quote: string, pageText: string): "exact" | "loose" | null {
  const q = normalize(quote);
  if (!q) return null;
  if (normalize(pageText).includes(q)) return "exact";
  const lq = loose(quote);
  return lq.length >= 20 && loose(pageText).includes(lq) ? "loose" : null;
}

export function publisherOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const parts = u.hostname.toLowerCase().replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch { return null; }
}

// ---------- what the quoted words must carry ----------

const CLASS_WORDS: Record<string, RegExp> = {
  "1": /\bclass[ -]?(?:1|i|one)\b|\b(?:1st|first)[ -]class\b/,
  "2": /\bclass[ -]?(?:2|ii|two)\b|\b(?:2nd|second)[ -]class\b/,
  "3": /\bclass[ -]?(?:3|iii|three)\b|\b(?:3rd|third)[ -]class\b/,
  "4": /\bclass[ -]?(?:4|iv|four)\b|\b(?:4th|fourth)[ -]class\b/,
  "5": /\bclass[ -]?(?:5|v|five)\b|\b(?:5th|fifth)[ -]class\b|\b5\.\d{1,2}[abcd+-]?\b/,
};
const HAND_WORDS = /\bhands?\b|\bscrambl|\bclimb(?:ing)?\b|\bhandhold|\bholds\b|\bchimney|\bhand-over-hand/;
const NO_HAND_WORDS = /\bno hands\b|\bwithout (?:using )?(?:your )?hands\b|\bhands[- ]free\b|\bwalk[- ]?up\b|\bnon-?technical\b|\bno scrambling\b|\bwithout scrambling\b|\bclass[ -]?(?:1|one)\b/;
const TYPE_WORDS: Partial<Record<Feature["type"], RegExp>> = {
  scramble: /\bscrambl/,
  technical_climb: /\b5\.\d|\bbelay|\brope[ds]?\b|\brappel|\btechnical\b|\bprotection\b|\bharness/,
  glacier: /\bglacier|\bcrevass/,
  unmaintained_path: /\bboot ?path|\bclimbers'? (?:trail|path|route)|\bunmaintained|\bnot maintained|\bway ?trail|\bcairn|\bwand|\boff[- ]trail|\bcross[- ]country|\bprimitive|\bunofficial|\bfaint/,
  snowfield: /\bsnow/,
  talus_or_boulders: /\btalus|\bboulder|\bscree\b|\brock(?:y|s)?\b/,
  rough_trail: /\bsteep|\brough|\bscree\b|\bpumice|\brock(?:y|s)?\b|\broot|\bloose|\bboot ?path|\bclimbers'? (?:trail|path)|\bunmaintained/,
  exposure: /\bexpos|\bdrop[- ]?offs?\b|\bcliff|\bsheer|\bfall\b/,
  fixed_aid: /\bcable|\bladder|\bchain|\bfixed (?:line|rope)|\brebar/,
};
const TERRAIN_WORDS: Partial<Record<Research["stretches"][number]["terrain"], RegExp>> = {
  maintained_trail: /\btrail\b|\bpath\b|\bswitchback/,
  rough_trail: TYPE_WORDS.rough_trail,
  unmaintained_path: TYPE_WORDS.unmaintained_path,
  talus_or_boulders: TYPE_WORDS.talus_or_boulders,
  scramble: TYPE_WORDS.scramble,
  technical_climb: TYPE_WORDS.technical_climb,
  snow: /\bsnow/,
  glacier: TYPE_WORDS.glacier,
  road: /\broad\b|\bgravel\b|\bpaved\b/,
};

/** "3rd or 4th class at most" bounds a route; it does not rate it. */
const CEILING = /\bat most\b|\bno harder than\b|\bor easier\b|\bat the most\b|\bnot (?:more|harder) than\b|\bmaximum\b|\bup to (?:class|\d(?:st|nd|rd|th))/;

function numbersIn(s: string): number[] {
  return [...normalize(s).matchAll(/\b\d{1,2},?\d{3}\b|\b\d{3,5}\b/g)].map(m => Number(m[0].replace(/,/g, "")));
}

// ---------- the check ----------

const SINGLE_SOURCE_TYPES = ["trip_report", "forum"];

export function verify(packet: Packet, packetSha: string, research: Research, pages: Map<string, Page>): Verification {
  const structural: string[] = [];
  if (research.route_id !== packet.route_id) structural.push(`route_id ${research.route_id} is not ${packet.route_id}`);
  if (research.packet_sha256 !== packetSha) structural.push("packet_sha256 does not match the packet");

  const claimIds = new Set<string>();
  for (const c of research.claims) { if (claimIds.has(c.id)) structural.push(`claim id ${c.id} repeats`); claimIds.add(c.id); }
  const stretchIds = new Set(packet.stretches.map(s => s.id)), waypointIds = new Set(packet.waypoints.map(w => w.id));

  // Claims: the quote must be on the page.
  const claims: ClaimCheck[] = research.claims.map(c => checkClaim(c, pages));
  const good = new Map(claims.filter(c => c.status === "verified" || c.status === "verified_loose").map(c => [c.id, research.claims.find(x => x.id === c.id)!]));

  const findings: FindingCheck[] = [];
  const cite = (path: string, value: string, ids: string[], opts: { words?: RegExp; twoPublishers?: boolean; needed?: boolean; rating?: boolean } = {}) => {
    const problems: string[] = [];
    for (const id of ids) if (!claimIds.has(id)) problems.push(`cites unknown claim ${id}`);
    const usable = ids.map(id => good.get(id)).filter((c): c is Claim => !!c);
    if (opts.needed !== false && !usable.length) problems.push(ids.length ? "no cited claim passed the page check" : "no claims cited");
    if (opts.words && usable.length && !usable.some(c => opts.words!.test(normalize(c.quote)))) problems.push("no verified quote states it in words");
    if (opts.rating && usable.length && opts.words && usable.filter(c => opts.words!.test(normalize(c.quote))).every(c => CEILING.test(normalize(c.quote)))) problems.push("quotes give only a ceiling, not a rating");
    if (opts.twoPublishers) {
      const pubs = new Set(usable.map(c => publisherOf(c.source_url)));
      if (pubs.size < 2) problems.push("rests on one publisher");
      if (usable.length && usable.every(c => SINGLE_SOURCE_TYPES.includes(c.source_type))) problems.push("rests only on trip reports or forums");
    }
    findings.push({ path, value, ok: problems.length === 0, problems });
  };

  const r = research.route;
  if (r.hardest_class.value !== "unknown") cite("route.hardest_class", r.hardest_class.value, r.hardest_class.claim_ids, { words: CLASS_WORDS[r.hardest_class.value], twoPublishers: true, rating: true });
  if (r.hands_needed_anywhere.value === "yes") cite("route.hands_needed_anywhere", "yes", r.hands_needed_anywhere.claim_ids, { words: HAND_WORDS, twoPublishers: true });
  if (r.hands_needed_anywhere.value === "no") cite("route.hands_needed_anywhere", "no", r.hands_needed_anywhere.claim_ids, { words: NO_HAND_WORDS });
  if (r.glacier_travel.value === "yes") cite("route.glacier_travel", "yes", r.glacier_travel.claim_ids, { words: TYPE_WORDS.glacier });
  if (r.technical_gear.value === "yes") cite("route.technical_gear", "yes", r.technical_gear.claim_ids, { words: /\brope|\bharness|\bcrampon|\bice axe|\bhelmet|\bbelay|\bprotection|\btechnical/ });
  for (const key of ["glacier_travel", "technical_gear"] as const) if (r[key].value === "no") cite(`route.${key}`, "no", r[key].claim_ids);

  const locations: Verification["locations"] = {};
  const featureIds = new Set<string>();
  for (const f of research.features) {
    if (featureIds.has(f.id)) structural.push(`feature id ${f.id} repeats`);
    featureIds.add(f.id);
    if (!FEATURE_TYPES.includes(f.type) || !YDS.includes(f.yds_class) || !HANDS.includes(f.hands)) structural.push(`feature ${f.id} has a value outside the schema`);
    const strong = f.type === "scramble" || f.type === "technical_climb";
    // A climb is 5th class: a roped technical rock climb. Rope, belay or "technical" alone is not a rating.
    if (f.type === "technical_climb" && f.yds_class !== "5")
      findings.push({ path: `features.${f.id}.type`, value: f.type, ok: false, problems: ["a climb needs a stated 5th-class rating"] });
    cite(`features.${f.id}.type`, f.type, f.claim_ids, { words: TYPE_WORDS[f.type], twoPublishers: strong });
    if (f.yds_class !== "unknown") cite(`features.${f.id}.yds_class`, f.yds_class, f.claim_ids, { words: CLASS_WORDS[f.yds_class], twoPublishers: Number(f.yds_class) >= 3, rating: true });
    if (f.hands === "required" || f.hands === "occasional") cite(`features.${f.id}.hands`, f.hands, f.claim_ids, { words: HAND_WORDS, twoPublishers: f.hands === "required" });
    if (f.hands === "not_needed") cite(`features.${f.id}.hands`, f.hands, f.claim_ids, { words: NO_HAND_WORDS });
    // Climbers write "scramble" for any walk over rock. Without a class or a word about hands, it is rough ground.
    if (f.type === "scramble" && !(Number(f.yds_class) >= 3) && f.hands !== "required" && f.hands !== "occasional")
      findings.push({ path: `features.${f.id}.type`, value: f.type, ok: false, problems: ["a scramble needs a stated class 3+ or quotes about hands; the word alone is not enough"] });
    locations[f.id] = locate(f, packet, good, stretchIds, waypointIds, findings);
  }

  const seen = new Map<string, number>();
  for (const s of research.stretches) {
    seen.set(s.stretch_id, (seen.get(s.stretch_id) ?? 0) + 1);
    if (!stretchIds.has(s.stretch_id)) structural.push(`stretch ${s.stretch_id} is not in the packet`);
    if (!TERRAINS.includes(s.terrain)) structural.push(`stretch ${s.stretch_id} has terrain outside the schema`);
    if (s.terrain !== "unknown") cite(`stretches.${s.stretch_id}`, s.terrain, s.claim_ids, { words: TERRAIN_WORDS[s.terrain], twoPublishers: s.terrain === "scramble" || s.terrain === "technical_climb" });
  }
  for (const id of stretchIds) if (seen.get(id) !== 1) structural.push(`stretch ${id} appears ${seen.get(id) ?? 0} times`);

  return { route_id: packet.route_id, packet_sha256: packetSha, ok: !structural.length && findings.every(f => f.ok), structural, claims, findings, locations };
}

function checkClaim(c: Claim, pages: Map<string, Page>): ClaimCheck {
  const base = { id: c.id, publisher: publisherOf(c.source_url) ?? "", source_url: c.source_url };
  if (!publisherOf(c.source_url)) return { ...base, status: "bad_url", detail: "not an http(s) URL" };
  const words = wordCount(c.quote);
  if (words < 6 || words > 60) return { ...base, status: "bad_quote", detail: `quote has ${words} words; 6 to 60 allowed` };
  if (/\.\.\.|…|\[|\]/.test(c.quote)) return { ...base, status: "bad_quote", detail: "quote is cut or edited" };
  const page = pages.get(c.source_url);
  if (!page) return { ...base, status: "page_error", detail: "page was not fetched" };
  if (page.status === "blocked") return { ...base, status: "page_blocked", detail: page.error };
  if (page.status === "error") return { ...base, status: "page_error", detail: page.error };
  const found = findQuote(c.quote, page.text);
  if (found === "exact") return { ...base, status: "verified", detail: null };
  if (found === "loose") return { ...base, status: "verified_loose", detail: "found after dropping punctuation" };
  return { ...base, status: "not_on_page", detail: null };
}

/** Turns a feature's location into a stretch of the route, or explains why it cannot. */
function locate(f: Feature, packet: Packet, good: Map<string, Claim>, stretchIds: Set<string>, waypointIds: Set<string>, findings: FindingCheck[]): { start_m: number; end_m: number; how: string } | null {
  const loc = f.location, problems: string[] = [];
  const quotes = loc.claim_ids.map(id => good.get(id)).filter((c): c is Claim => !!c).map(c => c.quote);
  const done = (value: string, result: { start_m: number; end_m: number; how: string } | null) => { findings.push({ path: `features.${f.id}.location`, value, ok: problems.length === 0, problems }); return problems.length ? null : result; };
  if (["waypoint", "elevation_band", "stretch", "summit_block"].includes(loc.anchor) && !quotes.length) problems.push("no verified claim places it");
  const end = packet.length_m;

  switch (loc.anchor) {
    case "waypoint": {
      const w = packet.waypoints.find(x => x.id === loc.waypoint_id);
      if (!w || !waypointIds.has(w.id)) { problems.push(`waypoint ${loc.waypoint_id} is not in the packet`); return done("waypoint", null); }
      const words = loose(w.name).split(" ").filter(t => t.length > 3 && !["mount", "peak", "trail", "lake"].includes(t));
      if (quotes.length && words.length && !quotes.some(q => words.every(t => loose(q).includes(t)))) problems.push(`no placing quote names ${w.name}`);
      return done(`waypoint ${w.id}`, { start_m: Math.max(0, w.along_m - 50), end_m: Math.min(end, w.along_m + 50), how: `near ${w.name}` });
    }
    case "elevation_band": {
      const lo = Math.min(loc.from_ft ?? NaN, loc.to_ft ?? NaN), hi = Math.max(loc.from_ft ?? NaN, loc.to_ft ?? NaN);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) { problems.push("elevation band is missing a number"); return done("elevation_band", null); }
      const stated = quotes.flatMap(numbersIn);
      // "The final 400 feet" ends at the summit: the catalog's summit elevation may close a band a quote opens.
      const top = packet.objective?.elevation_ft;
      if (top != null && quotes.some(q => /\bsummit\b|\bfinal\b|\blast\b|\btop\b/.test(normalize(q)))) stated.push(top);
      for (const v of [lo, hi]) if (!stated.some(n => Math.abs(n - v) <= 25)) problems.push(`${v} ft is not stated in a placing quote`);
      if (packet.low_ft != null && packet.high_ft != null && (hi < packet.low_ft - 100 || lo > packet.high_ft + 100)) problems.push(`band ${lo}-${hi} ft is off this route (${packet.low_ft}-${packet.high_ft} ft)`);
      // The last climb through the band: features near a summit sit on the final ascent.
      const inBand = packet.profile.filter(([, z]) => z != null && z >= lo - 25 && z <= hi + 25).map(([d]) => d);
      if (!inBand.length) { problems.push("route never reaches that band"); return done("elevation_band", null); }
      return done(`${lo}-${hi} ft`, { start_m: Math.min(...inBand), end_m: Math.max(...inBand), how: `route between ${lo} and ${hi} ft` });
    }
    case "stretch": {
      const bad = loc.stretch_ids.filter(id => !stretchIds.has(id));
      if (!loc.stretch_ids.length || bad.length) { problems.push(bad.length ? `unknown stretches ${bad.join(", ")}` : "no stretches named"); return done("stretch", null); }
      const ss = packet.stretches.filter(s => loc.stretch_ids.includes(s.id));
      for (const s of ss) {
        const words = loose(s.name ?? "").split(" ").filter(t => t.length > 3 && !["trail", "route", "mount"].includes(t));
        if (quotes.length && words.length && !quotes.some(q => words.some(t => loose(q).includes(t)))) problems.push(`no placing quote names ${s.name ?? s.id}`);
      }
      return done(loc.stretch_ids.join(","), { start_m: Math.min(...ss.map(s => s.start_m)), end_m: Math.max(...ss.map(s => s.end_m)), how: ss.map(s => s.name ?? s.id).join(", ") });
    }
    case "summit_block": {
      if (quotes.length && !quotes.some(q => /\bsummit\b|\btop\b|\bblock\b|\bhaystack\b|\bfinal\b|\blast\b/.test(normalize(q)))) problems.push("no placing quote says it is at the top");
      return done("summit_block", null);
    }
    default:
      return done(loc.anchor, null);
  }
}
