declare module "polyclip-ts" {
  export function union(geometry: number[][][][], ...more: number[][][][][]): number[][][][];
  export function difference(geometry: number[][][][], ...more: number[][][][][]): number[][][][];
}
