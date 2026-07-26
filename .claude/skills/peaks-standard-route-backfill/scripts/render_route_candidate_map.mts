import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

type Position = [number, number];

type Options = {
  geojsonPath: string;
  outputPath: string;
  style: string;
  width: number;
  height: number;
};

function usage(): string {
  return [
    "Usage:",
    "  MAPBOX_TOKEN=... tsx render_route_candidate_map.mts \\",
    "    --geojson candidate.geojson --output candidate.png \\",
    "    [--style mapbox/outdoors-v12] [--width 1000] [--height 1000]",
    "",
    "Renders a static review map. It does not write Cloud SQL.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    geojsonPath: "",
    outputPath: "",
    style: "mapbox/outdoors-v12",
    width: 1000,
    height: 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    if (arg === "--geojson") {
      options.geojsonPath = value;
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = value;
      index += 1;
    } else if (arg === "--style") {
      options.style = value;
      index += 1;
    } else if (arg === "--width") {
      options.width = Number(value);
      index += 1;
    } else if (arg === "--height") {
      options.height = Number(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.geojsonPath) throw new Error("--geojson is required");
  if (!options.outputPath) throw new Error("--output is required");
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(options.style)) {
    throw new Error("--style must look like owner/style-id");
  }
  for (const [flag, value] of [
    ["--width", options.width],
    ["--height", options.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 200 || value > 1280) {
      throw new Error(`${flag} must be an integer from 200 to 1280`);
    }
  }
  return options;
}

function sampleLine(coordinates: Position[], count: number): Position[] {
  if (coordinates.length <= count) return coordinates;
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (coordinates.length - 1)) / (count - 1)
    );
    return coordinates[sourceIndex];
  });
}

function staticOverlay(coordinates: Position[], sampleCount: number) {
  const sampled = sampleLine(coordinates, sampleCount);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          stroke: "#00A896",
          "stroke-width": 5,
          "stroke-opacity": 0.9,
        },
        geometry: { type: "LineString", coordinates: sampled },
      },
      {
        type: "Feature",
        properties: {
          "marker-color": "#F59E0B",
          "marker-size": "small",
        },
        geometry: { type: "Point", coordinates: coordinates[0] },
      },
      {
        type: "Feature",
        properties: {
          "marker-color": "#111111",
          "marker-size": "small",
          "marker-symbol": "triangle",
        },
        geometry: {
          type: "Point",
          coordinates: coordinates[coordinates.length - 1],
        },
      },
    ],
  };
}

const options = parseArgs(process.argv.slice(2));
const mapboxToken = process.env.MAPBOX_TOKEN;
if (!mapboxToken) throw new Error("MAPBOX_TOKEN is required");

const input = JSON.parse(await readFile(options.geojsonPath, "utf8")) as {
  features?: Array<{
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};
const line = input.features?.find(
  (feature) => feature.geometry?.type === "LineString"
)?.geometry?.coordinates;
if (
  !Array.isArray(line) ||
  line.length < 2 ||
  !line.every(
    (coordinate) =>
      Array.isArray(coordinate) &&
      coordinate.length >= 2 &&
      coordinate.slice(0, 2).every(Number.isFinite)
  )
) {
  throw new Error("GeoJSON must contain a valid LineString feature");
}
const coordinates = line.map(
  (coordinate) => coordinate.slice(0, 2) as Position
);

let sampleCount = Math.min(80, coordinates.length);
let staticUrl = "";
while (sampleCount >= 10) {
  const overlay = encodeURIComponent(
    JSON.stringify(staticOverlay(coordinates, sampleCount))
  );
  staticUrl =
    `https://api.mapbox.com/styles/v1/${options.style}/static/` +
    `geojson(${overlay})/auto/${options.width}x${options.height}` +
    `?padding=90&access_token=${encodeURIComponent(mapboxToken)}`;
  if (staticUrl.length < 7900) break;
  sampleCount -= 10;
}
if (staticUrl.length >= 7900) {
  throw new Error("Static map URL is too long even after line sampling");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
let response: Response;
try {
  response = await fetch(staticUrl, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
if (!response.ok) {
  throw new Error(`Mapbox returned HTTP ${response.status}: ${await response.text()}`);
}
await writeFile(options.outputPath, Buffer.from(await response.arrayBuffer()));
console.log(
  `Wrote ${options.outputPath}; sampled ${sampleCount}/${coordinates.length} points`
);
