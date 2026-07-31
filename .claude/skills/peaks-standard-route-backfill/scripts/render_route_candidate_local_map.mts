import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type Position = [number, number];

type Options = {
  geojsonPath: string;
  outputPath: string;
  width: number;
  height: number;
  tileCachePath: string;
};

const requireFromMigrate = createRequire(
  new URL("../../../../cloud-sql/migrate/package.json", import.meta.url)
);
const sharp = requireFromMigrate("sharp") as typeof import("sharp");

function usage(): string {
  return [
    "Usage:",
    "  tsx render_route_candidate_local_map.mts \\",
    "    --geojson candidate.geojson --output candidate.png \\",
    "    [--width 1000] [--height 1000] \\",
    "    [--tile-cache /private/tmp/peaks-osm-review-tiles]",
    "",
    "Fetches only ordinary OSM background tiles, then overlays the unpublished",
    "candidate geometry locally. The candidate line is never sent to a map API.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    geojsonPath: "",
    outputPath: "",
    width: 1000,
    height: 1000,
    tileCachePath: "/private/tmp/peaks-osm-review-tiles",
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
    } else if (arg === "--width") {
      options.width = Number(value);
      index += 1;
    } else if (arg === "--height") {
      options.height = Number(value);
      index += 1;
    } else if (arg === "--tile-cache") {
      options.tileCachePath = value;
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
  for (const [flag, value] of [
    ["--width", options.width],
    ["--height", options.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 400 || value > 2000) {
      throw new Error(`${flag} must be an integer from 400 to 2000`);
    }
  }
  return options;
}

function clampLatitude(latitude: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

function worldTilePosition([longitude, latitude]: Position, zoom: number) {
  const scale = 2 ** zoom;
  const latRadians = (clampLatitude(latitude) * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y:
      ((1 -
        Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) / Math.PI) /
        2) *
      scale,
  };
}

function chooseZoom(
  coordinates: Position[],
  width: number,
  height: number
): number {
  const targetX = Math.max(2, (width - 180) / 256);
  const targetY = Math.max(2, (height - 180) / 256);
  for (let zoom = 16; zoom >= 3; zoom -= 1) {
    const positions = coordinates.map((position) =>
      worldTilePosition(position, zoom)
    );
    const spanX =
      Math.max(...positions.map(({ x }) => x)) -
      Math.min(...positions.map(({ x }) => x));
    const spanY =
      Math.max(...positions.map(({ y }) => y)) -
      Math.min(...positions.map(({ y }) => y));
    if (spanX <= targetX && spanY <= targetY) return zoom;
  }
  return 3;
}

async function fetchTile(
  cacheRoot: string,
  zoom: number,
  x: number,
  y: number
): Promise<Buffer> {
  const cachePath = path.join(cacheRoot, String(zoom), String(x), `${y}.png`);
  try {
    return await readFile(cachePath);
  } catch {
    // Cache miss.
  }
  const response = await fetch(
    `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
    {
      headers: {
        "User-Agent":
          "Peaks standard-route review (https://www.peaks-app.com/)",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`OSM tile ${zoom}/${x}/${y} returned HTTP ${response.status}`);
  }
  const tile = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, tile);
  return tile;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const options = parseArgs(process.argv.slice(2));
const input = JSON.parse(await readFile(options.geojsonPath, "utf8")) as {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};
const feature = input.features?.find(
  (candidate) => candidate.geometry?.type === "LineString"
);
const line = feature?.geometry?.coordinates;
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
const zoom = chooseZoom(coordinates, options.width, options.height);
const tilePositions = coordinates.map((position) =>
  worldTilePosition(position, zoom)
);
const tileCount = 2 ** zoom;
const routeMinTileX = Math.floor(Math.min(...tilePositions.map(({ x }) => x)));
const routeMaxTileX = Math.floor(Math.max(...tilePositions.map(({ x }) => x)));
const routeMinTileY = Math.floor(Math.min(...tilePositions.map(({ y }) => y)));
const routeMaxTileY = Math.floor(Math.max(...tilePositions.map(({ y }) => y)));
const minTileX = Math.max(0, routeMinTileX - 1);
const maxTileX = Math.min(tileCount - 1, routeMaxTileX + 1);
const minTileY = Math.max(0, routeMinTileY - 1);
const maxTileY = Math.min(tileCount - 1, routeMaxTileY + 1);
const mosaicWidth = (maxTileX - minTileX + 1) * 256;
const mosaicHeight = (maxTileY - minTileY + 1) * 256;

const tileJobs: Array<Promise<{ input: Buffer; left: number; top: number }>> = [];
for (let x = minTileX; x <= maxTileX; x += 1) {
  for (let y = minTileY; y <= maxTileY; y += 1) {
    tileJobs.push(
      fetchTile(options.tileCachePath, zoom, x, y).then((input) => ({
        input,
        left: (x - minTileX) * 256,
        top: (y - minTileY) * 256,
      }))
    );
  }
}
const tiles = await Promise.all(tileJobs);
const mosaic = await sharp({
  create: {
    width: mosaicWidth,
    height: mosaicHeight,
    channels: 3,
    background: "#e7eadf",
  },
})
  .composite(tiles)
  .png()
  .toBuffer();

const pixels = tilePositions.map(({ x, y }) => ({
  x: (x - minTileX) * 256,
  y: (y - minTileY) * 256,
}));
const routeOverlay = Buffer.from(
  `<svg width="${mosaicWidth}" height="${mosaicHeight}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `<polyline points="${pixels
      .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ")}" fill="none" stroke="#ffffff" stroke-width="9" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>` +
    `<polyline points="${pixels
      .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ")}" fill="none" stroke="#007f73" stroke-width="5" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${pixels[0].x}" cy="${pixels[0].y}" r="10" ` +
    `fill="#f59e0b" stroke="#ffffff" stroke-width="4"/>` +
    `<path d="M ${pixels[pixels.length - 1].x} ${pixels[pixels.length - 1].y - 12} ` +
    `L ${pixels[pixels.length - 1].x - 11} ${pixels[pixels.length - 1].y + 9} ` +
    `L ${pixels[pixels.length - 1].x + 11} ${pixels[pixels.length - 1].y + 9} Z" ` +
    `fill="#111111" stroke="#ffffff" stroke-width="4"/>` +
    `</svg>`
);
const routeMinX = Math.min(...pixels.map(({ x }) => x));
const routeMaxX = Math.max(...pixels.map(({ x }) => x));
const routeMinY = Math.min(...pixels.map(({ y }) => y));
const routeMaxY = Math.max(...pixels.map(({ y }) => y));
const cropLeft = Math.max(0, Math.floor(routeMinX - 90));
const cropTop = Math.max(0, Math.floor(routeMinY - 90));
const cropRight = Math.min(mosaicWidth, Math.ceil(routeMaxX + 90));
const cropBottom = Math.min(mosaicHeight, Math.ceil(routeMaxY + 90));
const title =
  typeof feature?.properties?.name === "string"
    ? feature.properties.name
    : path.basename(options.geojsonPath, path.extname(options.geojsonPath));

const attributionOverlay = Buffer.from(
  `<svg width="${options.width}" height="${options.height}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${options.width}" height="42" fill="#ffffff" opacity="0.88"/>` +
    `<text x="16" y="27" font-family="Arial, sans-serif" font-size="19" ` +
    `font-weight="700" fill="#111111">${escapeXml(title)}</text>` +
    `<rect x="0" y="${options.height - 28}" width="${options.width}" height="28" ` +
    `fill="#ffffff" opacity="0.88"/>` +
    `<text x="${options.width - 12}" y="${options.height - 9}" text-anchor="end" ` +
    `font-family="Arial, sans-serif" font-size="14" fill="#333333">` +
    `© OpenStreetMap contributors · local candidate overlay</text>` +
    `</svg>`
);

const annotatedMosaic = await sharp(mosaic)
  .composite([{ input: routeOverlay }])
  .png()
  .toBuffer();

await sharp(annotatedMosaic)
  .extract({
    left: cropLeft,
    top: cropTop,
    width: cropRight - cropLeft,
    height: cropBottom - cropTop,
  })
  .resize(options.width, options.height, {
    fit: "contain",
    background: "#ffffff",
  })
  .composite([{ input: attributionOverlay }])
  .png()
  .toFile(options.outputPath);

console.log(
  `Wrote ${options.outputPath}; zoom ${zoom}, ${tiles.length} cached/background tiles, ` +
    `${coordinates.length} local route points`
);
