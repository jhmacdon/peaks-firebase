#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

type GeoJson = {
  type: "FeatureCollection";
  peaks_destination_id: string;
  peaks_trailhead_id: string;
  peaks_source: string;
  peaks_retrieval_source?: string;
  peaks_license_name: string;
  peaks_license: string;
  peaks_attribution: string;
  peaks_retrieved_at: string;
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
  }>;
};

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function numberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item))) {
    throw new Error(`${label} must be an integer array`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function distanceM(a: [number, number], b: [number, number]): number {
  const meanLat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.hypot(
    (a[1] - b[1]) * 111_320,
    (a[0] - b[0]) * 111_320 * Math.cos(meanLat)
  );
}

async function load(path: string): Promise<GeoJson> {
  const value = JSON.parse(await readFile(path, "utf8")) as GeoJson;
  if (
    value.type !== "FeatureCollection" ||
    value.features?.length !== 1 ||
    value.features[0].geometry?.type !== "LineString"
  ) {
    throw new Error(`${path} is not a one-line candidate`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: merge_osm_loop_candidates.mts --outbound ascent.geojson " +
        "--return descent-reversed.geojson --trailhead-id ID " +
        "[--route-shape loop|lollipop] --output loop.geojson"
    );
    return;
  }
  const outboundPath = valueAfter(argv, "--outbound");
  const returnPath = valueAfter(argv, "--return");
  const trailheadId = valueAfter(argv, "--trailhead-id");
  const routeShape = valueAfter(argv, "--route-shape") || "loop";
  const outputPath = valueAfter(argv, "--output");
  if (!outboundPath || !returnPath || !trailheadId || !outputPath) {
    throw new Error(
      "Usage: merge_osm_loop_candidates.mts --outbound ascent.geojson " +
      "--return descent-reversed.geojson --trailhead-id ID " +
      "[--route-shape loop|lollipop] --output loop.geojson"
    );
  }
  if (!["loop", "lollipop"].includes(routeShape)) {
    throw new Error("--route-shape must be loop or lollipop");
  }

  const outbound = await load(outboundPath);
  const returnLeg = await load(returnPath);
  if (
    outbound.peaks_destination_id !== returnLeg.peaks_destination_id ||
    outbound.peaks_source !== returnLeg.peaks_source ||
    outbound.peaks_license !== returnLeg.peaks_license ||
    outbound.peaks_attribution !== returnLeg.peaks_attribution
  ) {
    throw new Error("Candidate source or destination metadata does not match");
  }

  const outboundFeature = outbound.features[0];
  const returnFeature = returnLeg.features[0];
  const outboundCoordinates = outboundFeature.geometry.coordinates;
  const returnCoordinates = returnFeature.geometry.coordinates;
  if (
    distanceM(outboundCoordinates[0], returnCoordinates[0]) > 20 ||
    distanceM(
      outboundCoordinates[outboundCoordinates.length - 1],
      returnCoordinates[returnCoordinates.length - 1]
    ) > 20
  ) {
    throw new Error("Candidate trailhead or summit endpoints do not match");
  }

  const outboundProperties = outboundFeature.properties;
  const returnProperties = returnFeature.properties;
  const wayIds = [
    ...new Set([
      ...numberArray(outboundProperties.osm_way_ids, "outbound way ids"),
      ...numberArray(returnProperties.osm_way_ids, "return way ids"),
    ]),
  ];
  const wayNames = [
    ...new Set([
      ...stringArray(outboundProperties.osm_way_names, "outbound way names"),
      ...stringArray(returnProperties.osm_way_names, "return way names"),
    ]),
  ];
  const accessOverrides = [
    ...new Set([
      ...numberArray(
        outboundProperties.osm_foot_access_override_way_ids,
        "outbound access overrides"
      ),
      ...numberArray(
        returnProperties.osm_foot_access_override_way_ids,
        "return access overrides"
      ),
    ]),
  ];
  const coordinates = [
    ...outboundCoordinates,
    ...[...returnCoordinates].reverse().slice(1),
  ];
  const result: GeoJson = {
    ...outbound,
    peaks_trailhead_id: trailheadId,
    peaks_retrieved_at: new Date(
      Math.max(
        Date.parse(outbound.peaks_retrieved_at),
        Date.parse(returnLeg.peaks_retrieved_at)
      )
    ).toISOString(),
    features: [
      {
        type: "Feature",
        properties: {
          ...outboundProperties,
          name: `${String(outboundProperties.destination_name)} OSM loop candidate`,
          distance_m:
            numberValue(outboundProperties.distance_m, "outbound distance") +
            numberValue(returnProperties.distance_m, "return distance"),
          trailhead_snap_m: Math.max(
            numberValue(outboundProperties.trailhead_snap_m, "outbound trailhead snap"),
            numberValue(returnProperties.trailhead_snap_m, "return trailhead snap")
          ),
          summit_snap_m: Math.max(
            numberValue(outboundProperties.summit_snap_m, "outbound summit snap"),
            numberValue(returnProperties.summit_snap_m, "return summit snap")
          ),
          osm_way_ids: wayIds,
          osm_way_urls: wayIds.map(
            (id) => `https://www.openstreetmap.org/way/${id}`
          ),
          osm_way_names: wayNames,
          osm_foot_access_override_way_ids: accessOverrides,
          route_shape: routeShape,
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
  await writeFile(outputPath, `${JSON.stringify(result)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
