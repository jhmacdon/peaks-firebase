/**
 * Fetch Colorado 14er hiking trails from OpenStreetMap via Overpass API.
 * Builds connected GPX files from OSM way geometry.
 *
 * Usage: node fetch-from-osm.js
 */

const fs = require("fs");
const path = require("path");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// All 58 Colorado 14ers with summit coordinates and known trail name patterns
const PEAKS = [
  { name: "Mount Elbert", lat: 39.1178, lng: -106.4453, trails: ["Elbert", "North Elbert", "South Elbert", "Black Cloud"] },
  { name: "Mount Massive", lat: 39.1875, lng: -106.4756, trails: ["Massive"] },
  { name: "Mount Harvard", lat: 38.9244, lng: -106.3206, trails: ["Harvard"] },
  { name: "Blanca Peak", lat: 37.5775, lng: -105.4856, trails: ["Blanca"] },
  { name: "La Plata Peak", lat: 39.0294, lng: -106.4731, trails: ["La Plata"] },
  { name: "Uncompahgre Peak", lat: 38.0717, lng: -107.4622, trails: ["Uncompahgre"] },
  { name: "Crestone Peak", lat: 37.9667, lng: -105.5853, trails: ["Crestone Peak", "Crestone"] },
  { name: "Mount Lincoln", lat: 39.3514, lng: -106.1114, trails: ["Lincoln", "Democrat"] },
  { name: "Grays Peak", lat: 39.6339, lng: -105.8178, trails: ["Grays", "Torreys", "Kelso"] },
  { name: "Castle Peak", lat: 39.0097, lng: -106.8614, trails: ["Castle"] },
  { name: "Quandary Peak", lat: 39.3972, lng: -106.1065, trails: ["Quandary"] },
  { name: "Mount Antero", lat: 38.6742, lng: -106.2461, trails: ["Antero"] },
  { name: "Mount Blue Sky", lat: 39.5883, lng: -105.6438, trails: ["Blue Sky", "Evans", "Mount Evans"] },
  { name: "Longs Peak", lat: 40.2550, lng: -105.6155, trails: ["Longs", "Keyhole"] },
  { name: "Mount Wilson", lat: 37.8392, lng: -107.9914, trails: ["Wilson"] },
  { name: "Mount Shavano", lat: 38.6192, lng: -106.2394, trails: ["Shavano"] },
  { name: "Mount Belford", lat: 38.9608, lng: -106.3608, trails: ["Belford"] },
  { name: "Mount Princeton", lat: 38.7492, lng: -106.2422, trails: ["Princeton"] },
  { name: "Mount Yale", lat: 38.8442, lng: -106.3139, trails: ["Yale"] },
  { name: "Crestone Needle", lat: 37.9647, lng: -105.5767, trails: ["Crestone Needle", "Needle"] },
  { name: "Mount Bross", lat: 39.3353, lng: -106.1075, trails: ["Bross"] },
  { name: "El Diente Peak", lat: 37.8392, lng: -108.0053, trails: ["El Diente", "Diente"] },
  { name: "Kit Carson Peak", lat: 37.9797, lng: -105.6028, trails: ["Kit Carson"] },
  { name: "Maroon Peak", lat: 39.0708, lng: -106.9892, trails: ["Maroon"] },
  { name: "Mount Oxford", lat: 38.9647, lng: -106.3383, trails: ["Oxford"] },
  { name: "Tabeguache Peak", lat: 38.6258, lng: -106.2508, trails: ["Tabeguache"] },
  { name: "Mount Sneffels", lat: 38.0036, lng: -107.7922, trails: ["Sneffels"] },
  { name: "Mount Democrat", lat: 39.3394, lng: -106.1397, trails: ["Democrat"] },
  { name: "Capitol Peak", lat: 39.1503, lng: -107.0831, trails: ["Capitol"] },
  { name: "Pikes Peak", lat: 38.8409, lng: -105.0423, trails: ["Barr", "Pikes", "Crags"] },
  { name: "Snowmass Mountain", lat: 39.1178, lng: -107.0667, trails: ["Snowmass"] },
  { name: "Windom Peak", lat: 37.6211, lng: -107.5917, trails: ["Windom"] },
  { name: "Mount Eolus", lat: 37.6219, lng: -107.6208, trails: ["Eolus"] },
  { name: "Challenger Point", lat: 37.9803, lng: -105.6069, trails: ["Challenger"] },
  { name: "Mount Columbia", lat: 38.9039, lng: -106.2975, trails: ["Columbia"] },
  { name: "Missouri Mountain", lat: 38.9475, lng: -106.3781, trails: ["Missouri"] },
  { name: "Humboldt Peak", lat: 37.9761, lng: -105.5553, trails: ["Humboldt"] },
  { name: "Mount Bierstadt", lat: 39.5828, lng: -105.6686, trails: ["Bierstadt"] },
  { name: "Sunlight Peak", lat: 37.6272, lng: -107.5958, trails: ["Sunlight"] },
  { name: "Handies Peak", lat: 37.9131, lng: -107.5044, trails: ["Handies"] },
  { name: "Ellingwood Point", lat: 37.5825, lng: -105.4925, trails: ["Ellingwood"] },
  { name: "Mount Lindsey", lat: 37.5836, lng: -105.4447, trails: ["Lindsey"] },
  { name: "Culebra Peak", lat: 37.1222, lng: -105.1856, trails: ["Culebra"] },
  { name: "Mount Sherman", lat: 39.2250, lng: -106.1697, trails: ["Sherman"] },
  { name: "Little Bear Peak", lat: 37.5667, lng: -105.4972, trails: ["Little Bear"] },
  { name: "Redcloud Peak", lat: 37.9408, lng: -107.4217, trails: ["Redcloud"] },
  { name: "Pyramid Peak", lat: 39.0714, lng: -106.9503, trails: ["Pyramid"] },
  { name: "San Luis Peak", lat: 37.9869, lng: -106.9311, trails: ["San Luis"] },
  { name: "North Maroon Peak", lat: 39.0761, lng: -106.9878, trails: ["North Maroon", "Maroon"] },
  { name: "Wetterhorn Peak", lat: 38.0606, lng: -107.5108, trails: ["Wetterhorn"] },
  { name: "Wilson Peak", lat: 37.8603, lng: -107.9847, trails: ["Wilson Peak"] },
  { name: "Mount of the Holy Cross", lat: 39.4678, lng: -106.4817, trails: ["Holy Cross", "Cross Creek"] },
  { name: "Huron Peak", lat: 38.9453, lng: -106.4378, trails: ["Huron"] },
  { name: "Sunshine Peak", lat: 37.9225, lng: -107.4253, trails: ["Sunshine", "Redcloud"] },
  { name: "Mount Cameron", lat: 39.3469, lng: -106.1186, trails: ["Cameron"] },
  { name: "Conundrum Peak", lat: 39.0153, lng: -106.8631, trails: ["Conundrum"] },
  { name: "North Eolus", lat: 37.6250, lng: -107.6203, trails: ["Eolus", "North Eolus"] },
  { name: "Torreys Peak", lat: 39.6436, lng: -105.8211, trails: ["Torreys", "Grays"] },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function queryOverpass(query) {
  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Overpass API error ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

function connectWays(ways) {
  if (ways.length === 0) return [];

  const remaining = [...ways];
  const ordered = [remaining.shift()];

  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    const lastGeom = ordered[ordered.length - 1].geometry;
    const lastPt = lastGeom[lastGeom.length - 1];
    const firstGeom = ordered[0].geometry;
    const firstPt = firstGeom[0];

    for (let i = 0; i < remaining.length; i++) {
      const g = remaining[i].geometry;
      const f = g[0], l = g[g.length - 1];

      // Try appending
      if (Math.abs(f.lat - lastPt.lat) < 0.0001 && Math.abs(f.lon - lastPt.lon) < 0.0001) {
        ordered.push(remaining.splice(i, 1)[0]);
        changed = true; break;
      }
      if (Math.abs(l.lat - lastPt.lat) < 0.0001 && Math.abs(l.lon - lastPt.lon) < 0.0001) {
        const w = remaining.splice(i, 1)[0];
        w.geometry.reverse();
        ordered.push(w);
        changed = true; break;
      }
      // Try prepending
      if (Math.abs(l.lat - firstPt.lat) < 0.0001 && Math.abs(l.lon - firstPt.lon) < 0.0001) {
        ordered.unshift(remaining.splice(i, 1)[0]);
        changed = true; break;
      }
      if (Math.abs(f.lat - firstPt.lat) < 0.0001 && Math.abs(f.lon - firstPt.lon) < 0.0001) {
        const w = remaining.splice(i, 1)[0];
        w.geometry.reverse();
        ordered.unshift(w);
        changed = true; break;
      }
    }
  }

  const points = [];
  for (let j = 0; j < ordered.length; j++) {
    const g = ordered[j].geometry;
    for (let i = (j > 0 ? 1 : 0); i < g.length; i++) {
      points.push(g[i]);
    }
  }
  return points;
}

function buildGPX(name, points) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="osm-overpass">\n<trk><name>${name}</name><trkseg>\n`;
  for (const p of points) {
    gpx += `<trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>\n`;
  }
  gpx += `</trkseg></trk>\n</gpx>`;
  return gpx;
}

function sanitizeFilename(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
}

async function fetchTrailsForPeak(peak) {
  const results = [];
  const radius = 5000;

  // Build regex pattern from trail names
  const pattern = peak.trails.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|");

  const query = `[out:json][timeout:60];way["highway"~"path|footway"]["name"~"${pattern}",i](${peak.lat - 0.05},${peak.lng - 0.1},${peak.lat + 0.05},${peak.lng + 0.1});out geom;`;

  try {
    const data = await queryOverpass(query);
    const ways = data.elements.filter(e => e.type === "way" && e.geometry);

    if (ways.length === 0) {
      console.log(`  No trails found for ${peak.name}`);
      return results;
    }

    // Group ways by name
    const byName = new Map();
    for (const w of ways) {
      const n = w.tags?.name || "Unknown";
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(w);
    }

    for (const [trailName, trailWays] of byName) {
      const points = connectWays(trailWays);
      if (points.length < 5) {
        console.log(`  Skip ${trailName} (only ${points.length} points)`);
        continue;
      }

      const filename = sanitizeFilename(`${peak.name}--${trailName}`) + ".gpx";
      const gpx = buildGPX(trailName, points);

      fs.writeFileSync(path.join(__dirname, filename), gpx);
      console.log(`  ✓ ${filename} (${points.length} pts)`);
      results.push({ filename, trailName, points: points.length });
    }
  } catch (err) {
    console.error(`  ✗ ${peak.name}: ${err.message}`);
  }

  return results;
}

async function main() {
  console.log("=== Fetching Colorado 14er trails from OpenStreetMap ===\n");

  // Clean up old HTML files
  const existing = fs.readdirSync(__dirname).filter(f => f.endsWith(".gpx"));
  for (const f of existing) {
    const content = fs.readFileSync(path.join(__dirname, f), "utf8").slice(0, 50);
    if (content.includes("<!DOCTYPE") || content.includes("<html")) {
      fs.unlinkSync(path.join(__dirname, f));
    }
  }

  let totalFiles = 0;
  let peaksWithTrails = 0;

  for (let i = 0; i < PEAKS.length; i++) {
    const peak = PEAKS[i];
    console.log(`[${i + 1}/${PEAKS.length}] ${peak.name}`);

    const results = await fetchTrailsForPeak(peak);
    if (results.length > 0) peaksWithTrails++;
    totalFiles += results.length;

    // Rate limit: Overpass has a 2 req/s limit
    await sleep(5000);
  }

  console.log(`\n=== Done: ${totalFiles} GPX files for ${peaksWithTrails}/${PEAKS.length} peaks ===`);

  // Validate all GPX files
  const allGpx = fs.readdirSync(__dirname).filter(f => f.endsWith(".gpx"));
  let valid = 0;
  for (const f of allGpx) {
    const content = fs.readFileSync(path.join(__dirname, f), "utf8");
    if (content.includes("<trkpt")) {
      valid++;
    } else {
      console.log(`  INVALID: ${f}`);
      fs.unlinkSync(path.join(__dirname, f));
    }
  }
  console.log(`Validated: ${valid} files`);
}

main().catch(console.error);
