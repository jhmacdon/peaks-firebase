import { createHash } from 'node:crypto';
import type { Coord } from './types';

const R = 6371008.8, RAD = Math.PI / 180, M = R * RAD;
export function haversine(a: Coord, b: Coord): number {
  const s = Math.sin((b[1] - a[1]) * RAD / 2) ** 2 + Math.cos(a[1] * RAD) *
    Math.cos(b[1] * RAD) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}
export function length(coords: Coord[]): number {
  let m = 0; for (let i = 1; i < coords.length; i++) m += haversine(coords[i - 1], coords[i]); return m;
}
export const interpolate = (a: Coord, b: Coord, t: number): Coord => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Same local equirectangular distance method used by route-world-geometry. */
export function pointDistance(p: Coord, a: Coord, b: Coord): number {
  const x = M * Math.cos(p[1] * RAD), ax = (a[0] - p[0]) * x, ay = (a[1] - p[1]) * M;
  const dx = (b[0] - a[0]) * x, dy = (b[1] - a[1]) * M;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
export function midpoint(coords: Coord[]): Coord {
  let remain = length(coords) / 2;
  for (let i = 1; i < coords.length; i++) { const d = haversine(coords[i - 1], coords[i]);
    if (remain <= d) return interpolate(coords[i - 1], coords[i], d ? remain / d : 0); remain -= d; }
  return coords[0];
}
export function insideRing(p: Coord, ring: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  } return inside;
}
export const insidePolygon = (p: Coord, rings: Coord[][]): boolean => !!rings.length && insideRing(p, rings[0]) && !rings.slice(1).some(r => insideRing(p, r));
export const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 20);
export const unique = <T>(items: T[]): T[] => [...new Set(items)].sort();

/** Fixed WA projection for indexing only; all threshold tests use metres at the point's latitude. */
export class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(private size = 100) {}
  private xy(p: Coord): Coord { return [p[0] * M * Math.cos(47.5 * RAD), p[1] * M]; }
  add(a: Coord, b: Coord, value: T): void {
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    for (let x = Math.floor(Math.min(ax, bx) / this.size); x <= Math.floor(Math.max(ax, bx) / this.size); x++)
      for (let y = Math.floor(Math.min(ay, by) / this.size); y <= Math.floor(Math.max(ay, by) / this.size); y++) {
        const key = `${x},${y}`, cell = this.cells.get(key); if (cell) cell.push(value); else this.cells.set(key, [value]);
      }
  }
  near(p: Coord, metres: number): T[] {
    const [px, py] = this.xy(p), found = new Set<T>(), r = metres * 1.15;
    for (let x = Math.floor((px - r) / this.size); x <= Math.floor((px + r) / this.size); x++)
      for (let y = Math.floor((py - r) / this.size); y <= Math.floor((py + r) / this.size); y++)
        for (const value of this.cells.get(`${x},${y}`) ?? []) found.add(value);
    return [...found];
  }
}
export interface Vertex { id: string; coord: Coord; segment: number; vertex: number }
export function nearest<T extends { coord: Coord }>(grid: Grid<T>, p: Coord, radius: number): { value: T; distance: number } | null {
  let best: { value: T; distance: number } | null = null;
  for (const value of grid.near(p, radius)) { const distance = haversine(p, value.coord);
    if (distance <= radius && (!best || distance < best.distance)) best = { value, distance }; }
  return best;
}
export interface Primitive { a: Coord; b: Coord; owner: number; offset_m: number }
export function lineIndex(lines: { coords: Coord[] }[]): Grid<Primitive> {
  const grid = new Grid<Primitive>();
  lines.forEach((line, owner) => { let offset = 0; for (let i = 1; i < line.coords.length; i++) {
    // Bound each primitive's grid footprint, even for a sparse source line.
    const a = line.coords[i - 1], b = line.coords[i], n = Math.max(1, Math.ceil(haversine(a, b) / 100));
    const distance = haversine(a, b);
    for (let j = 0; j < n; j++) { const edge = { a: interpolate(a, b, j / n), b: interpolate(a, b, (j + 1) / n), owner, offset_m: offset + distance * j / n }; grid.add(edge.a, edge.b, edge); }
    offset += distance;
  } }); return grid;
}
/** Midpoint quadrature at <= 10 m; samples carry length, never vertex counts. */
export function* samples(coords: Coord[], step = 10): Generator<{ point: Coord; weight: number; a: Coord; b: Coord }> {
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], distance = haversine(a, b), n = Math.max(1, Math.ceil(distance / step));
    for (let j = 0; j < n; j++) yield { point: interpolate(a, b, (j + 0.5) / n), weight: distance / n, a: interpolate(a, b, j / n), b: interpolate(a, b, (j + 1) / n) };
  }
}
