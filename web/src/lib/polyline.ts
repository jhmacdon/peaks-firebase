// Google Polyline Algorithm decoder at precision 1e6 — the format every
// stored route path uses (`routes.polyline6`).
//
// Lives here rather than inside a map component because the map explorer
// needs a route's coordinates twice over: once in the browser to draw the
// line, once in the panel to work out how far the route sits from the map
// centre.

/** Decode one signed value, or null when the string runs out or the chunk
 * count exceeds what a 32-bit value can hold — a truncated or corrupt
 * string then ends the decode instead of spinning. */
function decodeValue(
  encoded: string,
  startIndex: number
): { value: number; nextIndex: number } | null {
  let index = startIndex;
  let shift = 0;
  let result = 0;
  let byte = 0;

  do {
    if (index >= encoded.length || shift > 30) return null;
    byte = encoded.charCodeAt(index) - 63;
    if (byte < 0) return null;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index,
  };
}

export function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const decodedLatitude = decodeValue(encoded, index);
    if (!decodedLatitude) break;
    index = decodedLatitude.nextIndex;
    latitude += decodedLatitude.value;

    const decodedLongitude = decodeValue(encoded, index);
    if (!decodedLongitude) break;
    index = decodedLongitude.nextIndex;
    longitude += decodedLongitude.value;

    coordinates.push([latitude / 1e6, longitude / 1e6]);
  }

  return coordinates;
}

/** A single point that stands for the whole route — its midpoint vertex.
 * Good enough to sort a result list by distance from the map centre, and
 * far cheaper than a real centroid. Null when the path won't decode. */
export function polylineMidpoint(
  encoded: string | null | undefined
): { lat: number; lng: number } | null {
  if (!encoded) return null;
  const coordinates = decodePolyline6(encoded);
  if (coordinates.length === 0) return null;
  const [lat, lng] = coordinates[Math.floor(coordinates.length / 2)];
  return { lat, lng };
}
