"use server";

import db from "../db";
import {
  buildPublicPlanBundleQuery,
  mapPublicPlanBundleRow,
  type PublicPlan,
  type PublicPlanBundle,
} from "../public-plan";

export type { PublicPlan, PublicPlanBundle };

function assertPlanId(planId: string): void {
  if (typeof planId !== "string" || planId.length === 0 || planId.length > 1_500) {
    throw new Error("Invalid route");
  }
}

/**
 * Load an anonymous saved-route page from Cloud SQL. The query only returns a
 * row while the owner has made it public, and it never selects owner, party,
 * photo, processing, or other private fields.
 */
export async function getPublicPlanBundle(
  planId: string
): Promise<PublicPlanBundle | null> {
  assertPlanId(planId);
  const query = buildPublicPlanBundleQuery(planId);
  try {
    const result = await db.query(query.text, query.values);
    if (result.rows.length === 0) return null;
    return mapPublicPlanBundleRow(result.rows[0]);
  } catch (error) {
    console.error(`getPublicPlanBundle(${planId}) failed`, error);
    return null;
  }
}
