export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || value === null || isFiniteNumber(value);
}
