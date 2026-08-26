import type { AreaDestination } from "./actions/areas";

export type AreaDestinationSort = "prominence" | "elevation" | "name";

export function sortAreaDestinations(
  destinations: AreaDestination[],
  sort: AreaDestinationSort
): AreaDestination[] {
  return [...destinations].sort((left, right) => {
    if (sort === "name") return destinationName(left).localeCompare(destinationName(right));

    const leftValue = sort === "prominence" ? left.prominence : left.elevation;
    const rightValue = sort === "prominence" ? right.prominence : right.elevation;
    const valueOrder = descendingNullable(leftValue, rightValue);
    return valueOrder || destinationName(left).localeCompare(destinationName(right));
  });
}

function destinationName(destination: AreaDestination): string {
  return destination.name?.trim() || "Unnamed";
}

function descendingNullable(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}
