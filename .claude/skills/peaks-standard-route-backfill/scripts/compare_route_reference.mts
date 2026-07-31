import { readFile } from "node:fs/promises";
import process from "node:process";

type Position = [number, number];

function usage(): string {
  return [
    "Usage:",
    "  tsx compare_route_reference.mts \\",
    "    --candidate candidate.geojson --reference private-reference.gpx \\",
    "    [--reference-start-point N] [--reference-max-points N]",
    "",
    "Compares a publishable candidate with a private GPX reference. It prints",
    "distance statistics and never copies reference coordinates into output.",
  ].join("\n");
}

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

function haversineMeters(a: Position, b: Position): number {
  const earthRadiusM = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) *
      Math.cos(toRadians(b[1])) *
      Math.sin(dLng / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointToSegmentMeters(
  point: Position,
  start: Position,
  end: Position
): number {
  const meanLatitudeRadians =
    (((point[1] + start[1] + end[1]) / 3) * Math.PI) / 180;
  const xScale = 111320 * Math.cos(meanLatitudeRadians);
  const yScale = 110540;
  const px = (point[0] - start[0]) * xScale;
  const py = (point[1] - start[1]) * yScale;
  const ex = (end[0] - start[0]) * xScale;
  const ey = (end[1] - start[1]) * yScale;
  const lengthSquared = ex * ex + ey * ey;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  return Math.hypot(px - fraction * ex, py - fraction * ey);
}

function nearestLineMeters(point: Position, line: Position[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointToSegmentMeters(point, line[index - 1], line[index])
    );
  }
  return nearest;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function densifyLine(line: Position[], maxSegmentM = 10): Position[] {
  const densified: Position[] = [line[0]];
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const steps = Math.max(1, Math.ceil(haversineMeters(start, end) / maxSegmentM));
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      densified.push([
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ]);
    }
  }
  return densified;
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}
const candidatePath = valueAfter(argv, "--candidate");
const referencePath = valueAfter(argv, "--reference");
if (!candidatePath || !referencePath) throw new Error(usage());
const referenceStartPointText = valueAfter(argv, "--reference-start-point");
const referenceStartPoint = referenceStartPointText
  ? Number(referenceStartPointText)
  : 0;
if (!Number.isInteger(referenceStartPoint) || referenceStartPoint < 0) {
  throw new Error("--reference-start-point must be a non-negative integer");
}
const referenceMaxPointsText = valueAfter(argv, "--reference-max-points");
const referenceMaxPoints = referenceMaxPointsText
  ? Number(referenceMaxPointsText)
  : null;
if (
  referenceMaxPoints !== null &&
  (!Number.isInteger(referenceMaxPoints) || referenceMaxPoints < 2)
) {
  throw new Error("--reference-max-points must be an integer of at least 2");
}

const candidate = JSON.parse(await readFile(candidatePath, "utf8")) as {
  features?: Array<{
    geometry?: { type?: string; coordinates?: unknown };
  }>;
};
const rawCandidate = candidate.features?.find(
  ({ geometry }) => geometry?.type === "LineString"
)?.geometry?.coordinates;
if (!Array.isArray(rawCandidate) || rawCandidate.length < 2) {
  throw new Error("Candidate must contain a LineString");
}
const candidateLine = rawCandidate.map((coordinate) => {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length < 2 ||
    !coordinate.slice(0, 2).every(Number.isFinite)
  ) {
    throw new Error("Candidate has an invalid coordinate");
  }
  return coordinate.slice(0, 2) as Position;
});

const gpx = await readFile(referencePath, "utf8");
if (!gpx.trimStart().startsWith("<?xml") || !/<(?:trkpt|rtept)\b/i.test(gpx)) {
  throw new Error("Reference is not a valid GPX track or route");
}
const referenceLine: Position[] = [];
const pointPattern =
  /<(?:trkpt|rtept)\b[^>]*\blat="(-?\d+(?:\.\d+)?)"[^>]*\blon="(-?\d+(?:\.\d+)?)"/gi;
for (const match of gpx.matchAll(pointPattern)) {
  referenceLine.push([Number(match[2]), Number(match[1])]);
}
if (referenceStartPoint > 0) {
  referenceLine.splice(0, referenceStartPoint);
}
if (
  referenceMaxPoints !== null &&
  referenceLine.length > referenceMaxPoints
) {
  referenceLine.length = referenceMaxPoints;
}
if (referenceLine.length < 2) throw new Error("Reference has fewer than two points");

const comparisonLine = densifyLine(candidateLine);
const deviationSamples = comparisonLine.map((point, index) => ({
  point,
  index,
  distance: nearestLineMeters(point, referenceLine),
}));
const deviations = deviationSamples
  .map(({ distance }) => distance)
  .sort((a, b) => a - b);
const worstSample = deviationSamples.reduce((worst, sample) =>
  sample.distance > worst.distance ? sample : worst
);
const over50m = deviationSamples.filter(({ distance }) => distance > 50);
const candidateLengthM = candidateLine
  .slice(1)
  .reduce(
    (total, point, index) =>
      total + haversineMeters(candidateLine[index], point),
    0
  );
const referenceLengthM = referenceLine
  .slice(1)
  .reduce(
    (total, point, index) =>
      total + haversineMeters(referenceLine[index], point),
    0
  );

console.log(`Candidate: ${(candidateLengthM / 1609.344).toFixed(2)} mi`);
console.log(`Reference: ${(referenceLengthM / 1609.344).toFixed(2)} mi`);
console.log(
  `Deviation: median ${percentile(deviations, 0.5).toFixed(1)} m; ` +
    `p95 ${percentile(deviations, 0.95).toFixed(1)} m; ` +
    `max ${deviations[deviations.length - 1].toFixed(1)} m ` +
    `(${comparisonLine.length} samples)`
);
console.log(
  `Endpoints to reference: start ${nearestLineMeters(
    candidateLine[0],
    referenceLine
  ).toFixed(1)} m; finish ${nearestLineMeters(
    candidateLine[candidateLine.length - 1],
    referenceLine
  ).toFixed(1)} m`
);
console.log(
  `Worst candidate sample: ${worstSample.distance.toFixed(1)} m at ` +
    `${worstSample.point[1].toFixed(6)},${worstSample.point[0].toFixed(6)} ` +
    `(${worstSample.index}/${comparisonLine.length - 1})`
);
if (over50m.length > 0) {
  const first = over50m[0];
  const last = over50m[over50m.length - 1];
  console.log(
    `Samples over 50 m: ${over50m.length}; first ` +
      `${first.point[1].toFixed(6)},${first.point[0].toFixed(6)}; last ` +
      `${last.point[1].toFixed(6)},${last.point[0].toFixed(6)}`
  );
}
