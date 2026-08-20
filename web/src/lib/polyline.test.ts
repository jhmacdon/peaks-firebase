import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodePolyline6, polylineMidpoint } from "./polyline";

/** Encode at precision 1e6, mirroring what the route pipeline writes. */
function encodePolyline6(points: [number, number][]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";

  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };

  for (const [lat, lng] of points) {
    const latE6 = Math.round(lat * 1e6);
    const lngE6 = Math.round(lng * 1e6);
    chunk(latE6 - lastLat);
    chunk(lngE6 - lastLng);
    lastLat = latE6;
    lastLng = lngE6;
  }

  return out;
}

test("a path round-trips through the decoder", () => {
  const points: [number, number][] = [
    [46.8523, -121.7603],
    [46.8531, -121.7588],
    [46.855, -121.752],
  ];
  const decoded = decodePolyline6(encodePolyline6(points));
  assert.equal(decoded.length, points.length);
  decoded.forEach(([lat, lng], i) => {
    assert.ok(Math.abs(lat - points[i][0]) < 1e-6);
    assert.ok(Math.abs(lng - points[i][1]) < 1e-6);
  });
});

test("a truncated string stops rather than spinning", () => {
  const encoded = encodePolyline6([
    [46.8523, -121.7603],
    [46.8531, -121.7588],
  ]);
  const decoded = decodePolyline6(encoded.slice(0, encoded.length - 2));
  assert.ok(decoded.length < 2);
});

test("an empty string decodes to nothing", () => {
  assert.deepEqual(decodePolyline6(""), []);
  assert.equal(polylineMidpoint(""), null);
  assert.equal(polylineMidpoint(null), null);
});

test("the midpoint is a vertex from the middle of the path", () => {
  const points: [number, number][] = [
    [46.0, -121.0],
    [46.5, -121.5],
    [47.0, -122.0],
  ];
  const mid = polylineMidpoint(encodePolyline6(points));
  assert.ok(mid);
  assert.ok(Math.abs(mid.lat - 46.5) < 1e-6);
  assert.ok(Math.abs(mid.lng - -121.5) < 1e-6);
});
