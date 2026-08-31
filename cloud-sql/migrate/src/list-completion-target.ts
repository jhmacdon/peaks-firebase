/**
 * Convert an imported completion target to the nullable value stored on a
 * list. NULL means every current member is required. Bad values also become
 * NULL, which is the stricter rule and matches the database read helper.
 */
export function normalizeStoredListCompletionTarget(
  value: unknown,
  memberCount: number
): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(memberCount) || memberCount < 1) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < 1 || value > memberCount) return null;
  return value;
}

/** Prefer the Firestore field spelling used by clients, including an explicit
 * NULL, while still accepting the SQL-style spelling in repair exports. */
export function readImportedListCompletionTarget(
  value: Record<string, unknown>
): unknown {
  return Object.prototype.hasOwnProperty.call(value, "completionTarget")
    ? value.completionTarget
    : value.completion_target;
}
