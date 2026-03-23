import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const firebase = require("./firebase");
const admin = firebase.admin;
const firestore = admin.firestore();

const STRAVA_CLIENT = defineSecret("STRAVA_CLIENT");
const STRAVA_SECRET = defineSecret("STRAVA_SECRET");

/**
 * Callable: returns a valid Strava access token for the authenticated user.
 * Called by iOS StravaImportAdapter.
 */
exports.getStravaToken = onCall({
  secrets: [STRAVA_CLIENT, STRAVA_SECRET],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Must be authenticated"
    );
  }

  const userId = request.auth.uid;
  const userDoc = await firestore.collection("users").doc(userId).get();
  const strava = userDoc.data()?.strava;

  if (!strava || !strava.access_token) {
    throw new HttpsError(
      "failed-precondition",
      "Strava not connected"
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // If token is still valid (with 60s buffer), return it directly
  if (strava.expires_at > now + 60) {
    return {accessToken: strava.access_token};
  }

  // Token expired — refresh it
  try {
    const fetchResp = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        client_id: STRAVA_CLIENT.value(),
        client_secret: STRAVA_SECRET.value(),
        refresh_token: strava.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!fetchResp.ok) throw new Error(`Strava token refresh failed: ${fetchResp.status}`);
    const tokenData = JSON.parse(await fetchResp.text());

    await firestore.collection("users").doc(userId).update({
      "strava.access_token": tokenData.access_token,
      "strava.refresh_token": tokenData.refresh_token,
      "strava.expires_at": tokenData.expires_at,
    });

    return {accessToken: tokenData.access_token};
  } catch (err) {
    console.error("Strava token refresh failed:", err);
    throw new HttpsError(
      "internal",
      "Failed to refresh Strava token"
    );
  }
});

/**
 * HTTP: Combined Strava webhook validation (GET) and event handler (POST).
 *
 * Webhook subscription setup (run once after deploying):
 * curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *   -F client_id=44977 \
 *   -F client_secret=YOUR_SECRET \
 *   -F callback_url=https://us-central1-donner-a8608.cloudfunctions.net/stravaWebhook \
 *   -F verify_token=PEAKS_STRAVA_VERIFY
 */
exports.stravaWebhook = onRequest(async (req, res) => {
  // GET: Strava webhook subscription validation
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && verifyToken === "PEAKS_STRAVA_VERIFY") {
      res.status(200).json({"hub.challenge": challenge});
    } else {
      res.status(403).send("Forbidden");
    }
    return;
  }

  // POST: Strava webhook event
  if (req.method === "POST") {
    const {object_type, object_id, aspect_type, owner_id} = req.body;

    // Only handle new activity creation
    if (object_type !== "activity" || aspect_type !== "create") {
      res.status(200).send("OK");
      return;
    }

    try {
      // Find the Peaks user with this Strava athlete ID
      const usersSnap = await firestore
        .collection("users")
        .where("strava.athlete_id", "==", owner_id)
        .limit(1)
        .get();

      if (!usersSnap.empty) {
        const userDoc = usersSnap.docs[0];
        const fcmToken = userDoc.data()?.fcmToken;

        if (fcmToken) {
          await admin.messaging().send({
            token: fcmToken,
            notification: {
              title: "New Strava activity",
              body: "A new activity is ready to import",
            },
            data: {
              type: "strava_new_activity",
              activityId: String(object_id),
            },
          });
          console.log(
            `Sent FCM notification to user ${userDoc.id} for activity ${object_id}`
          );
        } else {
          console.log(`No FCM token for user ${userDoc.id}`);
        }
      } else {
        console.log(`No user found for Strava athlete_id ${owner_id}`);
      }
    } catch (err) {
      console.error("Error processing Strava webhook:", err);
    }

    res.status(200).send("OK");
    return;
  }

  res.status(405).send("Method not allowed");
});
