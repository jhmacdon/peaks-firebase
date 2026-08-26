-- Read-only audit for legacy route joins that violate the catalog-or-parent-
-- owner rule. Runtime reads now omit these rows; review this output before any
-- separate cleanup is approved.

SELECT 'plan_routes' AS link_table,
       pr.plan_id AS parent_id,
       p.user_id AS parent_owner,
       pr.route_id,
       r.owner AS route_owner
FROM plan_routes pr
JOIN plans p ON p.id = pr.plan_id
JOIN routes r ON r.id = pr.route_id
WHERE r.owner IS DISTINCT FROM 'peaks'
  AND r.owner IS DISTINCT FROM p.user_id
ORDER BY pr.plan_id, pr.route_id;

SELECT 'session_routes' AS link_table,
       sr.session_id AS parent_id,
       ts.user_id AS parent_owner,
       sr.route_id,
       r.owner AS route_owner
FROM session_routes sr
JOIN tracking_sessions ts ON ts.id = sr.session_id
JOIN routes r ON r.id = sr.route_id
WHERE r.owner IS DISTINCT FROM 'peaks'
  AND r.owner IS DISTINCT FROM ts.user_id
ORDER BY sr.session_id, sr.route_id;
