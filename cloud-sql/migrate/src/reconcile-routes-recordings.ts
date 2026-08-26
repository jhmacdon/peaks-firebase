import type { PoolClient } from "pg";
import db from "./db";
import { firestore } from "./firebase";
import { parseRouteProvenance, RouteProvenance } from "./migrate-routes";
import {
  markerSignature,
  missingMultisetItems,
  NormalizedMarker,
  NormalizedPoint,
  normalizeMarkers,
  normalizePoints,
  stringIds,
  toDate,
} from "./firestore-sql-audit-model";

interface SourceRoute {
  id: string;
  data: Record<string, any>;
  provenance: RouteProvenance | null;
}

interface SourceSession {
  id: string;
  data: Record<string, any>;
  startTime: Date;
  endTime: Date | null;
  lastUpdated: Date;
  markers: NormalizedMarker[];
}

interface Link {
  parentId: string;
  childId: string;
  ordinal?: number;
  relation?: "reached" | "goal";
}

interface AuditState {
  routes: SourceRoute[];
  sessions: SourceSession[];
  pointsBySession: Map<string, NormalizedPoint[]>;
  missingRoutes: SourceRoute[];
  missingRouteDestinations: Link[];
  missingSessions: SourceSession[];
  missingSessionDestinations: Link[];
  missingSessionRoutes: Link[];
  missingPoints: NormalizedPoint[];
  missingMarkers: NormalizedMarker[];
  blockers: string[];
  warnings: string[];
  sourceCounts: Record<string, number>;
  targetCounts: Record<string, number>;
}

interface CliOptions {
  apply: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const allowed = new Set(["--apply", "--json"]);
  const unknown = argv.filter((arg) => !allowed.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(", ")}`);
  return { apply: argv.includes("--apply"), json: argv.includes("--json") };
}

function key(parentId: string, childId: string): string {
  return `${parentId}\u0000${childId}`;
}

function mapCompletion(value: unknown): "none" | "straight" | "reverse" {
  return value === "straight" || value === "reverse" ? value : "none";
}

function mapActivityType(value: unknown): "outdoor-trek" | "outdoor-moto" | "ski" | null {
  if (value === "outdoor-trek" || value === "hiking") return "outdoor-trek";
  if (value === "outdoor-moto") return "outdoor-moto";
  if (value === "ski" || value === "skiing") return "ski";
  return null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceMarkerSignatures(markers: NormalizedMarker[]): string[] {
  return markers.map(markerSignature);
}

async function loadAuditState(): Promise<AuditState> {
  const [routeSnapshot, sessionSnapshot, pointSnapshot] = await Promise.all([
    firestore.collection("routes").get(),
    firestore.collection("sessions").get(),
    firestore.collection("points").get(),
  ]);

  const blockers: string[] = [];
  const warnings: string[] = [];
  const pointsBySession = new Map<string, NormalizedPoint[]>();
  const deletedSessionIds = new Set<string>();
  let duplicatePointCount = 0;
  let rawPointCount = 0;

  for (const doc of pointSnapshot.docs) {
    const data = doc.data();
    const sessionId = typeof data.sessionId === "string" && data.sessionId.length > 0
      ? data.sessionId
      : doc.id;
    rawPointCount += Array.isArray(data.points) ? data.points.length : 0;
    const normalized = normalizePoints(sessionId, data.points);
    duplicatePointCount += normalized.duplicateCount;
    blockers.push(...normalized.errors);
    const existing = pointsBySession.get(sessionId) ?? [];
    const combined = [...existing, ...normalized.points];
    if (new Set(combined.map((point) => point.time)).size !== combined.length) {
      warnings.push(`${sessionId}:duplicate point times across Firestore documents`);
      const unique = new Map<number, NormalizedPoint>();
      for (const point of combined) {
        if (!unique.has(point.time)) unique.set(point.time, point);
      }
      pointsBySession.set(sessionId, Array.from(unique.values()));
    } else {
      pointsBySession.set(sessionId, combined);
    }
  }

  const routes: SourceRoute[] = [];
  for (const doc of routeSnapshot.docs) {
    const data = doc.data();
    try {
      routes.push({ id: doc.id, data, provenance: parseRouteProvenance(data.provenance) });
    } catch (error: any) {
      blockers.push(`${doc.id}:route:${error.message}`);
    }
  }

  const sessions: SourceSession[] = [];
  const allSessionIds = new Set(sessionSnapshot.docs.map((doc) => doc.id));
  for (const doc of sessionSnapshot.docs) {
    const data = doc.data();
    if (data.deleted === true) {
      deletedSessionIds.add(doc.id);
      continue;
    }
    const points = pointsBySession.get(doc.id) ?? [];
    const overview = data.overview ?? {};
    let startTime = toDate(overview.startDate);
    let endTime = toDate(overview.endDate);
    if (!startTime && points.length > 0) {
      startTime = new Date(Math.min(...points.map((point) => point.time)) * 1000);
    }
    if (!endTime && points.length > 0) {
      endTime = new Date(Math.max(...points.map((point) => point.time)) * 1000);
    }
    startTime = startTime ?? toDate(data.lastUpdated);
    const lastUpdated = toDate(data.lastUpdated) ?? endTime ?? startTime;
    if (typeof data.userId !== "string" || data.userId.length === 0) {
      blockers.push(`${doc.id}:session:missing userId`);
      continue;
    }
    if (!startTime || !lastUpdated) {
      warnings.push(`${doc.id}:session:missing startDate, point times, and lastUpdated`);
      continue;
    }
    const normalizedMarkers = normalizeMarkers(doc.id, data.markers);
    warnings.push(...normalizedMarkers.errors);
    sessions.push({
      id: doc.id,
      data,
      startTime,
      endTime,
      lastUpdated,
      markers: normalizedMarkers.markers,
    });
  }

  const routeIds = routes.map((route) => route.id);
  const sessionIds = sessions.map((session) => session.id);
  const expectedDestinationIds = Array.from(new Set([
    ...routes.flatMap((route) => stringIds(route.data.destinations)),
    ...sessions.flatMap((session) => [
      ...stringIds(session.data.destinationsReached),
      ...stringIds(session.data.destinationGoals),
    ]),
  ]));
  const expectedRouteIds = Array.from(new Set([
    ...routeIds,
    ...sessions.flatMap((session) => stringIds(session.data.routes)),
  ]));

  const [
    sqlRoutes,
    sqlSessions,
    sqlDestinations,
    sqlRouteDestinations,
    sqlSessionDestinations,
    sqlSessionRoutes,
    sqlMarkers,
    targetRouteCount,
    targetSessionCount,
    targetPointCount,
  ] = await Promise.all([
    db.query<{ id: string }>("SELECT id FROM routes WHERE id = ANY($1::text[])", [routeIds]),
    db.query<{ id: string }>("SELECT id FROM tracking_sessions WHERE id = ANY($1::text[])", [sessionIds]),
    db.query<{ id: string }>("SELECT id FROM destinations WHERE id = ANY($1::text[])", [expectedDestinationIds]),
    db.query<{ route_id: string; destination_id: string }>(
      "SELECT route_id, destination_id FROM route_destinations WHERE route_id = ANY($1::text[])",
      [routeIds]
    ),
    db.query<{ session_id: string; destination_id: string; relation: "reached" | "goal" }>(
      "SELECT session_id, destination_id, relation FROM session_destinations WHERE session_id = ANY($1::text[])",
      [sessionIds]
    ),
    db.query<{ session_id: string; route_id: string }>(
      "SELECT session_id, route_id FROM session_routes WHERE session_id = ANY($1::text[])",
      [sessionIds]
    ),
    db.query<any>(
      `SELECT session_id,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              ST_Z(location::geometry) AS elevation,
              name, image, created_by, created_at
       FROM session_markers WHERE session_id = ANY($1::text[])`,
      [sessionIds]
    ),
    db.query<{ count: number }>("SELECT count(*)::int AS count FROM routes"),
    db.query<{ count: number }>("SELECT count(*)::int AS count FROM tracking_sessions"),
    db.query<{ count: number }>("SELECT count(*)::int AS count FROM tracking_points"),
  ]);

  const sqlRouteIds = new Set(sqlRoutes.rows.map((row) => row.id));
  const sqlSessionIds = new Set(sqlSessions.rows.map((row) => row.id));
  const sqlDestinationIds = new Set(sqlDestinations.rows.map((row) => row.id));
  const availableRouteIds = new Set([...expectedRouteIds.filter((id) => sqlRouteIds.has(id)), ...routeIds]);

  const missingRoutes = routes.filter((route) => !sqlRouteIds.has(route.id));
  const missingSessions = sessions.filter((session) => !sqlSessionIds.has(session.id));

  const routeDestinationKeys = new Set(sqlRouteDestinations.rows.map(
    (row) => key(row.route_id, row.destination_id)
  ));
  const missingRouteDestinations: Link[] = [];
  for (const route of routes) {
    stringIds(route.data.destinations).forEach((destinationId, ordinal) => {
      if (!sqlDestinationIds.has(destinationId)) {
        warnings.push(`${route.id}:route destination missing in both stores:${destinationId}`);
      } else if (!routeDestinationKeys.has(key(route.id, destinationId))) {
        missingRouteDestinations.push({ parentId: route.id, childId: destinationId, ordinal });
      }
    });
  }

  const sessionDestinationRows = new Map(sqlSessionDestinations.rows.map(
    (row) => [key(row.session_id, row.destination_id), row.relation]
  ));
  const missingSessionDestinations: Link[] = [];
  const missingSessionRoutes: Link[] = [];
  const sessionRouteKeys = new Set(sqlSessionRoutes.rows.map((row) => key(row.session_id, row.route_id)));
  for (const session of sessions) {
    const reached = stringIds(session.data.destinationsReached);
    const reachedSet = new Set(reached);
    const expectedDestinations: Array<{ id: string; relation: "reached" | "goal" }> = [
      ...reached.map((id) => ({ id, relation: "reached" as const })),
      ...stringIds(session.data.destinationGoals)
        .filter((id) => !reachedSet.has(id))
        .map((id) => ({ id, relation: "goal" as const })),
    ];
    for (const expected of expectedDestinations) {
      if (!sqlDestinationIds.has(expected.id)) {
        warnings.push(`${session.id}:session destination missing in both stores:${expected.id}`);
        continue;
      }
      const existingRelation = sessionDestinationRows.get(key(session.id, expected.id));
      if (existingRelation === undefined
          || (expected.relation === "reached" && existingRelation !== "reached")) {
        missingSessionDestinations.push({
          parentId: session.id,
          childId: expected.id,
          relation: expected.relation,
        });
      }
    }
    for (const routeId of stringIds(session.data.routes)) {
      if (!availableRouteIds.has(routeId)) {
        warnings.push(`${session.id}:session route missing in both stores:${routeId}`);
      } else if (!sessionRouteKeys.has(key(session.id, routeId))) {
        missingSessionRoutes.push({ parentId: session.id, childId: routeId });
      }
    }
  }

  const targetMarkerSignatures = sqlMarkers.rows.map((row) => markerSignature({
    sessionId: row.session_id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    elevation: Number(row.elevation),
    name: row.name ?? null,
    image: row.image ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }));
  const sourceMarkers = sessions.flatMap((session) => session.markers);
  const missingMarkers = missingMultisetItems(
    sourceMarkers,
    targetMarkerSignatures,
    markerSignature
  );

  const existingTimesBySession = new Map<string, Set<number>>();
  const pointSessionIds = Array.from(pointsBySession.keys()).filter((sessionId) =>
    sessions.some((session) => session.id === sessionId)
  );
  for (let offset = 0; offset < pointSessionIds.length; offset += 100) {
    const ids = pointSessionIds.slice(offset, offset + 100);
    const existing = await db.query<{ session_id: string; time: string }>(
      `SELECT session_id, time::text
       FROM tracking_points WHERE session_id = ANY($1::text[])`,
      [ids]
    );
    for (const row of existing.rows) {
      const times = existingTimesBySession.get(row.session_id) ?? new Set<number>();
      times.add(Number(row.time));
      existingTimesBySession.set(row.session_id, times);
    }
  }

  const missingPoints: NormalizedPoint[] = [];
  for (const [sessionId, points] of pointsBySession) {
    if (deletedSessionIds.has(sessionId)) continue;
    if (!allSessionIds.has(sessionId)) {
      warnings.push(`${sessionId}:orphan Firestore point document has no session`);
      continue;
    }
    if (!sessions.some((session) => session.id === sessionId)) continue;
    const existingTimes = existingTimesBySession.get(sessionId) ?? new Set<number>();
    missingPoints.push(...points.filter((point) => !existingTimes.has(point.time)));
  }

  if (deletedSessionIds.size > 0) {
    const deletedInSql = await db.query<{ id: string }>(
      "SELECT id FROM tracking_sessions WHERE id = ANY($1::text[])",
      [Array.from(deletedSessionIds)]
    );
    if (deletedInSql.rows.length > 0) {
      warnings.push(`${deletedInSql.rows.length} deleted Firestore sessions still exist in SQL`);
    }
  }

  return {
    routes,
    sessions,
    pointsBySession,
    missingRoutes,
    missingRouteDestinations,
    missingSessions,
    missingSessionDestinations,
    missingSessionRoutes,
    missingPoints,
    missingMarkers,
    blockers: Array.from(new Set(blockers)).sort(),
    warnings,
    sourceCounts: {
      routes: routes.length,
      active_sessions: sessions.length,
      deleted_sessions: deletedSessionIds.size,
      point_documents: pointSnapshot.size,
      raw_points: rawPointCount,
      points: Array.from(pointsBySession.values()).reduce((sum, points) => sum + points.length, 0),
      duplicate_points_omitted: duplicatePointCount,
      route_destination_links: routes.reduce(
        (sum, route) => sum + stringIds(route.data.destinations).length,
        0
      ),
      session_destination_links: sessions.reduce((sum, session) => {
        const reached = stringIds(session.data.destinationsReached);
        const goals = stringIds(session.data.destinationGoals).filter((id) => !reached.includes(id));
        return sum + reached.length + goals.length;
      }, 0),
      session_route_links: sessions.reduce(
        (sum, session) => sum + stringIds(session.data.routes).length,
        0
      ),
      markers: sourceMarkerSignatures(sourceMarkers).length,
    },
    targetCounts: {
      routes: targetRouteCount.rows[0].count,
      sessions: targetSessionCount.rows[0].count,
      points: targetPointCount.rows[0].count,
    },
  };
}

function gaps(state: AuditState): Record<string, number> {
  return {
    routes: state.missingRoutes.length,
    route_destination_links: state.missingRouteDestinations.length,
    sessions: state.missingSessions.length,
    session_destination_links: state.missingSessionDestinations.length,
    session_route_links: state.missingSessionRoutes.length,
    points: state.missingPoints.length,
    markers: state.missingMarkers.length,
  };
}

function hasGaps(state: AuditState): boolean {
  return Object.values(gaps(state)).some((count) => count > 0);
}

function unresolvedCounts(warnings: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const warning of warnings) {
    const category = warning.includes(":session route missing in both stores:")
      ? "missing_route_dependencies"
      : warning.includes(":session destination missing in both stores:")
        || warning.includes(":route destination missing in both stores:")
        ? "missing_destination_dependencies"
        : warning.includes(":orphan Firestore point document")
          ? "orphan_point_documents"
          : warning.includes(":session:missing startDate")
            ? "sessions_without_a_start_time"
            : warning.includes(":marker:")
              ? "invalid_markers"
              : warning.includes("duplicate point times across")
                ? "cross_document_duplicate_point_sets"
                : warning.includes("deleted Firestore sessions")
                  ? "deleted_sessions_still_in_sql"
                  : "other";
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function printable(state: AuditState): Record<string, unknown> {
  return {
    source_counts: state.sourceCounts,
    target_counts: state.targetCounts,
    missing: gaps(state),
    blocker_count: state.blockers.length,
    blockers: state.blockers.slice(0, 20),
    unresolved_count: state.warnings.length,
    unresolved_counts: unresolvedCounts(state.warnings),
    unresolved: state.warnings.slice(0, 20),
    samples: {
      routes: state.missingRoutes.slice(0, 20).map((route) => route.id),
      sessions: state.missingSessions.slice(0, 20).map((session) => session.id),
      point_sessions: Array.from(new Set(state.missingPoints.map((point) => point.sessionId))).slice(0, 20),
    },
  };
}

function printState(state: AuditState, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(printable(state), null, 2));
    return;
  }
  console.log("Firestore → Cloud SQL route and recording audit");
  console.log(`Source: ${state.sourceCounts.routes} routes, ${state.sourceCounts.active_sessions} active recordings, ${state.sourceCounts.points} points`);
  console.log(`Target: ${state.targetCounts.routes} routes, ${state.targetCounts.sessions} recordings, ${state.targetCounts.points} points`);
  console.log(`Missing: ${JSON.stringify(gaps(state))}`);
  console.log(`Blockers: ${state.blockers.length}; warnings: ${state.warnings.length}`);
  for (const blocker of state.blockers.slice(0, 20)) console.log(`  BLOCKER ${blocker}`);
  for (const warning of state.warnings.slice(0, 20)) console.log(`  WARNING ${warning}`);
}

async function insertRoute(client: PoolClient, route: SourceRoute): Promise<void> {
  const data = route.data;
  const stats = data.stats ?? {};
  const externalLinks: Array<{ type: string; id: string }> = [];
  if (typeof data.ext?.wta === "string") externalLinks.push({ type: "wta", id: data.ext.wta });
  if (typeof data.ext?.usfs === "string") externalLinks.push({ type: "usfs", id: data.ext.usfs });
  await client.query(
    `INSERT INTO routes (
       id, name, path, polyline6, geohashes, owner, distance, gain, gain_loss,
       elevation_string, external_links, provenance, completion
     ) VALUES (
       $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::completion_mode
     ) ON CONFLICT (id) DO NOTHING`,
    [
      route.id,
      typeof data.name === "string" ? data.name : null,
      typeof data.polyline6 === "string" ? data.polyline6 : null,
      stringIds(data.geohashes),
      typeof data.owner === "string" ? data.owner : "peaks",
      numeric(stats.distance),
      numeric(stats.gain),
      numeric(stats.gainLoss),
      typeof data.elevationString === "string" ? data.elevationString : null,
      externalLinks.length > 0 ? JSON.stringify(externalLinks) : null,
      route.provenance ? JSON.stringify(route.provenance) : null,
      mapCompletion(data.completion),
    ]
  );
}

async function insertSession(client: PoolClient, session: SourceSession): Promise<void> {
  const data = session.data;
  const overview = data.overview ?? {};
  const status = data.status ?? {};
  const hasDerivedLinks = stringIds(data.destinationsReached).length > 0
    || stringIds(data.destinationGoals).length > 0
    || stringIds(data.routes).length > 0;
  const processingState = hasDerivedLinks ? "completed" : status.ended === true ? "pending" : "idle";
  await client.query(
    `INSERT INTO tracking_sessions (
       id, user_id, name, start_time, end_time, distance, total_time, pace, gain,
       highest_point, ascent_time, descent_time, still_time, activity_type,
       source, external_id, health_data, ended, is_public, processed_at,
       processing_state, created_at, updated_at, server_updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14::activity_type, $15, $16, $17::jsonb, $18, $19, $20, $21, $22, $23, $24
     ) ON CONFLICT (id) DO NOTHING`,
    [
      session.id,
      data.userId,
      typeof data.name === "string" ? data.name : null,
      session.startTime,
      session.endTime,
      numeric(overview.distance),
      numeric(overview.totalTime),
      numeric(overview.pace),
      numeric(overview.gain),
      numeric(overview.highPoint),
      numeric(overview.ascentTime),
      numeric(overview.descentTime),
      numeric(overview.stillTimeTotal),
      mapActivityType(data.activityType),
      typeof data.source === "string" ? data.source : null,
      typeof data.externalId === "string" ? data.externalId : null,
      data.healthData ? JSON.stringify(data.healthData) : null,
      status.ended === true,
      status.public === true,
      processingState === "completed" ? session.lastUpdated : null,
      processingState,
      session.startTime,
      session.lastUpdated,
      session.lastUpdated,
    ]
  );
}

async function insertPoints(client: PoolClient, points: NormalizedPoint[]): Promise<void> {
  const chunkSize = 500;
  for (let offset = 0; offset < points.length; offset += chunkSize) {
    const chunk = points.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk.map((point, index) => {
      const base = index * 12;
      values.push(
        point.sessionId, point.time, point.segmentNumber,
        point.lng, point.lat, point.elevation, point.elevation,
        point.speed, point.azimuth, point.hdop, point.speedAccuracy, point.geohash
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, `
        + `ST_MakePoint($${base + 4}, $${base + 5}, $${base + 6})::geography, `
        + `$${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
    });
    await client.query(
      `INSERT INTO tracking_points (
         session_id, time, segment_number, location, elevation, speed,
         azimuth, hdop, speed_accuracy, geohash
       ) VALUES ${placeholders.join(", ")}
       ON CONFLICT (session_id, time) DO NOTHING`,
      values
    );
  }
}

async function applyRepair(state: AuditState): Promise<void> {
  if (state.blockers.length > 0) {
    throw new Error(`Refusing apply with ${state.blockers.length} blocker(s)`);
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const route of state.missingRoutes) await insertRoute(client, route);
    for (const link of state.missingRouteDestinations) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, $3)
         ON CONFLICT (route_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
        [link.parentId, link.childId, link.ordinal ?? 0]
      );
    }
    for (const session of state.missingSessions) await insertSession(client, session);
    for (const link of state.missingSessionDestinations) {
      await client.query(
        `INSERT INTO session_destinations (session_id, destination_id, relation, source)
         VALUES ($1, $2, $3::session_destination_relation, 'manual')
         ON CONFLICT (session_id, destination_id) DO UPDATE
         SET relation = EXCLUDED.relation, source = 'manual'`,
        [link.parentId, link.childId, link.relation]
      );
    }
    for (const link of state.missingSessionRoutes) {
      await client.query(
        `INSERT INTO session_routes (session_id, route_id, source)
         VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING`,
        [link.parentId, link.childId]
      );
    }
    await insertPoints(client, state.missingPoints);
    for (const marker of state.missingMarkers) {
      await client.query(
        `INSERT INTO session_markers (
           session_id, location, name, image, created_by, created_at
         ) VALUES (
           $1, ST_MakePoint($2, $3, $4)::geography, $5, $6, $7, $8
         )`,
        [
          marker.sessionId, marker.lng, marker.lat, marker.elevation,
          marker.name, marker.image, marker.createdBy, marker.createdAt,
        ]
      );
    }
    const sessionsWithNewPoints = Array.from(new Set(
      state.missingPoints.map((point) => point.sessionId)
    ));
    if (sessionsWithNewPoints.length > 0) {
      await client.query(
        `UPDATE tracking_sessions
         SET processing_state = CASE WHEN ended THEN 'pending' ELSE processing_state END,
             server_updated_at = now()
         WHERE id = ANY($1::text[])`,
        [sessionsWithNewPoints]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const before = await loadAuditState();
  printState(before, options.json);
  if (!options.apply) return;
  if (!hasGaps(before)) {
    console.log("No missing route or recording data to apply.");
    return;
  }
  await applyRepair(before);
  const after = await loadAuditState();
  console.log("Post-apply audit:");
  printState(after, options.json);
  if (after.blockers.length > 0 || hasGaps(after)) {
    throw new Error("Post-apply audit still has blockers or missing rows");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
