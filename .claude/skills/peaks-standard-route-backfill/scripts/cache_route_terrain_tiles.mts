#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ZOOM = 14;
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

function tileFor(lng: number, rawLat: number): Tile {
  const n = 2 ** ZOOM;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, rawLat));
  const latRadians = lat * Math.PI / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(
      (1 -
        Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) /
          Math.PI) /
        2 *
        n
    ),
  };
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
  const lngs = coordinates.map((coordinate) => coordinate[0]);
  const lats = coordinates.map((coordinate) => coordinate[1]);
  const northwest = tileFor(Math.min(...lngs), Math.max(...lats));
  const southeast = tileFor(Math.max(...lngs), Math.min(...lats));
  const minX = Math.min(northwest.x, southeast.x);
  const maxX = Math.max(northwest.x, southeast.x);
  const minY = Math.min(northwest.y, southeast.y);
  const maxY = Math.max(northwest.y, southeast.y);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.set(`${x}/${y}`, { x, y });
    }
  }
}
if (tiles.size > 500) {
  throw new Error(
    `Refusing to fetch ${tiles.size} tiles; split the candidates into smaller batches`
  );
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
      await mkdir(path.dirname(tilePath), { recursive: true });
      await writeFile(tilePath, Buffer.from(await response.arrayBuffer()));
      fetched += 1;
    })
  );
}

console.log(
  `Terrain cache ready: ${tiles.size} rectangular-bounds tiles ` +
    `(${fetched} fetched, ${cached} cached)`
);
console.log(`Source: ${TILE_SOURCE}; Registry of Open Data on AWS`);
