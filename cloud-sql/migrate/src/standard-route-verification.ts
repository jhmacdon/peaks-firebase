type Queryable = {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
};

export interface StandardRouteVerification {
  verdict: "PASS" | "FAIL";
  checked_at: string;
  route_id: string;
  destination_id: string;
  trailhead_id: string;
  route_name: string | null;
  public_url: string;
  public_status: number;
  gates: {
    owner: boolean;
    active: boolean;
    destination_order: boolean;
    segments: boolean;
    provenance: boolean;
    public_http: boolean;
  };
  errors: string[];
}

type RouteRow = {
  id: string;
  name: string;
  owner: string;
  status: string;
  provenance_valid: boolean;
  point_count: number;
  segment_count: number;
  matching_segment_count: number;
  destination_ids: string[];
  destination_features: string[][];
};

export const DEFAULT_PEAKS_PUBLIC_WEB_URL =
  "https://peaks-firebase--donner-a8608.us-central1.hosted.app";

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function verifyStandardRoute(
  queryable: Queryable,
  input: {
    routeId: string;
    destinationId: string;
    trailheadId: string;
    publicBaseUrl?: string;
  }
): Promise<StandardRouteVerification> {
  const result = await queryable.query<RouteRow>(
    `SELECT r.id,
            r.name,
            r.owner,
            r.status,
            is_valid_route_provenance(r.provenance) AS provenance_valid,
            ST_NPoints(r.path::geometry)::int AS point_count,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND s.path IS NOT NULL
            ) AS segment_count,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND s.path IS NOT NULL
                AND s.provenance IS NOT DISTINCT FROM r.provenance
            ) AS matching_segment_count,
            (
              SELECT ARRAY_AGG(rd.destination_id ORDER BY rd.ordinal)
              FROM route_destinations rd
              WHERE rd.route_id = r.id
            ) AS destination_ids,
            (
              SELECT ARRAY_AGG(d.features::text[] ORDER BY rd.ordinal)
              FROM route_destinations rd
              JOIN destinations d ON d.id = rd.destination_id
              WHERE rd.route_id = r.id
            ) AS destination_features
     FROM routes r
     WHERE r.id = $1`,
    [input.routeId]
  );
  const route = result.rows[0];
  const destinationIds = route?.destination_ids ?? [];
  const features = route?.destination_features ?? [];
  const destinationOrder =
    destinationIds.length >= 2 &&
    destinationIds[0] === input.trailheadId &&
    destinationIds[destinationIds.length - 1] === input.destinationId &&
    features[0]?.includes("trailhead") &&
    features[features.length - 1]?.includes("summit");
  const segments =
    (route?.segment_count ?? 0) >= 1 &&
    route?.matching_segment_count === route?.segment_count &&
    (route?.point_count ?? 0) >= 5;

  const publicBaseUrl = (
    input.publicBaseUrl ||
    process.env.PEAKS_PUBLIC_WEB_URL ||
    DEFAULT_PEAKS_PUBLIC_WEB_URL
  ).replace(/\/+$/, "");
  const publicUrl =
    `${publicBaseUrl}/api/public/routes/${encodeURIComponent(input.routeId)}`;
  let publicStatus = 0;
  let publicPayload: RouteRow | null = null;
  let publicError: string | null = null;
  try {
    const response = await fetch(publicUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "user-agent":
          "Peaks standard-route verifier/1.0 " +
          "(https://github.com/jhmacdon/peaks-firebase)",
      },
    });
    publicStatus = response.status;
    if (response.ok) {
      publicPayload = (await response.json()) as RouteRow;
    } else {
      await response.body?.cancel();
    }
  } catch (error) {
    publicError = error instanceof Error ? error.message : String(error);
  }
  const publicMatches =
    publicStatus === 200 &&
    publicPayload?.id === input.routeId &&
    publicPayload.owner === "peaks" &&
    publicPayload.status === "active" &&
    publicPayload.provenance_valid === true &&
    publicPayload.point_count === route?.point_count &&
    publicPayload.segment_count === route?.segment_count &&
    publicPayload.matching_segment_count === route?.matching_segment_count &&
    arraysEqual(publicPayload.destination_ids ?? [], destinationIds);

  const gates = {
    owner: route?.owner === "peaks",
    active: route?.status === "active",
    destination_order: destinationOrder,
    segments,
    provenance: route?.provenance_valid === true,
    public_http: publicMatches,
  };
  const errors = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
  if (publicError) errors.push(`public_http: ${publicError}`);
  return {
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    route_id: input.routeId,
    destination_id: input.destinationId,
    trailhead_id: input.trailheadId,
    route_name: route?.name ?? null,
    public_url: publicUrl,
    public_status: publicStatus,
    gates,
    errors,
  };
}
