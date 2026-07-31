import { NextResponse } from "next/server";
import db from "../../../../../lib/db";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const result = await db.query(
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
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status = 'active'`,
    [id]
  );
  if (!result.rows[0]) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }
  return NextResponse.json(result.rows[0], {
    headers: { "cache-control": "public, max-age=60, s-maxage=300" },
  });
}
