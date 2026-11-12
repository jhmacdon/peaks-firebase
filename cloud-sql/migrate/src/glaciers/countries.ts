import { createHash } from "node:crypto";
import { outlineMetrics, stableMetric, type Outline, type OutlineMetrics } from "./outline-geometry";

export type CountryBoundary = { country_code: string; osm_key: string; admin_level: 2; boundary: Outline };
export type CountryBoundarySnapshot = {
  source_url: string;
  source_sha256: string;
  snapshot_at: string;
  extent?: [number, number, number, number];
  /** Complete country coverage of the package's padded extent, derived from
   * the saved admin_level=2 relations. Never use an open, cropped OSM ring. */
  countries: CountryBoundary[];
};
export type GlacierCountryAssignment = {
  schema_version: 1;
  source: "OpenStreetMap admin_level=2";
  source_url: string;
  source_sha256: string;
  snapshot_at: string;
  license: "ODbL-1.0";
  credit: "© OpenStreetMap contributors";
  outline_sha256: string;
  outline_area_km2: number;
  minimum_secondary_overlap_km2: number;
  boundary_clip_bbox?: [number, number, number, number];
  overlaps: { country_code: string; osm_key: string; boundary_sha256: string; area_km2: number; share: number; kept: boolean }[];
  method: string;
};
export type GlacierCountries = {
  country_code: string;
  country_codes: string[];
  country_assignment: GlacierCountryAssignment;
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value: string) => /^[A-Z]{2}$/.test(value);

/** Validate saved decisions before the writer sees them. The source hash
 * gates the country masks; these checks gate the derived selection. */
export function validateGlacierCountries(outline: Outline, value: GlacierCountries): void {
  const { country_code: primary, country_codes: codes, country_assignment: a } = value;
  const fail = () => { throw new Error("Invalid country assignment"); };
  if (!iso(primary) || !Array.isArray(codes) || !codes.length || codes.some(c => !iso(c))
    || JSON.stringify(codes) !== JSON.stringify([...new Set(codes)].sort()) || !codes.includes(primary)) fail();
  if (!a || a.schema_version !== 1 || a.source !== "OpenStreetMap admin_level=2"
    || !/^https?:\/\//.test(a.source_url) || !/^[0-9a-f]{64}$/.test(a.source_sha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(a.snapshot_at) || Number.isNaN(Date.parse(a.snapshot_at))
    || a.license !== "ODbL-1.0" || a.credit !== "© OpenStreetMap contributors"
    || a.outline_sha256 !== digest(outline) || !a.method?.trim()
    || !Number.isFinite(a.outline_area_km2) || a.outline_area_km2 <= 0
    || a.minimum_secondary_overlap_km2 !== stableMetric(Math.max(0.01, a.outline_area_km2 * 0.01))
    || !Array.isArray(a.overlaps) || !a.overlaps.length) fail();
  const overlaps = a.overlaps, seen = overlaps.map(c => c.country_code);
  if (JSON.stringify(seen) !== JSON.stringify([...new Set(seen)].sort())) fail();
  for (const c of overlaps) if (!iso(c.country_code) || !/^relation:\d+$/.test(c.osm_key)
    || !/^[0-9a-f]{64}$/.test(c.boundary_sha256) || !Number.isFinite(c.area_km2)
    || c.area_km2 <= 0 || c.area_km2 > a.outline_area_km2 + 1e-8
    || c.share !== stableMetric(c.area_km2 / a.outline_area_km2)
    || c.kept !== (c.country_code === primary || c.area_km2 >= a.minimum_secondary_overlap_km2)) fail();
  const ranked = [...overlaps].sort((x, y) => y.area_km2 - x.area_km2
    || (x.country_code < y.country_code ? -1 : x.country_code > y.country_code ? 1 : 0));
  if (ranked[0].country_code !== primary
    || JSON.stringify(overlaps.filter(c => c.kept).map(c => c.country_code)) !== JSON.stringify(codes)) fail();
}

/** Country selection uses fixed source bytes and the selected snapshot
 * outline, before any database access. Round measurements before comparing
 * or hashing, as the outline refresh does. ASCII ISO order breaks ties. */
export function assignGlacierCountries(outline: Outline, snapshot: CountryBoundarySnapshot,
  origin: { lng: number; lat: number }, metrics: OutlineMetrics = outlineMetrics(origin)): GlacierCountries {
  if (!/^https?:\/\//.test(snapshot.source_url) || !/^[0-9a-f]{64}$/.test(snapshot.source_sha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.snapshot_at) || !snapshot.countries.length)
    throw new Error("Invalid country boundary snapshot provenance");
  const countries = [...snapshot.countries].sort((a, b) => a.country_code < b.country_code ? -1 : a.country_code > b.country_code ? 1 : 0);
  if (snapshot.extent) {
    const [w, s, e, n] = snapshot.extent;
    if (outline.coordinates.some(p => p.some(r => r.some(([x, y]) => x <= w || x >= e || y <= s || y >= n))))
      throw new Error("Glacier outline reaches the country clip extent; widen the country masks");
  }
  if (new Set(countries.map(c => c.country_code)).size !== countries.length
    || countries.some(c => !iso(c.country_code) || c.admin_level !== 2 || !/^relation:\d+$/.test(c.osm_key)))
    throw new Error("Country boundaries need unique ISO codes and OSM admin_level=2 relation identities");
  const area = stableMetric(metrics.area(outline));
  if (!(area > 0)) throw new Error("Empty country assignment outline");
  const minimum = stableMetric(Math.max(0.01, area * 0.01));
  const overlaps = countries.map(c => {
    const overlap = stableMetric(metrics.overlap(outline, c.boundary).intersection_km2);
    if (overlap < 0 || overlap > area + 1e-8) throw new Error("Country overlap exceeds the glacier outline");
    return { country_code: c.country_code, osm_key: c.osm_key, boundary_sha256: digest(c.boundary),
      area_km2: overlap, share: stableMetric(overlap / area), kept: false };
  }).filter(c => c.area_km2 > 0);
  const ranked = [...overlaps].sort((a, b) => b.area_km2 - a.area_km2
    || (a.country_code < b.country_code ? -1 : a.country_code > b.country_code ? 1 : 0));
  if (!ranked.length) throw new Error("No country covers the glacier outline");
  const primary = ranked[0].country_code;
  // The primary is retained even for a whole glacier below 0.01 km². The
  // cutoff removes secondary border slivers, never a sole real country.
  for (const c of overlaps) c.kept = c.country_code === primary || c.area_km2 >= minimum;
  return {
    country_code: primary,
    country_codes: overlaps.filter(c => c.kept).map(c => c.country_code),
    country_assignment: {
      schema_version: 1, source: "OpenStreetMap admin_level=2", source_url: snapshot.source_url,
      source_sha256: snapshot.source_sha256, snapshot_at: snapshot.snapshot_at,
      license: "ODbL-1.0", credit: "© OpenStreetMap contributors", outline_sha256: digest(outline),
      outline_area_km2: area, minimum_secondary_overlap_km2: minimum, overlaps,
      ...(snapshot.extent ? { boundary_clip_bbox: snapshot.extent } : {}),
      method: "WGS84 ellipsoidal Lambert equal-area overlap of the selected cached outline and cached OSM admin_level=2 boundaries; metrics rounded to 9 decimals; greatest overlap primary, alphabetical ISO tie; secondary overlap >= max(0.01 km², 1% of outline)",
    },
  };
}
