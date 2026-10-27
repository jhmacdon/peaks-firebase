/** The repair may update derived fields, but must preserve user edits, goals,
 * and route bindings. The same fingerprint gates the processing claim.
 */
export function planSourceFingerprintSql(alias = "p"): string {
  return `md5(jsonb_build_array(${alias}.user_id,${alias}.updated_at,
    (SELECT jsonb_agg(jsonb_build_array(pd.destination_id,pd.ordinal) ORDER BY pd.ordinal,pd.destination_id)
      FROM plan_destinations pd WHERE pd.plan_id=${alias}.id),
    (SELECT jsonb_agg(jsonb_build_array(pr.route_id,pr.ordinal,r.updated_at,r.status,
       md5(ST_AsEWKB(r.path::geometry))) ORDER BY pr.ordinal,pr.route_id)
      FROM plan_routes pr LEFT JOIN routes r ON r.id=pr.route_id WHERE pr.plan_id=${alias}.id)
  )::text)`;
}

export function buildPlanRepairSnapshotQuery(uid: string, ids?: string[]) {
  return {
    text:`SELECT p.id,${planSourceFingerprintSql()} AS fingerprint,
      p.processing_state,p.processed_at,p.path IS NOT NULL AS has_path,
      NOT EXISTS(SELECT 1 FROM plan_routes pr LEFT JOIN routes r ON r.id=pr.route_id
        WHERE pr.plan_id=p.id AND (r.id IS NULL OR r.path IS NULL OR r.status NOT IN ('active','superseded')
          OR NOT(r.owner='peaks' OR r.owner=p.user_id))) AS geometry_complete,
      to_jsonb(p)-ARRAY['path','distance','gain','processed_at','processing_state','processing_error',
        'processing_started_at','server_updated_at'] AS protected,
      COALESCE((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.ordinal,pd.destination_id)
        FROM plan_destinations pd WHERE pd.plan_id=p.id),'[]'::jsonb) AS goals,
      COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.ordinal,pr.route_id)
        FROM plan_routes pr WHERE pr.plan_id=p.id),'[]'::jsonb) AS routes
      ,COALESCE((SELECT jsonb_agg(to_jsonb(prd) ORDER BY prd.destination_id)
        FROM plan_reached_destinations prd WHERE prd.plan_id=p.id AND prd.source<>'auto'),'[]'::jsonb) AS manual
      FROM plans p WHERE p.user_id=$1 AND ${ids ? "p.id=ANY($2::text[])" : "p.processed_at IS NULL"}
        AND EXISTS(SELECT 1 FROM plan_routes pr WHERE pr.plan_id=p.id)
      ORDER BY p.id`,
    values:ids?[uid,ids]:[uid],
  };
}
