/**
 * Keep list progress strict when a stale or malformed target reaches the UI.
 * A bad target requires the whole current roster, matching the database rule.
 */
export function effectiveListCompletionTarget(
  configuredTarget: unknown,
  memberCount: number
): number {
  const safeMemberCount =
    Number.isSafeInteger(memberCount) && memberCount > 0 ? memberCount : 0;
  if (
    typeof configuredTarget === "number" &&
    Number.isSafeInteger(configuredTarget) &&
    configuredTarget >= 1 &&
    configuredTarget <= safeMemberCount
  ) {
    return configuredTarget;
  }
  return safeMemberCount;
}
