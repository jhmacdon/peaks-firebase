import { firestore } from "./firebase";
import db from "./db";
import { normalizeLegacyTripReport } from "./trip-report-normalize";

export async function migrateTripReports(): Promise<void> {
  const snapshot = await firestore.collection("tripReports").get();
  let imported = 0;
  let invalid = 0;
  let missingDestinationLinks = 0;

  for (const document of snapshot.docs) {
    const report = normalizeLegacyTripReport(document.id, document.data());
    if (!report) {
      invalid++;
      continue;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query(
        `SELECT id, name, activity_type, start_time
         FROM tracking_sessions
         WHERE id = $1 AND user_id = $2`,
        [report.id, report.userId]
      );
      const sessionRow = session.rows[0] ?? null;
      const upsert = await client.query(
        `INSERT INTO trip_reports
           (id, source_session_id, legacy_source_id, user_id, author_name,
            title, body, activity_name, activity_type, activity_date,
            legacy_record, created_at, updated_at)
         VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, true, $9, $9)
         ON CONFLICT (id) DO UPDATE SET
           legacy_source_id = EXCLUDED.legacy_source_id,
           author_name = EXCLUDED.author_name,
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           activity_date = EXCLUDED.activity_date,
           updated_at = EXCLUDED.updated_at
         WHERE trip_reports.legacy_record = true
         RETURNING id`,
        [
          report.id,
          sessionRow?.id ?? null,
          report.userId,
          report.authorName,
          report.title,
          report.body,
          sessionRow?.name ?? report.title,
          sessionRow?.activity_type ?? null,
          sessionRow?.start_time ?? report.activityDate,
        ]
      );
      if (upsert.rows.length === 0) {
        await client.query("ROLLBACK");
        continue;
      }
      await client.query("DELETE FROM trip_report_destinations WHERE report_id = $1", [report.id]);
      if (report.destinationIds.length > 0) {
        const links = await client.query(
          `INSERT INTO trip_report_destinations (report_id, destination_id)
           SELECT $1, id FROM destinations WHERE id = ANY($2::text[])
           ON CONFLICT DO NOTHING
           RETURNING destination_id`,
          [report.id, report.destinationIds]
        );
        missingDestinationLinks += report.destinationIds.length - links.rows.length;
      }
      // Legacy "attachments.route = true" carried no route ID. Do not guess a
      // route from its display name or geometry; only new settled sessions can
      // create trip_report_routes rows.
      await client.query("DELETE FROM trip_report_routes WHERE report_id = $1", [report.id]);
      await client.query("DELETE FROM trip_report_photos WHERE report_id = $1", [report.id]);
      for (const photo of report.photos) {
        await client.query(
          `INSERT INTO trip_report_photos
           (id, report_id, download_url, caption, taken_at, ordinal)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (report_id, id) DO NOTHING`,
          [photo.id, report.id, photo.downloadURL, photo.caption, photo.takenAt, photo.ordinal]
        );
      }
      await client.query("COMMIT");
      imported++;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const target = await db.query(
    "SELECT count(*)::int AS count FROM trip_reports WHERE legacy_source_id IS NOT NULL"
  );
  const targetCount = Number(target.rows[0]?.count ?? 0);
  console.log(
    `Trip Reports: source=${snapshot.size} imported=${imported} ` +
    `invalid=${invalid} target=${targetCount} missing_destination_links=${missingDestinationLinks}`
  );
  if (targetCount < imported) {
    throw new Error("Trip Report migration audit failed: target count is below imported count");
  }
}

if (require.main === module) {
  migrateTripReports()
    .then(() => db.end())
    .catch(async (error) => {
      console.error(error);
      await db.end();
      process.exitCode = 1;
    });
}
