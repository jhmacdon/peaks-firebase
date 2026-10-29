import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../import-glacier-manifest";
import type { AreaSource } from "./psu-inventory";

/** USGS Benchmark Glacier Project, "Compiled input data and glacier-wide mass
 * balances" (CC0-1.0). Its area-altitude file gives the area in each
 * elevation bin per year, measured from DEMs in DEM years and interpolated
 * between them; its geodetics file dates the DEMs. Only a DEM year is used. */
export const USGS_BENCHMARK_CREDIT = "U.S. Geological Survey Glacier Project, compiled input data and glacier-wide mass balances";
export const USGS_BENCHMARK_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

const rows = (csv: string, what: string) => {
  const lines = csv.trim().split(/\r?\n/).map(l => l.split(",").map(v => v.trim()));
  if (lines.length < 2 || lines.some(l => l.length !== lines[0].length)) throw new Error(`Malformed USGS ${what} file`);
  return { header: lines[0], body: lines.slice(1) };
};

/** Area of the latest DEM year: the sum of that year's binned areas (km²).
 * The geodetic file's minimum area over the last interval must agree within
 * 0.1%, or the files describe different outlines. */
export function usgsBenchmarkArea(dir: string, files: { area_altitude: string; geodetics: string },
  hashes: { area_altitude: string; geodetics: string }, release: { url: string; version: string }): AreaSource {
  const read = (key: keyof typeof files) => {
    const bytes = readFileSync(join(dir, files[key]));
    if (sha256(bytes) !== hashes[key]) throw new Error(`Unreviewed USGS file SHA-256: ${files[key]}`);
    return bytes.toString("utf8");
  };
  const geo = rows(read("geodetics"), "geodetics"), alt = rows(read("area_altitude"), "area-altitude");
  const col = (name: string) => { const i = geo.header.indexOf(name); if (i < 0) throw new Error(`USGS geodetics lacks ${name}`); return i; };
  if (alt.header[0] !== "Year") throw new Error("USGS area-altitude file lacks Year");
  const dems = geo.body.map(r => ({ date: r[col("Date")], area_min_m2: Number(r[col("Area_min")]) }))
    .filter(d => /^\d{4}\/\d{2}\/\d{2}$/.test(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const latest = dems[dems.length - 1];
  if (!latest) throw new Error("USGS geodetics has no dated DEM");
  const year = latest.date.slice(0, 4), row = alt.body.find(r => r[0] === year);
  if (!row) throw new Error(`USGS area-altitude has no row for DEM year ${year}`);
  const bins = row.slice(1).map(Number);
  if (!bins.every(v => Number.isFinite(v) && v >= 0)) throw new Error(`Invalid USGS binned area for ${year}`);
  const area = Number(bins.reduce((s, v) => s + v, 0).toFixed(6));
  if (!(area > 0) || Math.abs(area - latest.area_min_m2 / 1e6) > area * 1e-3)
    throw new Error(`USGS ${year} binned area ${area} km² disagrees with geodetic ${latest.area_min_m2} m²`);
  return { area_km2: area, observed_at: latest.date.replace(/\//g, "-"), credit: USGS_BENCHMARK_CREDIT, url: release.url,
    license: "CC0-1.0", license_url: USGS_BENCHMARK_LICENSE_URL,
    method: `Sum of the ${year} row of ${files.area_altitude} (km² per 50 m bin), a DEM year in ${files.geodetics}; release ${release.version}`,
    files: { [files.area_altitude]: hashes.area_altitude, [files.geodetics]: hashes.geodetics } };
}
