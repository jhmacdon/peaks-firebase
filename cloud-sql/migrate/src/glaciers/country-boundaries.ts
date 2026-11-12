import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { intersection } from "polyclip-ts";
import { parseOsmPolygon } from "./osm";
import type { OverpassElement } from "../osm-lake-coverage";
import type { CountryBoundarySnapshot } from "./countries";

/** Read complete cached admin_level=2 relations. Clip only the country
 * masks to a fixed padded box for local equal-area measurements. Glaciers
 * remain whole. The raw relation snapshot is the licensed source. */
export function loadCountryBoundaries(path: string, expectedSha256: string, sourceUrl: string,
  extent: [number, number, number, number], expectedCodes: string[]): CountryBoundarySnapshot {
  const raw = readFileSync(path), hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== expectedSha256) throw new Error("Unreviewed country boundary snapshot SHA-256");
  const snapshot = JSON.parse(raw.toString("utf8")) as {
    elements: OverpassElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string };
  };
  const date = snapshot.osm3s?.timestamp_osm_base;
  if (snapshot.remark || !Array.isArray(snapshot.elements) || !date || Number.isNaN(Date.parse(date)))
    throw new Error("Incomplete country boundary snapshot");
  const [w, s, e, n] = extent;
  if (!(w < e && s < n) || w < -180 || e > 180 || s < -90 || n > 90) throw new Error("Invalid country clip extent");
  const clip = [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
  const countries = snapshot.elements.map(element => {
    const code = element.tags?.["ISO3166-1"] ?? element.tags?.["ISO3166-1:alpha2"];
    if (element.type !== "relation" || element.tags?.boundary !== "administrative" || element.tags.admin_level !== "2"
      || !code || !expectedCodes.includes(code)) throw new Error("Unexpected country relation");
    const members = element.members?.filter(m => !["admin_centre", "label", "subarea"].includes(m.role ?? ""));
    // The shared parser rejects missing geometry, open rings and unsupported
    // nested polygon members. Never close a truncated relation by guesswork.
    const polygons = parseOsmPolygon({ ...element, members });
    const local = polygons.filter(p => {
      const pts = p[0];
      return pts.some(v => v[0] >= w) && pts.some(v => v[0] <= e) && pts.some(v => v[1] >= s) && pts.some(v => v[1] <= n);
    });
    const coordinates = local.length ? intersection(local, clip) : [];
    if (!coordinates.length) throw new Error(`Country ${code} has no coverage in the package extent`);
    return { country_code: code, osm_key: `relation:${element.id}`, admin_level: 2 as const,
      boundary: { type: "MultiPolygon" as const, coordinates } };
  }).sort((a, b) => a.country_code < b.country_code ? -1 : a.country_code > b.country_code ? 1 : 0);
  const codes = countries.map(c => c.country_code);
  if (JSON.stringify(codes) !== JSON.stringify([...new Set(expectedCodes)].sort())) throw new Error("Missing or duplicate country relation");
  return { source_url: sourceUrl, source_sha256: hash, snapshot_at: date.slice(0, 10), countries, extent };
}
