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

export interface ListProgressCounts {
  /** Full current roster size. Kept for compatibility with the old contract. */
  total: number;
  member_count: number;
  /** Effective bounded completion goal. */
  completion_target: number;
  completed: number;
  is_complete: boolean;
}

export function buildListProgress(
  memberCount: number,
  configuredTarget: unknown,
  completedCount: number
): ListProgressCounts {
  const safeMemberCount =
    Number.isSafeInteger(memberCount) && memberCount > 0 ? memberCount : 0;
  const completionTarget = effectiveListCompletionTarget(
    configuredTarget,
    safeMemberCount
  );
  const completed = Number.isSafeInteger(completedCount)
    ? Math.min(Math.max(completedCount, 0), safeMemberCount)
    : 0;

  return {
    total: safeMemberCount,
    member_count: safeMemberCount,
    completion_target: completionTarget,
    completed,
    is_complete: completionTarget > 0 && completed >= completionTarget,
  };
}
