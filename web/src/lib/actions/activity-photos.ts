"use server";

import db from "../db";
import { selectActivityPhotos, type ActivityPhotoGroup } from "../activity-photos";

/** Published report photos only. Private session photos and health data never enter this query. */
export async function getActivityPhotoGroups(scope: { destinationId?: string; areaId?: string; sessionId?: string }): Promise<ActivityPhotoGroup[]> {
  const id = scope.destinationId ?? scope.areaId ?? scope.sessionId;
  if (!id) throw new Error("A place or activity is required");
  const clause = scope.destinationId
    ? "EXISTS (SELECT 1 FROM trip_report_destinations rd WHERE rd.report_id = tr.id AND rd.destination_id = $1)"
    : scope.areaId
      ? "EXISTS (SELECT 1 FROM trip_report_destinations rd JOIN destination_areas da ON da.destination_id = rd.destination_id WHERE rd.report_id = tr.id AND da.area_id = $1)"
      : "tr.source_session_id = $1";
  const result = await db.query<{
    id: string; activity_name: string | null; title: string; activity_date: Date | string;
    activity_type: string | null; author_name: string;
    photos: { id: string; url: string; caption: string | null }[];
  }>(`SELECT tr.id, tr.activity_name, tr.title, tr.activity_date, tr.activity_type, tr.author_name,
      (SELECT json_agg(json_build_object('id', p.id, 'url', p.download_url, 'caption', p.caption) ORDER BY p.ordinal, p.id)
       FROM trip_report_photos p WHERE p.report_id = tr.id) AS photos
      FROM trip_reports tr
      WHERE tr.moderation_state = 'published' AND ${clause}
        AND EXISTS (SELECT 1 FROM trip_report_photos p WHERE p.report_id = tr.id)
      ORDER BY tr.activity_date DESC, tr.id LIMIT 4`, [id]);
  return result.rows.map((row) => ({
    reportId: row.id,
    activityName: row.activity_name || row.title,
    date: row.activity_date instanceof Date ? row.activity_date.toISOString() : row.activity_date,
    activityType: row.activity_type,
    authorName: row.author_name,
    photos: selectActivityPhotos(row.photos),
  }));
}
