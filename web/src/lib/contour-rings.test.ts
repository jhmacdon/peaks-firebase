import assert from "node:assert/strict";
import test from "node:test";

import { generateContourField, pathCoordinates } from "./contour-rings";

const SEED = 20260819;

function bounds(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const numbers = pathCoordinates(d);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

type Vertex = [number, number];

/** The points the curve actually passes through: the "M" point plus each
 * cubic's endpoint. The final cubic lands back on the start, so that repeat
 * is dropped. */
function vertices(d: string): Vertex[] {
  const numbers = pathCoordinates(d);
  const points: Vertex[] = [[numbers[0], numbers[1]]];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    points.push([numbers[i + 4], numbers[i + 5]]);
  }
  points.pop();
  return points;
}

/** Ray casting — true when the point is inside the closed polygon. */
function isInside([x, y]: Vertex, polygon: Vertex[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

test("the same seed always produces the same field", () => {
  const first = generateContourField({ seed: SEED });
  const second = generateContourField({ seed: SEED });

  assert.deepEqual(first, second);
});

test("a different seed produces a different field", () => {
  const first = generateContourField({ seed: SEED });
  const second = generateContourField({ seed: SEED + 1 });

  assert.notEqual(first.rings[0].d, second.rings[0].d);
});

test("every ring is one closed, finite path", () => {
  const field = generateContourField({ seed: SEED, ringCount: 9 });

  assert.equal(field.rings.length, 9);
  for (const ring of field.rings) {
    assert.match(ring.d, /^M /);
    assert.match(ring.d, / Z$/);
    assert.equal(ring.d.includes("NaN"), false);
    assert.ok(ring.length > 0);
    for (const value of pathCoordinates(ring.d)) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test("rings nest without crossing and stay inside the viewBox", () => {
  const field = generateContourField({ seed: SEED });
  const boxes = field.rings.map((ring) => bounds(ring.d));

  for (const box of boxes) {
    assert.ok(box.minX >= 0, `minX ${box.minX} left the viewBox`);
    assert.ok(box.minY >= 0, `minY ${box.minY} left the viewBox`);
    assert.ok(box.maxX <= field.size, `maxX ${box.maxX} left the viewBox`);
    assert.ok(box.maxY <= field.size, `maxY ${box.maxY} left the viewBox`);
  }

  // Each ring fully contains the one inside it — contour lines that cross
  // read as a mistake, not as terrain.
  const polygons = field.rings.map((ring) => vertices(ring.d));
  for (let i = 1; i < polygons.length; i++) {
    for (const point of polygons[i - 1]) {
      assert.ok(
        isInside(point, polygons[i]),
        `ring ${i - 1} escapes ring ${i} at ${point.join(",")}`
      );
    }
  }
});

test("a degenerate request yields no rings rather than broken paths", () => {
  assert.deepEqual(generateContourField({ seed: SEED, ringCount: 0 }).rings, []);
  assert.deepEqual(generateContourField({ seed: SEED, samples: 2 }).rings, []);
});
