/** User-owned catalog rows stay hidden from signed-out callers. */
export function publicCatalogSql(alias: string, publicOnly = false): string {
  return publicOnly ? `${alias}.owner = 'peaks'` : "TRUE";
}

/** PAD-US's owner names a land agency, not a Firebase user. */
export function publicAreaSql(alias: string, publicOnly = false): string {
  return publicOnly ? `(${alias}.source = 'padus' OR ${alias}.owner = 'peaks')` : "TRUE";
}

/** Hide a private parent's ID as well as its fields in nested area summaries. */
export function publicAreaParentSql(alias: string, publicOnly = false): string {
  if (!publicOnly) return `${alias}.parent_area_id`;
  return `(SELECT catalog_parent.id FROM areas catalog_parent
    WHERE catalog_parent.id = ${alias}.parent_area_id
      AND ${publicAreaSql("catalog_parent", true)})`;
}
