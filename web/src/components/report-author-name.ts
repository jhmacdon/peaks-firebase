function cleanPart(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function formatReportAuthorName(value: unknown): string | null {
  const plainName = cleanPart(value);
  if (plainName) return plainName;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const structured = value as Record<string, unknown>;
  const displayName = cleanPart(structured.displayName);
  if (displayName) return displayName;

  const parts = [cleanPart(structured.first), cleanPart(structured.last)].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" ") : null;
}
