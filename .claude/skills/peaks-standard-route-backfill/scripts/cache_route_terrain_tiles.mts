#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import atomicFileCache from "../../../../cloud-sql/migrate/src/atomic-file-cache";
import worldGeometryImport from "../../../../cloud-sql/migrate/src/route-world-geometry";

const ZOOM = 14;
const MAX_TERRAIN_TILES = 500;
const { writeAtomicCacheFile } = atomicFileCache;
const { boundedRouteWorldTiles, wrappedTileX } = worldGeometryImport;
const TILE_SOURCE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

type Tile = { x: number; y: number };

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string {
  return valuesAfter(argv, flag)[0] ?? "";
}

async function candidateCoordinates(
  candidatePath: string
): Promise<Array<[number, number]>> {
  const input = JSON.parse(await readFile(candidatePath, "utf8")) as {
    features?: Array<{
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  const rawCoordinates = input.features?.find(
    (feature) => feature.geometry?.type === "LineString"
  )?.geometry?.coordinates;
  if (
    !Array.isArray(rawCoordinates) ||
    rawCoordinates.length < 2 ||
    !rawCoordinates.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1])
    )
  ) {
    throw new Error(`${candidatePath} has no valid LineString`);
  }
  return rawCoordinates.map(
    (coordinate) => [Number(coordinate[0]), Number(coordinate[1])]
  );
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: cache_route_terrain_tiles.mts " +
      "--candidate route.geojson [--candidate route.geojson ...] " +
      "--output-dir /private/tmp/terrain-cache"
  );
  process.exit(0);
}
const candidatePaths = valuesAfter(argv, "--candidate");
const outputDir = valueAfter(argv, "--output-dir");
if (candidatePaths.length === 0 || !outputDir) {
  throw new Error("At least one --candidate and --output-dir are required");
}

const tiles = new Map<string, Tile>();
for (const candidatePath of candidatePaths) {
  const coordinates = await candidateCoordinates(candidatePath);
  const { minX, maxX, minY, maxY } = boundedRouteWorldTiles(
    coordinates,
    ZOOM,
    { maxTiles: MAX_TERRAIN_TILES }
  );
  for (let unwrappedX = minX; unwrappedX <= maxX; unwrappedX += 1) {
    const x = wrappedTileX(unwrappedX, ZOOM);
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}/${y}`;
      if (tiles.has(key)) continue;
      if (tiles.size >= MAX_TERRAIN_TILES) {
        throw new Error(
          `Refusing to fetch more than ${MAX_TERRAIN_TILES} terrain tiles; ` +
            "split the candidates into smaller batches"
        );
      }
      tiles.set(key, { x, y });
    }
  }
}

let fetched = 0;
let cached = 0;
const queue = [...tiles.values()];
for (let start = 0; start < queue.length; start += 12) {
  await Promise.all(
    queue.slice(start, start + 12).map(async (tile) => {
      const tilePath = path.join(
        outputDir,
        String(ZOOM),
        String(tile.x),
        `${tile.y}.png`
      );
      try {
        await access(tilePath);
        cached += 1;
        return;
      } catch {
        // Fetch the missing public terrain tile.
      }
      const response = await fetch(
        `${TILE_SOURCE}/${ZOOM}/${tile.x}/${tile.y}.png`,
        {
          headers: {
            "user-agent":
              "Peaks route research/1.0 " +
              "(https://github.com/jhmacdon/peaks-firebase)",
          },
        }
      );
      if (!response.ok) {
        throw new Error(
          `Terrain tile ${ZOOM}/${tile.x}/${tile.y} returned HTTP ` +
            response.status
        );
      }
      await writeAtomicCacheFile(
        tilePath,
        Buffer.from(await response.arrayBuffer())
      );
      fetched += 1;
    })
  );
}

console.log(
  `Terrain cache ready: ${tiles.size} wrapped-bounds tiles ` +
    `(${fetched} fetched, ${cached} cached)`
);
console.log(`Source: ${TILE_SOURCE}; Registry of Open Data on AWS`);
