export function sourceCheckerArgs(
  scriptPath: string,
  routeId: string,
  replacementRouteId: string | null
): string[] {
  const args = [
    scriptPath,
    "--route-id",
    routeId,
    "--format",
    "json",
  ];
  if (replacementRouteId) {
    args.push("--replace-active-route", replacementRouteId);
  }
  return args;
}
