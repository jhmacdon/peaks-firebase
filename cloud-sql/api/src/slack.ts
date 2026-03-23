import db from "./db";

const SLACK_IGNORE_USERS = new Set([
  "QzmvJRt5E5eTV4fAsuyLDrc4PEq1",
]);

export async function sendSlackNotification(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("Slack notification failed:", err);
  }
}

/**
 * Send a Slack notification after session processing completes.
 * Includes user name, matched destinations, distance, and gain.
 */
export async function notifySessionProcessed(
  sessionId: string,
  userId: string,
  destinationsMatched: number,
  routesMatched: number
) {
  if (SLACK_IGNORE_USERS.has(userId)) return;

  try {
    // Get session stats
    const session = await db.query(
      `SELECT name, distance, gain FROM tracking_sessions WHERE id = $1`,
      [sessionId]
    );
    const s = session.rows[0];

    // Get matched destination names
    const dests = await db.query(
      `SELECT d.name FROM destinations d
       JOIN session_destinations sd ON sd.destination_id = d.id
       WHERE sd.session_id = $1 AND sd.relation = 'reached'
       ORDER BY d.elevation DESC NULLS LAST
       LIMIT 5`,
      [sessionId]
    );
    const destNames = dests.rows.map((r: { name: string }) => r.name).filter(Boolean);

    const distance = s?.distance
      ? ` • ${(s.distance / 1609.34).toFixed(1)} mi`
      : "";
    const gain = s?.gain
      ? ` • ${Math.round(s.gain * 3.28084).toLocaleString()} ft gain`
      : "";
    const destText = destNames.length > 0
      ? `\nPeaks: ${destNames.join(", ")}`
      : "";
    const matchSummary = destinationsMatched > 0 || routesMatched > 0
      ? `\n📍 ${destinationsMatched} destination${destinationsMatched !== 1 ? "s" : ""}, ${routesMatched} route${routesMatched !== 1 ? "s" : ""} matched`
      : "";

    const sessionName = s?.name || "Unnamed";
    await sendSlackNotification(
      `🥾 *New session:* ${sessionName}${distance}${gain}${destText}${matchSummary}`
    );
  } catch (err) {
    console.error("Slack session notification failed:", err);
  }
}
