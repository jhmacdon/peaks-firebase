import * as functions from "firebase-functions";
import * as request from "request-promise-native";

const firebase = require("./firebase");
const admin = firebase.admin;
const firestore = admin.firestore();

/**
 * Callable: returns a valid Strava access token for the authenticated user.
 * Called by iOS StravaImportAdapter.
 */
exports.getStravaToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Must be authenticated"
    );
  }

  const userId = context.auth.uid;
  const userDoc = await firestore.collection("users").doc(userId).get();
  const strava = userDoc.data()?.strava;

  if (!strava || !strava.access_token) {
    throw new functions.https.HttpsError(
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
    const url = `https://www.strava.com/oauth/token?client_id=${functions.config().strava.client}&client_secret=${functions.config().strava.secret}&refresh_token=${strava.refresh_token}&grant_type=refresh_token`;
    const response = await request.post(url, {});
    const tokenData = JSON.parse(response);

    await firestore.collection("users").doc(userId).set({
      strava: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
      },
    }, {merge: true});

    return {accessToken: tokenData.access_token};
  } catch (err) {
    console.error("Strava token refresh failed:", err);
    throw new functions.https.HttpsError(
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
exports.stravaWebhook = functions.https.onRequest(async (req, res) => {
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
