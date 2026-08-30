export type WorldPosition = [number, number];

export type WorldPoint = {
  lat: number;
  lng: number;
};

export type WorldTilePosition = {
  x: number;
  y: number;
};

export type WorldTilePixel = {
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
};

export type BoundedRouteWorldTiles = {
  positions: WorldTilePosition[];
  tileCount: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  totalTiles: number;
};

export type BoundedRouteWorldTileOptions = {
  maxTiles: number;
  paddingTiles?: number;
};

export type LongitudeBounds = {
  west: number;
  east: number;
};

const EARTH_RADIUS_M = 6_371_000;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function normalizeLongitudeDelta(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const result = ((value + 180) % 360 + 360) % 360 - 180;
  return result === -180 && value > 0 ? 180 : result;
}

export function wrapLongitude(value: number): number {
  const wrapped = ((value + 540) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function interpolateWorldPosition(
  start: WorldPosition,
  end: WorldPosition,
  fraction: number
): WorldPosition {
  return [
    wrapLongitude(
      start[0] + normalizeLongitudeDelta(end[0] - start[0]) * fraction
    ),
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

export function projectPointToSegmentMeters(
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint
): { distanceM: number; fraction: number } {
  const referenceLat = (point.lat + start.lat + end.lat) / 3;
  const latScale = Math.PI / 180 * EARTH_RADIUS_M;
  const lngScale = latScale * Math.cos(radians(referenceLat));
  const pointX = normalizeLongitudeDelta(point.lng - start.lng) * lngScale;
  const pointY = (point.lat - start.lat) * latScale;
  const endX = normalizeLongitudeDelta(end.lng - start.lng) * lngScale;
  const endY = (end.lat - start.lat) * latScale;
  const lengthSquared = endX * endX + endY * endY;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (pointX * endX + pointY * endY) / lengthSquared)
        );
  return {
    distanceM: Math.hypot(
      pointX - fraction * endX,
      pointY - fraction * endY
    ),
    fraction,
  };
}

export function pointToSegmentMeters(
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint
): number {
  return projectPointToSegmentMeters(point, start, end).distanceM;
}

function clampLatitude(latitude: number): number {
  return Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude)
  );
}

export function worldTilePosition(
  position: WorldPosition,
  zoom: number
): WorldTilePosition {
  const scale = 2 ** zoom;
  const latRadians = radians(clampLatitude(position[1]));
  return {
    x: ((wrapLongitude(position[0]) + 180) / 360) * scale,
    y:
      ((1 -
        Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) /
          Math.PI) /
        2) *
      scale,
  };
}

export function unwrapWorldTilePositions(
  positions: readonly WorldTilePosition[],
  zoom: number
): WorldTilePosition[] {
  if (positions.length === 0) return [];
  const scale = 2 ** zoom;
  const output = [{ ...positions[0] }];
  let priorWrappedX = positions[0].x;
  for (let index = 1; index < positions.length; index += 1) {
    const position = positions[index];
    const priorUnwrapped = output[output.length - 1];
    let delta = position.x - priorWrappedX;
    if (delta > scale / 2) delta -= scale;
    if (delta < -scale / 2) delta += scale;
    output.push({ x: priorUnwrapped.x + delta, y: position.y });
    priorWrappedX = position.x;
  }
  return output;
}

export function routeWorldTilePositions(
  coordinates: readonly WorldPosition[],
  zoom: number
): WorldTilePosition[] {
  return unwrapWorldTilePositions(
    coordinates.map((position) => worldTilePosition(position, zoom)),
    zoom
  );
}

export function boundedRouteWorldTiles(
  coordinates: readonly WorldPosition[],
  zoom: number,
  options: BoundedRouteWorldTileOptions
): BoundedRouteWorldTiles {
  if (coordinates.length === 0) {
    throw new Error("route tile bounds require at least one coordinate");
  }
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 30) {
    throw new Error("route tile zoom must be an integer from 0 through 30");
  }
  if (!Number.isSafeInteger(options.maxTiles) || options.maxTiles < 1) {
    throw new Error("route tile maxTiles must be a positive safe integer");
  }
  const paddingTiles = options.paddingTiles ?? 0;
  if (!Number.isSafeInteger(paddingTiles) || paddingTiles < 0) {
    throw new Error("route tile padding must be a non-negative safe integer");
  }
  for (const [index, position] of coordinates.entries()) {
    if (
      !Array.isArray(position) ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      position[0] < -180 ||
      position[0] > 180 ||
      position[1] < -90 ||
      position[1] > 90
    ) {
      throw new Error(`route coordinate ${index + 1} is outside WGS84 bounds`);
    }
  }

  const positions = routeWorldTilePositions(coordinates, zoom);
  const tileCount = 2 ** zoom;
  let rawMinX = Number.POSITIVE_INFINITY;
  let rawMaxX = Number.NEGATIVE_INFINITY;
  let rawMinY = Number.POSITIVE_INFINITY;
  let rawMaxY = Number.NEGATIVE_INFINITY;
  for (const position of positions) {
    rawMinX = Math.min(rawMinX, position.x);
    rawMaxX = Math.max(rawMaxX, position.x);
    rawMinY = Math.min(rawMinY, position.y);
    rawMaxY = Math.max(rawMaxY, position.y);
  }
  const minX = Math.floor(rawMinX) - paddingTiles;
  const maxX = Math.floor(rawMaxX) + paddingTiles;
  const minY = Math.max(
    0,
    Math.floor(rawMinY) - paddingTiles
  );
  const maxY = Math.min(
    tileCount - 1,
    Math.floor(rawMaxY) + paddingTiles
  );
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > Math.floor(options.maxTiles / height)
  ) {
    throw new Error(
      `route tile bounds exceed the ${options.maxTiles}-tile limit`
    );
  }
  return {
    positions,
    tileCount,
    minX,
    maxX,
    minY,
    maxY,
    totalTiles: width * height,
  };
}

export function wrappedTileX(value: number, zoom: number): number {
  const scale = 2 ** zoom;
  return ((value % scale) + scale) % scale;
}

export function worldTilePixel(
  position: WorldPosition,
  zoom: number,
  tileSize: number
): WorldTilePixel {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 30) {
    throw new Error("world tile pixel zoom must be an integer from 0 through 30");
  }
  if (!Number.isSafeInteger(tileSize) || tileSize < 1) {
    throw new Error("world tile pixel size must be a positive safe integer");
  }
  if (
    !Number.isFinite(position[0]) ||
    !Number.isFinite(position[1]) ||
    position[0] < -180 ||
    position[0] > 180 ||
    position[1] < -90 ||
    position[1] > 90
  ) {
    throw new Error("world tile pixel position is outside WGS84 bounds");
  }
  const scale = 2 ** zoom;
  const projected = worldTilePosition(position, zoom);
  const unwrappedX = Math.floor(projected.x);
  const unboundedY = Math.floor(projected.y);
  return {
    x: wrappedTileX(unwrappedX, zoom),
    y: Math.max(0, Math.min(scale - 1, unboundedY)),
    pixelX: Math.max(
      0,
      Math.min(
        tileSize - 1,
        Math.floor((projected.x - unwrappedX) * tileSize)
      )
    ),
    pixelY:
      unboundedY < 0
        ? 0
        : unboundedY >= scale
          ? tileSize - 1
          : Math.max(
              0,
              Math.min(
                tileSize - 1,
                Math.floor((projected.y - unboundedY) * tileSize)
              )
            ),
  };
}

export function wrappedLongitudeCorridor(
  firstLongitude: number,
  secondLongitude: number,
  paddingDegrees: number
): LongitudeBounds[] {
  if (
    !Number.isFinite(firstLongitude) ||
    !Number.isFinite(secondLongitude) ||
    !Number.isFinite(paddingDegrees) ||
    paddingDegrees < 0
  ) {
    throw new Error("longitude corridor inputs must be finite and non-negative");
  }
  const canonicalFirst = wrapLongitude(firstLongitude);
  const unwrappedSecond =
    canonicalFirst + normalizeLongitudeDelta(secondLongitude - firstLongitude);
  let west = Math.min(canonicalFirst, unwrappedSecond) - paddingDegrees;
  let east = Math.max(canonicalFirst, unwrappedSecond) + paddingDegrees;
  if (east - west >= 360) return [{ west: -180, east: 180 }];
  while (west < -180) {
    west += 360;
    east += 360;
  }
  while (west >= 180) {
    west -= 360;
    east -= 360;
  }
  if (east <= 180) return [{ west, east }];
  return [
    { west, east: 180 },
    { west: -180, east: east - 360 },
  ];
}

export default {
  boundedRouteWorldTiles,
  interpolateWorldPosition,
  normalizeLongitudeDelta,
  pointToSegmentMeters,
  projectPointToSegmentMeters,
  routeWorldTilePositions,
  unwrapWorldTilePositions,
  worldTilePosition,
  worldTilePixel,
  wrapLongitude,
  wrappedLongitudeCorridor,
  wrappedTileX,
};
