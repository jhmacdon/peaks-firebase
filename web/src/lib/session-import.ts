import { haversineDistance } from "./gpx";

export const MAX_GPX_SESSION_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_GPX_SESSION_POINTS = 25_000;
const MAX_GPX_XML_DEPTH = 128;
const MAX_GPX_XML_TAGS = 500_000;

export type GPXImportSource = "garmin" | "gaia" | "strava" | "gpxFile";

export interface GPXSessionPoint {
  time: number;
  segment_number: number;
  lat: number;
  lng: number;
  elevation: number;
}

export interface GPXSessionStats {
  distance: number;
  gain: number;
  totalTime: number;
  pace: number | null;
  highestPoint: number;
  ascentTime: number;
  descentTime: number;
  stillTime: number;
}

export interface ParsedGPXSession {
  name: string;
  creator: string | null;
  source: GPXImportSource;
  externalId: string;
  points: GPXSessionPoint[];
  startTime: number;
  endTime: number;
  stats: GPXSessionStats;
  ignoredPointCount: number;
}

interface XmlElement {
  attributes: string;
  body: string;
}

interface XmlStructure {
  pointCount: number;
  rootLocalName: string | null;
}

function isXmlSpace(character: string): boolean {
  return (
    character === " " ||
    character === "\n" ||
    character === "\r" ||
    character === "\t"
  );
}

function isXmlNameCharacter(character: string): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code >= 128 ||
    character === "_" ||
    character === "." ||
    character === ":" ||
    character === "-"
  );
}

function localXmlName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1).toLowerCase();
}

function findMarkupEnd(
  xml: string,
  start: number,
  terminator: string,
  errorMessage: string
): number {
  const end = xml.indexOf(terminator, start);
  if (end === -1) throw new Error(errorMessage);
  return end + terminator.length;
}

function findTagEnd(xml: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === "<") {
        throw new Error("GPX XML contains an invalid attribute");
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "<") {
      throw new Error("GPX XML contains an unclosed tag");
    }
    if (character === ">") return index;
  }
  throw new Error("GPX XML contains an unclosed tag");
}

/**
 * Scan structure in linear time before the body-extracting regexes run.
 *
 * A malformed string with thousands of unclosed `<trkpt` starts made the old
 * paired-element regex retry from every opening tag. This pass walks each byte
 * once, caps point tags before extraction, and rejects unbalanced markup.
 */
function preflightXml(xml: string): XmlStructure {
  const stack: string[] = [];
  let cursor = 0;
  let tagCount = 0;
  let pointCount = 0;
  let rootName: string | null = null;
  let rootClosed = false;
  let openPointName: string | null = null;

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start === -1) break;

    if (xml.startsWith("<!--", start)) {
      cursor = findMarkupEnd(
        xml,
        start + 4,
        "-->",
        "GPX XML contains an unclosed comment"
      );
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      cursor = findMarkupEnd(
        xml,
        start + 9,
        "]]>",
        "GPX XML contains an unclosed CDATA section"
      );
      continue;
    }
    if (xml.startsWith("<?", start)) {
      cursor = findMarkupEnd(
        xml,
        start + 2,
        "?>",
        "GPX XML contains an unclosed processing instruction"
      );
      continue;
    }
    if (xml.slice(start, start + 9).toUpperCase() === "<!DOCTYPE") {
      throw new Error("GPX files with a DOCTYPE are not supported");
    }
    if (xml.startsWith("<!", start)) {
      throw new Error("GPX XML contains an unsupported declaration");
    }

    let nameStart = start + 1;
    while (isXmlSpace(xml[nameStart])) nameStart += 1;
    const closing = xml[nameStart] === "/";
    if (closing) {
      nameStart += 1;
      while (isXmlSpace(xml[nameStart])) nameStart += 1;
    }

    let nameEnd = nameStart;
    while (isXmlNameCharacter(xml[nameEnd])) nameEnd += 1;
    if (nameEnd === nameStart) {
      throw new Error("GPX XML contains an invalid tag");
    }

    const name = xml.slice(nameStart, nameEnd);
    const localName = localXmlName(name);
    const end = findTagEnd(xml, nameEnd);
    let tail = end - 1;
    while (tail >= nameEnd && isXmlSpace(xml[tail])) tail -= 1;
    const selfClosing = !closing && xml[tail] === "/";

    tagCount += 1;
    if (tagCount > MAX_GPX_XML_TAGS) {
      throw new Error("GPX file contains too many XML elements");
    }

    if (closing) {
      for (let index = nameEnd; index < end; index += 1) {
        if (!isXmlSpace(xml[index])) {
          throw new Error("GPX XML contains an invalid closing tag");
        }
      }
      const expected = stack.pop();
      if (expected !== name) {
        throw new Error("GPX XML tags are not balanced");
      }
      if (localName === "trkpt" || localName === "rtept") {
        openPointName = null;
      }
      if (stack.length === 0) rootClosed = true;
    } else {
      if (stack.length === 0) {
        if (rootName !== null || rootClosed) {
          throw new Error("GPX XML must contain one root element");
        }
        rootName = name;
      }

      if (localName === "trkpt" || localName === "rtept") {
        pointCount += 1;
        if (pointCount > MAX_GPX_SESSION_POINTS) {
          throw new Error(
            `GPX file has more than ${MAX_GPX_SESSION_POINTS.toLocaleString()} point elements`
          );
        }
        if (openPointName !== null) {
          throw new Error("GPX point elements cannot be nested");
        }
        if (!selfClosing) openPointName = name;
      }

      if (selfClosing) {
        if (stack.length === 0) rootClosed = true;
      } else {
        stack.push(name);
        if (stack.length > MAX_GPX_XML_DEPTH) {
          throw new Error("GPX XML is nested too deeply");
        }
      }
    }

    cursor = end + 1;
  }

  if (stack.length > 0 || openPointName !== null) {
    throw new Error("GPX XML tags are not balanced");
  }

  return {
    pointCount,
    rootLocalName: rootName ? localXmlName(rootName) : null,
  };
}

function xmlElements(xml: string, localName: string): XmlElement[] {
  const tag = `(?:[\\w.-]+:)?${localName}`;
  const expression = new RegExp(
    `<${tag}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tag}\\s*>)`,
    "gi"
  );

  return [...xml.matchAll(expression)].map((match) => ({
    attributes: match[1] ?? "",
    body: match[2] ?? "",
  }));
}

function xmlAttribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(
    new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? decodeXml(match[1] ?? match[2] ?? "") : null;
}

function xmlText(xml: string, localName: string): string | null {
  const element = xmlElements(xml, localName)[0];
  if (!element) return null;
  const value = decodeXml(element.body.replace(/<[^>]+>/g, "")).trim();
  return value || null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, raw: string) =>
      safeCodePoint(parseInt(raw, 16))
    )
    .replace(/&#([0-9]+);/g, (_, raw: string) =>
      safeCodePoint(parseInt(raw, 10))
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function safeCodePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    return "";
  }
  return String.fromCodePoint(value);
}

function baseName(fileName: string): string {
  const lastPart = fileName.split(/[\\/]/).pop() ?? "";
  return (
    lastPart
      .replace(/\.gpx$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Imported activity"
  );
}

function detectSource(creator: string | null, xml: string): GPXImportSource {
  const header = `${creator ?? ""} ${xml.slice(0, 4096)}`.toLowerCase();
  if (header.includes("garmin connect") || header.includes("garmin")) {
    return "garmin";
  }
  if (
    header.includes("gaia gps") ||
    header.includes("gaiagps") ||
    header.includes("gaia")
  ) {
    return "gaia";
  }
  if (header.includes("strava")) {
    return "strava";
  }
  return "gpxFile";
}

function parsePoint(
  element: XmlElement,
  segmentNumber: number
): GPXSessionPoint | null {
  const lat = Number(xmlAttribute(element.attributes, "lat"));
  const lng = Number(
    xmlAttribute(element.attributes, "lon") ??
      xmlAttribute(element.attributes, "lng")
  );
  const elevationText =
    xmlText(element.body, "ele") ?? xmlAttribute(element.attributes, "ele");
  const elevation = elevationText == null ? NaN : Number(elevationText);
  const timeText = xmlText(element.body, "time");
  const timeMilliseconds = timeText == null ? NaN : Date.parse(timeText);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(elevation) ||
    !Number.isFinite(timeMilliseconds) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    time: Math.round(timeMilliseconds / 1000),
    segment_number: segmentNumber,
    lat,
    lng,
    elevation,
  };
}

function parsePointGroups(xml: string): {
  points: GPXSessionPoint[];
  rawPointCount: number;
} {
  const trackPointCount = xmlElements(xml, "trkpt").length;
  let groups: XmlElement[][];

  if (trackPointCount > 0) {
    const segments = xmlElements(xml, "trkseg");
    groups =
      segments.length > 0
        ? segments.map((segment) => xmlElements(segment.body, "trkpt"))
        : [xmlElements(xml, "trkpt")];
  } else {
    const routes = xmlElements(xml, "rte");
    groups =
      routes.length > 0
        ? routes.map((route) => xmlElements(route.body, "rtept"))
        : [xmlElements(xml, "rtept")];
  }

  const rawPointCount = groups.reduce((sum, group) => sum + group.length, 0);
  const points: GPXSessionPoint[] = [];

  groups.forEach((group, segmentNumber) => {
    for (const element of group) {
      const point = parsePoint(element, segmentNumber);
      if (point) points.push(point);
    }
  });

  return { points, rawPointCount };
}

function medianFilter(values: number[], window: number): number[] {
  if (window <= 1 || values.length < window) return values;
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);
    const slice = values.slice(start, end).sort((left, right) => left - right);
    return slice[Math.floor(slice.length / 2)];
  });
}

function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length < window) return values;
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      total += values[cursor];
    }
    return total / (end - start);
  });
}

function elevationGain(elevations: number[]): number {
  if (elevations.length < 2) return 0;
  const despiked = medianFilter(elevations, 5);
  const smoothed = movingAverage(despiked, 7);
  let anchor = smoothed[0];
  let gain = 0;

  for (const elevation of smoothed.slice(1)) {
    const delta = elevation - anchor;
    if (Math.abs(delta) >= 3) {
      if (delta > 0) gain += delta;
      anchor = elevation;
    }
  }

  return gain;
}

function groupedPoints(points: GPXSessionPoint[]): GPXSessionPoint[][] {
  const groups = new Map<number, GPXSessionPoint[]>();
  for (const point of points) {
    const group = groups.get(point.segment_number) ?? [];
    group.push(point);
    groups.set(point.segment_number, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => group.sort((left, right) => left.time - right.time));
}

function calculateStats(points: GPXSessionPoint[]): GPXSessionStats {
  const groups = groupedPoints(points);
  let distance = 0;
  let gain = 0;
  let totalTime = 0;

  for (const group of groups) {
    gain += elevationGain(group.map((point) => point.elevation));
    if (group.length > 1) {
      totalTime += Math.max(0, group[group.length - 1].time - group[0].time);
      for (let index = 1; index < group.length; index += 1) {
        distance += haversineDistance(
          group[index - 1].lat,
          group[index - 1].lng,
          group[index].lat,
          group[index].lng
        );
      }
    }
  }

  const highest = points.reduce((best, point) =>
    point.elevation > best.elevation ? point : best
  );
  const nearHighest = points.filter(
    (point) =>
      haversineDistance(
        point.lat,
        point.lng,
        highest.lat,
        highest.lng
      ) < 20
  );
  const first = points[0];
  const last = points[points.length - 1];
  const firstNearHighest = nearHighest[0] ?? highest;
  const lastNearHighest = nearHighest[nearHighest.length - 1] ?? highest;

  return {
    distance: Math.round(distance * 10) / 10,
    gain: Math.round(gain * 10) / 10,
    totalTime,
    pace: totalTime > 0 ? distance / totalTime : null,
    highestPoint: highest.elevation,
    ascentTime: Math.max(0, firstNearHighest.time - first.time),
    descentTime: Math.max(0, last.time - lastNearHighest.time),
    stillTime: Math.max(0, lastNearHighest.time - firstNearHighest.time),
  };
}

export function parseSessionGPX(
  gpxContent: string,
  fileName: string
): ParsedGPXSession {
  const normalized = gpxContent.replace(/^\uFEFF/, "").trimStart();
  const byteLength = new TextEncoder().encode(normalized).byteLength;

  if (byteLength > MAX_GPX_SESSION_FILE_BYTES) {
    throw new Error("GPX file is larger than 8 MB");
  }
  const structure = preflightXml(normalized);
  if (structure.rootLocalName !== "gpx") {
    throw new Error("Choose a valid GPX XML file");
  }
  if (structure.pointCount === 0) {
    throw new Error("GPX file has no track or route points");
  }

  const { points: parsedPoints, rawPointCount } = parsePointGroups(normalized);
  if (parsedPoints.length > MAX_GPX_SESSION_POINTS) {
    throw new Error(
      `GPX file has more than ${MAX_GPX_SESSION_POINTS.toLocaleString()} usable points`
    );
  }

  const sortedPoints = parsedPoints.sort((left, right) => left.time - right.time);
  const seenTimes = new Set<number>();
  const points = sortedPoints.filter((point) => {
    if (seenTimes.has(point.time)) return false;
    seenTimes.add(point.time);
    return true;
  });

  if (points.length < 2) {
    throw new Error(
      "GPX file needs at least two points with coordinates, elevation, and time"
    );
  }

  const root = xmlElements(normalized, "gpx")[0];
  const creator = root ? xmlAttribute(root.attributes, "creator") : null;
  const track = xmlElements(normalized, "trk")[0];
  const route = xmlElements(normalized, "rte")[0];
  const metadata = xmlElements(normalized, "metadata")[0];
  const fallbackName = baseName(fileName);
  const name = (
    (track ? xmlText(track.body, "name") : null) ??
    (route ? xmlText(route.body, "name") : null) ??
    (metadata ? xmlText(metadata.body, "name") : null) ??
    fallbackName
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const source = detectSource(creator, normalized);
  const endTime = points[points.length - 1].time;

  return {
    name: name || fallbackName,
    creator,
    source,
    externalId: `gpx_${endTime}_${fallbackName}`,
    points,
    startTime: points[0].time,
    endTime,
    stats: calculateStats(points),
    ignoredPointCount: rawPointCount - points.length,
  };
}
