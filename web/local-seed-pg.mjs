// Local-only demo seed for design screenshots. Not for production.
import pg from "pg";

const db = new pg.Pool({
  host: "127.0.0.1",
  database: "peaks",
  user: "postgres",
  password: "localdev",
  port: 5432,
});

// --- geometry helpers -------------------------------------------------------

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Interpolate between waypoints with gentle switchback jitter. */
function buildPath(waypoints, { zigzag = 0 } = {}) {
  const pts = [];
  for (let w = 0; w < waypoints.length - 1; w++) {
    const [lat1, lng1, e1] = waypoints[w];
    const [lat2, lng2, e2] = waypoints[w + 1];
    const legDist = haversine(lat1, lng1, lat2, lng2);
    const steps = Math.max(2, Math.round(legDist / 70));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const wob = zigzag * Math.sin(i * 1.9 + w) * (1 - Math.abs(2 * t - 1));
      pts.push([
        lat1 + (lat2 - lat1) * t,
        lng1 + (lng2 - lng1) * t + wob,
        e1 + (e2 - e1) * t + 2.5 * Math.sin(i * 0.9 + w * 2),
      ]);
    }
  }
  pts.push(waypoints[waypoints.length - 1]);
  return pts;
}

function pathStats(pts) {
  let dist = 0,
    gain = 0,
    loss = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    const dz = pts[i][2] - pts[i - 1][2];
    if (dz > 0) gain += dz;
    else loss -= dz;
  }
  return { dist: Math.round(dist), gain: Math.round(gain), loss: Math.round(loss) };
}

/** Google polyline encoding, precision 1e6 (matches route-map.tsx decoder). */
function encodePolyline6(pts) {
  let out = "";
  let prevLat = 0,
    prevLng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    s += String.fromCharCode(n + 63);
    return s;
  };
  for (const [lat, lng] of pts) {
    const la = Math.round(lat * 1e6);
    const ln = Math.round(lng * 1e6);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

function lineZWkt(pts) {
  return (
    "LINESTRING Z (" +
    pts.map(([lat, lng, e]) => `${lng.toFixed(6)} ${lat.toFixed(6)} ${e.toFixed(1)}`).join(", ") +
    ")"
  );
}

// --- destinations ------------------------------------------------------------

const destinations = [
  {
    id: "RainierSummit0000001",
    name: "Mount Rainier",
    elevation: 4392,
    prominence: 4026,
    lat: 46.8528,
    lng: -121.7604,
    features: ["volcano", "summit"],
    activities: ["outdoor-trek", "ski"],
    hero_image: "/seed/mount-rainier.jpg",
    hero_image_attribution: "Stan Shebs / Wikimedia Commons",
    hero_image_attribution_url:
      "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_west.jpg",
    averages: {
      months: { jan: 2, feb: 1, mar: 3, apr: 6, may: 14, jun: 29, jul: 47, aug: 42, sep: 19, oct: 7, nov: 2, dec: 1 },
      days: { sat: 58, sun: 47, fri: 24, mon: 12, tue: 9, wed: 11, thu: 12 },
      totalSessions: 173,
    },
  },
  {
    id: "CampMuir000000000001",
    name: "Camp Muir",
    elevation: 3072,
    prominence: null,
    lat: 46.83549,
    lng: -121.73337,
    features: ["hut", "campsite"],
    activities: ["outdoor-trek"],
    amenities: { toilet: "pit", drinking_water: "no", backcountry: true, reservation: "required" },
  },
  {
    id: "ParadiseTrailhead001",
    name: "Paradise Trailhead",
    elevation: 1647,
    prominence: null,
    lat: 46.78605,
    lng: -121.73561,
    features: ["trailhead"],
    activities: ["outdoor-trek"],
  },
  {
    id: "PanoramaPoint0000001",
    name: "Panorama Point",
    elevation: 2095,
    prominence: null,
    lat: 46.79951,
    lng: -121.73159,
    features: ["viewpoint"],
    activities: ["outdoor-trek"],
  },
  {
    id: "IngrahamFlats0000001",
    name: "Ingraham Flats",
    elevation: 3414,
    prominence: null,
    lat: 46.8448,
    lng: -121.7312,
    features: ["campsite"],
    activities: ["outdoor-trek"],
    amenities: { backcountry: true, reservation: "required", drinking_water: "no" },
  },
  {
    id: "LittleTahoma00000001",
    name: "Little Tahoma",
    elevation: 3395,
    prominence: 858,
    lat: 46.8497,
    lng: -121.7129,
    features: ["summit"],
    activities: ["outdoor-trek"],
  },
  {
    id: "PinnaclePeak00000001",
    name: "Pinnacle Peak",
    elevation: 2000,
    prominence: 277,
    lat: 46.7644,
    lng: -121.7335,
    features: ["summit", "viewpoint"],
    activities: ["outdoor-trek"],
  },
  {
    id: "WhiteRiverTrailhead1",
    name: "White River Trailhead",
    elevation: 1310,
    prominence: null,
    lat: 46.90227,
    lng: -121.64182,
    features: ["trailhead"],
    activities: ["outdoor-trek"],
  },
  {
    id: "CampSchurman00000001",
    name: "Camp Schurman",
    elevation: 2900,
    prominence: null,
    lat: 46.867,
    lng: -121.728,
    features: ["hut", "campsite"],
    activities: ["outdoor-trek"],
  },
  // Far volcanoes for the lists
  { id: "MountAdams0000000001", name: "Mount Adams", elevation: 3743, prominence: 2453, lat: 46.2024, lng: -121.4909, features: ["volcano", "summit"], activities: ["outdoor-trek", "ski"] },
  { id: "MountStHelens0000001", name: "Mount St. Helens", elevation: 2549, prominence: 1404, lat: 46.1914, lng: -122.1956, features: ["volcano", "summit"], activities: ["outdoor-trek"] },
  { id: "GlacierPeak000000001", name: "Glacier Peak", elevation: 3213, prominence: 2261, lat: 48.1125, lng: -121.1138, features: ["volcano", "summit"], activities: ["outdoor-trek", "ski"] },
  { id: "MountBaker0000000001", name: "Mount Baker", elevation: 3286, prominence: 2686, lat: 48.7768, lng: -121.8145, features: ["volcano", "summit"], activities: ["outdoor-trek", "ski"] },
];

// --- route geometry ----------------------------------------------------------

const lowerWaypoints = [
  [46.78605, -121.73561, 1647], // Paradise
  [46.79951, -121.73159, 2095], // Panorama Point
  [46.80926, -121.72894, 2240], // Pebble Creek
  [46.81731, -121.72782, 2530], // McClure Rock
  [46.8264, -121.7307, 2810], // Moon Rocks
  [46.83549, -121.73337, 3072], // Camp Muir
];

const upperWaypoints = [
  [46.83549, -121.73337, 3072], // Camp Muir
  [46.84135, -121.72906, 3280], // Cathedral Gap
  [46.8448, -121.7312, 3414], // Ingraham Flats
  [46.84628, -121.73519, 3505], // DC toe
  [46.8509, -121.73917, 3749], // Top of the Cleaver
  [46.85389, -121.74778, 4050], // High break
  [46.8537, -121.755, 4302], // Crater rim
  [46.8528, -121.7604, 4392], // Columbia Crest
];

const lowerPath = buildPath(lowerWaypoints, { zigzag: 0.0007 });
const upperPath = buildPath(upperWaypoints, { zigzag: 0.0004 });
const fullPath = [...lowerPath, ...upperPath.slice(1)];

const lowerStats = pathStats(lowerPath);
const upperStats = pathStats(upperPath);
const fullStats = pathStats(fullPath);

// --- seed --------------------------------------------------------------------

async function main() {
  for (const d of destinations) {
    await db.query(
      `INSERT INTO destinations
         (id, name, search_name, elevation, prominence, location, type,
          activities, features, owner, country_code, state_code,
          hero_image, hero_image_attribution, hero_image_attribution_url,
          averages, amenities)
       VALUES ($1, $2, $3, $4, $5,
               ST_SetSRID(ST_MakePoint($6, $7, $4::double precision), 4326)::geography,
               'point', $8::activity_type[], $9::destination_feature[], 'peaks',
               'US', 'WA', $10, $11, $12, $13::jsonb, $14::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        d.id,
        d.name,
        d.name.toLowerCase(),
        d.elevation,
        d.prominence,
        d.lng,
        d.lat,
        d.activities,
        d.features,
        d.hero_image ?? null,
        d.hero_image_attribution ?? null,
        d.hero_image_attribution_url ?? null,
        d.averages ? JSON.stringify(d.averages) : null,
        d.amenities ? JSON.stringify(d.amenities) : null,
      ]
    );
  }

  // segments
  const segments = [
    { id: "SegParadiseCampMuir1", name: "Paradise to Camp Muir", path: lowerPath, stats: lowerStats },
    { id: "SegMuirColumbiaCrst1", name: "Camp Muir to Columbia Crest", path: upperPath, stats: upperStats },
  ];
  for (const s of segments) {
    await db.query(
      `INSERT INTO segments (id, name, path, polyline6, distance, gain, gain_loss)
       VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, lineZWkt(s.path), encodePolyline6(s.path), s.stats.dist, s.stats.gain, s.stats.loss]
    );
  }

  // routes
  await db.query(
    `INSERT INTO routes
       (id, name, path, polyline6, owner, distance, gain, gain_loss,
        elevation_string, external_links, completion, shape, status)
     VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
             $5, $6, $7, $8, $9::jsonb, 'none', 'out_and_back', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      "DisappointmentClvr01",
      "Disappointment Cleaver",
      lineZWkt(fullPath),
      encodePolyline6(fullPath),
      fullStats.dist,
      fullStats.gain,
      fullStats.loss,
      "5,400 ft – 14,410 ft",
      JSON.stringify([
        { type: "alltrails", id: "https://www.alltrails.com/trail/us/washington/mount-rainier-via-disappointment-cleaver" },
        { type: "caltopo", id: "https://caltopo.com/m/EH41" },
      ]),
    ]
  );

  await db.query(
    `INSERT INTO routes
       (id, name, path, polyline6, owner, distance, gain, gain_loss,
        elevation_string, completion, shape, status)
     VALUES ($1, $2, ST_GeomFromText($3, 4326)::geography, $4, 'peaks',
             $5, $6, $7, $8, 'none', 'out_and_back', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      "MuirSnowfieldRoute01",
      "Camp Muir via Muir Snowfield",
      lineZWkt(lowerPath),
      encodePolyline6(lowerPath),
      lowerStats.dist,
      lowerStats.gain,
      lowerStats.loss,
      "5,400 ft – 10,080 ft",
    ]
  );

  await db.query(
    `INSERT INTO routes
       (id, name, owner, distance, gain, gain_loss, elevation_string,
        completion, shape, status)
     VALUES ($1, $2, 'peaks', $3, $4, $5, $6, 'none', 'out_and_back', 'active')
     ON CONFLICT (id) DO NOTHING`,
    ["EmmonsWinthropRoute1", "Emmons–Winthrop Glacier", 13700, 3082, 95, "4,300 ft – 14,410 ft"]
  );

  // route composition + waypoints
  const routeSegments = [
    ["DisappointmentClvr01", "SegParadiseCampMuir1", 0],
    ["DisappointmentClvr01", "SegMuirColumbiaCrst1", 1],
    ["MuirSnowfieldRoute01", "SegParadiseCampMuir1", 0],
  ];
  for (const [routeId, segId, ordinal] of routeSegments) {
    await db.query(
      `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
       VALUES ($1, $2, $3, 'forward') ON CONFLICT DO NOTHING`,
      [routeId, segId, ordinal]
    );
  }

  const routeDests = [
    ["DisappointmentClvr01", "ParadiseTrailhead001", 0],
    ["DisappointmentClvr01", "PanoramaPoint0000001", 1],
    ["DisappointmentClvr01", "CampMuir000000000001", 2],
    ["DisappointmentClvr01", "IngrahamFlats0000001", 3],
    ["DisappointmentClvr01", "RainierSummit0000001", 4],
    ["MuirSnowfieldRoute01", "ParadiseTrailhead001", 0],
    ["MuirSnowfieldRoute01", "PanoramaPoint0000001", 1],
    ["MuirSnowfieldRoute01", "CampMuir000000000001", 2],
    ["EmmonsWinthropRoute1", "WhiteRiverTrailhead1", 0],
    ["EmmonsWinthropRoute1", "CampSchurman00000001", 1],
    ["EmmonsWinthropRoute1", "RainierSummit0000001", 2],
  ];
  for (const [routeId, destId, ordinal] of routeDests) {
    await db.query(
      `INSERT INTO route_destinations (route_id, destination_id, ordinal)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [routeId, destId, ordinal]
    );
  }

  // lists
  const lists = [
    {
      id: "CascadeVolcanoesList",
      name: "Cascade Volcanoes",
      description: "The major stratovolcanoes of the Cascade Range, from Baker south to Adams.",
      dests: ["MountBaker0000000001", "GlacierPeak000000001", "RainierSummit0000001", "MountStHelens0000001", "MountAdams0000000001"],
    },
    {
      id: "WaUltraProminence001",
      name: "Washington Ultras",
      description: "Washington peaks with more than 1,500 m of topographic prominence.",
      dests: ["RainierSummit0000001", "MountBaker0000000001", "GlacierPeak000000001", "MountAdams0000000001"],
    },
  ];
  for (const l of lists) {
    await db.query(
      `INSERT INTO lists (id, name, description, owner) VALUES ($1, $2, $3, 'peaks')
       ON CONFLICT (id) DO NOTHING`,
      [l.id, l.name, l.description]
    );
    for (let i = 0; i < l.dests.length; i++) {
      await db.query(
        `INSERT INTO list_destinations (list_id, destination_id, ordinal)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [l.id, l.dests[i], i]
      );
    }
  }

  // sessions: 35 total — all reach Camp Muir, 23 reach the summit, 14 on DC
  const sessionDates = [];
  for (let i = 0; i < 35; i++) {
    const year = i % 3 === 0 ? 2024 : 2025;
    const month = [5, 6, 6, 7, 7, 7, 8, 8, 8, 9][i % 10];
    const day = 1 + ((i * 7) % 27);
    sessionDates.push(new Date(Date.UTC(year, month - 1, day, 13, 30)));
  }
  for (let i = 0; i < sessionDates.length; i++) {
    const sid = `seedsession${String(i).padStart(8, "0")}`;
    await db.query(
      `INSERT INTO tracking_sessions (id, user_id, start_time, end_time, distance, gain, highest_point, total_time, activity_type)
       VALUES ($1, 'seeduser000000000001', $2, $3, $4, $5, $6, $7, 'outdoor-trek')
       ON CONFLICT (id) DO NOTHING`,
      [
        sid,
        sessionDates[i].toISOString(),
        new Date(sessionDates[i].getTime() + 9 * 3600 * 1000).toISOString(),
        i < 23 ? fullStats.dist * 2 : lowerStats.dist * 2,
        i < 23 ? fullStats.gain : lowerStats.gain,
        i < 23 ? 4392 : 3072,
        9 * 3600,
      ]
    );
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, 'CampMuir000000000001', 'reached', 'auto') ON CONFLICT DO NOTHING`,
      [sid]
    );
    if (i < 23) {
      await db.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation, source)
         VALUES ($1, 'RainierSummit0000001', 'reached', 'auto') ON CONFLICT DO NOTHING`,
        [sid]
      );
    }
    if (i < 14) {
      await db.query(
        `INSERT INTO session_routes (session_id, route_id, source, coverage)
         VALUES ($1, 'DisappointmentClvr01', 'auto', 0.97) ON CONFLICT DO NOTHING`,
        [sid]
      );
    } else {
      await db.query(
        `INSERT INTO session_routes (session_id, route_id, source, coverage)
         VALUES ($1, 'MuirSnowfieldRoute01', 'auto', 0.95) ON CONFLICT DO NOTHING`,
        [sid]
      );
    }
  }

  console.log("Seeded.", {
    dc: fullStats,
    lower: lowerStats,
    upper: upperStats,
    pathPoints: fullPath.length,
  });
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
