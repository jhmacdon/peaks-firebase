import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import * as firAdmin from 'firebase-admin'

const firebase = require('./firebase')
const admin = firebase.admin

const { algoliasearch } = require('algoliasearch');
import QuerySnapshot = firAdmin.firestore.QuerySnapshot
import DocumentReference = firAdmin.firestore.DocumentReference
import WriteResult = firAdmin.firestore.WriteResult
import CollectionReference = firAdmin.firestore.CollectionReference
import FieldValue = firAdmin.firestore.FieldValue
import DocumentSnapshot = firAdmin.firestore.DocumentSnapshot
import * as turf from '@turf/turf'
const sharp = require('sharp');
const destinationHelpers = require('./destinationHelpers')

const { buildGPX, BaseBuilder } = require('gpx-builder');
const { Point } = BaseBuilder.MODELS;
const { Segment } = BaseBuilder.MODELS;
const { Track } = BaseBuilder.MODELS;

import fs = require("fs");
import os = require('os');
import stream = require('stream')
const path = require('path');

// Secrets
const STRAVA_CLIENT = defineSecret('STRAVA_CLIENT')
const STRAVA_SECRET = defineSecret('STRAVA_SECRET')
const ALGOLIA_APP_ID = defineSecret('ALGOLIA_APP_ID')
const ALGOLIA_API_KEY = defineSecret('ALGOLIA_API_KEY')
// const REVENUECAT_WEBHOOK_KEY = defineSecret('REVENUECAT_WEBHOOK_KEY')
const APPLE_IAP_SECRET = defineSecret('APPLE_IAP_SECRET')
const SLACK_WEBHOOK_URL = defineSecret('SLACK_WEBHOOK_URL')

const firestore = firebase.firestore

const ALGOLIA_DESTINATION_INDEX = 'destinations';

// Lazy Algolia client — initialized inside function bodies after secrets are available
let _algoliaClient: any = null
function getAlgoliaClient() {
  if (!_algoliaClient) {
    _algoliaClient = algoliasearch(ALGOLIA_APP_ID.value(), ALGOLIA_API_KEY.value())
  }
  return _algoliaClient
}

const fsClient = new admin.firestore.v1.FirestoreAdminClient();

export const scheduledFirestoreExport = onSchedule({ schedule: 'every 168 hours' }, async (_event) => {
  const bucket = 'gs://peaks-backups';
  const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
  const databaseName =
    fsClient.databasePath(projectId, '(default)');

  return fsClient.exportDocuments({
    name: databaseName,
    outputUriPrefix: bucket,
    collectionIds: []
    })
  .then(responses => {
    const response = responses[0];
    console.log(`Operation Name: ${response['name']}`);
  })
  .catch(err => {
    console.error(err);
    throw new Error('Export operation failed');
  });
});

export const onSessionCreated = onDocumentCreated('/sessions/{sessionId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  let promises:Promise<WriteResult>[] = []
  const session = snap.data()


  if (session && session.lastUpdated) {
    let reachedIds = []
    let plannedIds = []

    if (session.destinationsReached) {
      reachedIds = session.destinationsReached
    }

    if (session.destinationGoals) {
      plannedIds = session.destinationGoals
    }

    const destinationIds: (string)[] = reachedIds.concat(plannedIds.filter((item) => reachedIds.indexOf(item) < 0))

    const date = new Date(session.lastUpdated * 1000);
    const dayOfWeek = date.getDay()
    const month = date.getMonth()

    const months: (string)[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const days: (string)[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']

    const monthKey: string = months[month]
    const dayKey: string = days[dayOfWeek]


    for (const destinationId in destinationIds) {
      const docResults = await (await firestore.collection("averages").where("destinationId", "==", destinationId).limit(1).get()).docs

      let avgDoc: DocumentReference
      if (docResults.length == 0) {
        avgDoc = await firestore.collection("averages").doc()
      } else {
        avgDoc = docResults[0].ref
      }

      const updateData = {
        lastUpdated: new Date()
      }

      updateData["months"] = {}
      updateData["months"][monthKey] = FieldValue.increment(1)

      updateData["weekdays"] = {}
      updateData["weekdays"][dayKey] = FieldValue.increment(1)


      if (docResults.length == 0) {
        updateData["destinationId"] = destinationId
        updateData["type"] = "destination"
      }

      promises.push(avgDoc.set(updateData, { merge: true }))
    }
  }

  if (session && session.status && session.status.ended == true) {
    const reachedDIds = session!.destinationsReached! as Array<string>
    const goalIds = (session!.destinationGoals! as Array<string>).filter(id => reachedDIds.indexOf(id) == -1)
    const updatePromises = await updateDestinationStats(goalIds, reachedDIds)
    promises = promises.concat(updatePromises)
  }

  return Promise.all(promises)
})

export const onSessionUpdated = onDocumentUpdated('/sessions/{sessionId}', async (event) => {
      const change = event.data;
      if (!change) return null;
      const session = change.after.data();
      const oldSession = change.before.data();

      if (session!.status!.ended == oldSession!.status!.ended) {
        return null
      }

      const destinationIds = session!.destinationsReached! as Array<string>
      const goalIds = (session!.destinationGoals! as Array<string>).filter(id => destinationIds.indexOf(id) == -1)
      return Promise.all(await updateDestinationStats(goalIds, destinationIds))
});

export async function updateDestinationStats(goalIds: Array<string>, reachedIds: Array<string>) {
  const collectionRef: CollectionReference = await firestore.collection("destinations")

  const promises:Promise<WriteResult>[] = []

  reachedIds.forEach(async id => {
    const destination: DocumentSnapshot = await collectionRef.doc(id)!.get()
    let stats = destination.data()!.stats

    if (!stats) {
      stats = {
        sessionCount : 0,
        successCount : 0
      }
    }

    stats.successCount = stats.successCount + 1
    stats.sessionCount = stats.sessionCount + 1

    promises.push(destination.ref.set({
        stats : stats,
        recency: new Date()
    }, {merge: true}))
  })

  goalIds.forEach(async id => {

    if (reachedIds.includes(id)) {
      return
    }

    const destination: DocumentSnapshot = await collectionRef.doc(id)!.get()
    let stats = destination.data()!.stats

    if (!stats) {
      stats = {
        sessionCount : 0,
        successCount : 0
      }
    }

    stats.sessionCount = stats.sessionCount + 1

    promises.push(destination.ref.set({
        stats : stats,
        recency: new Date()
    }, {merge: true}))

  })

  return promises
}

export const onDestinationUpdated = onDocumentUpdated({
  document: '/destinations/{id}',
  secrets: [ALGOLIA_APP_ID, ALGOLIA_API_KEY]
}, async (event) => {
  const change = event.data;
  if (!change) return;
  const algDestination = change.after.data()
  algDestination!.objectID = change.after.id
  algDestination!._geoloc = {
    lat: algDestination!.l![0],
    lng: algDestination!.l![1]
  }

  if (algDestination!.recency) {
    algDestination!.recency = algDestination!.recency!._seconds
  }

  return getAlgoliaClient().saveObject({ indexName: ALGOLIA_DESTINATION_INDEX, body: algDestination! })
})

export const onListUpdated = onDocumentUpdated('/lists/{id}', async (event) => {
  const change = event.data;
  if (!change) return null;
  const list = change.after.data()

  const oldList = change.before.data();

  if (list.destinations === oldList.destinations) {
    return null
  }

  const oldMeta = list.meta || {}

  const destinationIds: string[] = []
  for (let i = 0; i < list.destinations.length; i++) {
    const id = list.destinations[i]
    if (!oldMeta[id]) {
      destinationIds.push(id)
    }
  }

  console.log(destinationIds)

  if (destinationIds.length === 0) {
    console.log("No destinations, returning")
    return "Aye"
  }

  const destinations: DocumentSnapshot[] = await destinationHelpers.getDestinations(destinationIds)

  const meta = {}
  destinations.forEach(destination => {
    meta[destination.id] = {
      "elevation": destination.data()!.elevation,
      "name": destination.data()!.name,
      "l": destination.data()!.l
    }
  });

  if (JSON.stringify(meta) === '{}') {
    return null
  }

  return firestore.collection("lists").doc(change.after.id).set({
    "meta": meta
  }, { merge: true })
})

export const onListAdded = onDocumentCreated('/lists/{id}', async (event) => {
  const snap = event.data;
  if (!snap) return null;
  const list = snap.data();
  const oldMeta = list.meta || {}

  const destinationIds: string[] = []
  for (let i = 0; i < list.destinations.length; i++) {
    const id = list.destinations[i]
    if (!oldMeta[id]) {
      destinationIds.push(id)
    }
  }

  const destinations: DocumentSnapshot[] = await destinationHelpers.getDestinations(destinationIds)

  const meta = {}
  destinations.forEach(destination => {
    meta[destination.id] = {
      "elevation": destination.data()!.elevation,
      "name": destination.data()!.name,
      "l": destination.data()!.l
    }
  });

  if (JSON.stringify(meta) === '{}') {
    return null
  }

  return firestore.collection("lists").doc(snap.id).set({
    "meta": meta
  }, { merge: true })
})

export const onDestinationAdded = onDocumentCreated({
  document: '/destinations/{id}',
  secrets: [ALGOLIA_APP_ID, ALGOLIA_API_KEY]
}, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const algDestination = snap.data()
  algDestination!.objectID = snap.id
  algDestination!._geoloc = {
    lat: algDestination!.l![0],
    lng: algDestination!.l![1]
  }
  if (algDestination!.recency) {
    algDestination!.recency = algDestination!.recency!._seconds
  }
  return getAlgoliaClient().saveObject({ indexName: ALGOLIA_DESTINATION_INDEX, body: algDestination! })
})

export const onDestinationRemoved = onDocumentDeleted({
  document: '/destinations/{id}',
  secrets: [ALGOLIA_APP_ID, ALGOLIA_API_KEY]
}, async (event) => {
  const snap = event.data;
  if (!snap) return;
  return getAlgoliaClient().deleteObject({ indexName: ALGOLIA_DESTINATION_INDEX, objectID: snap.id })
})

export const onPointsCreated = onDocumentCreated({
  document: '/points/{id}',
  secrets: [STRAVA_CLIENT, STRAVA_SECRET]
}, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const id = snap.id

  return uploadGPXIfNeeded(id, snap)
})

export const onPointsUpdated = onDocumentUpdated({
  document: '/points/{id}',
  secrets: [STRAVA_CLIENT, STRAVA_SECRET]
}, async (event) => {
  const change = event.data;
  if (!change) return;
  const id = change.after.id

  return uploadGPXIfNeeded(id, change.after)
})

export const uploadSessionToStrava = onCall({
  secrets: [STRAVA_CLIENT, STRAVA_SECRET]
}, async (request) => {
  if (!request.auth) {
      console.log("no auth!")
      throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const sessionId = request.data.sessionId
  const userId = request.auth.uid
  const force: boolean = request.data.force || false

  const sessionRef = await firestore.collection("sessions").doc(sessionId).get()
  const session = sessionRef.data()

  if (session!.userId != userId) {
    console.log("no auth!")
    throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const pointDataRef = await firestore.collection("points").doc(sessionId).get()

  return uploadGPXIfNeeded(sessionId, pointDataRef, force)
})



export async function uploadGPXIfNeeded(sessionId: string, pointData: DocumentSnapshot, force = false) {
  const sessionRef = await firestore.collection("sessions").doc(sessionId).get()
  const session = sessionRef.data()
  const userId = session!.userId
  const userRef = await firestore.collection("users").doc(userId).get()
  const user = userRef.data()

  const segments: Array<typeof Segment> = []
  let segment: Array<typeof Point> = []

  if (session && session.status && session.status.uploadedToStrava && !force) {
    console.log("Session already uploaded to strava")
    return
  }

  if ((!user || !user.strava || !user.strava.enabled) && !force) {
    console.log("Strava not enabled for user")
    return
  }

  if (session!.status!.ended) {
    const p: any[] = pointData!.data()!.points!

    if (p.length == 0) {
      return
    }

    let currentSegment = 0
    p.forEach((point) => {

      if (point!.segmentNumber !== currentSegment) {
        segments.push(new Segment(segment))
        segment = []
        currentSegment = point!.segmentNumber
      }

      segment!.push(new Point(point!.lat, point!.lng, {
        ele: point!.elevation,
        time: new Date(point!.time * 1000),
        hdop: point!.hdop,
        magvar: point!.azimuth
      }))
    });

    segments.push(new Segment(segment))


    const gpxData = new BaseBuilder();

    gpxData.setTracks([new Track(segments)]);

    const gpxString = buildGPX(gpxData.toObject())

    const accessToken = await getStravaAccessToken(user!.strava, userId)

    console.log(accessToken)

    const tempFilePath = path.join(os.tmpdir(), `${sessionId}.gpx`);

    console.log(tempFilePath)

    let name = "Peaks - A Day Climbing"

    let destinationIds: string[] = session!.destinationsReached

    if (!destinationIds || destinationIds.length == 0) {
      destinationIds = session!.destinationGoals
    }

    if (destinationIds && destinationIds.length != 0) {
      const destinations: DocumentSnapshot[] = await destinationHelpers.getDestinations(destinationIds)
      let idealDestination: DocumentSnapshot = destinations[0]
      let maxHeight = 0
      destinations.forEach(destination => {
        if (destination.data()!.elevation > maxHeight) {
          maxHeight = destination.data()!.elevation
          idealDestination = destination
        }
      });

      if (idealDestination.data()!.prominence > 10) {
        name = `Peaks - A Day Climbing ${idealDestination.data()!.name}`
      } else {
        name = `Peaks - A Day Climbing to ${idealDestination.data()!.name}`
      }
    }

    console.log(name)

    fs.writeFileSync(tempFilePath, gpxString);

    const formData = new FormData();
    formData.append('activity_type', 'hike');
    formData.append('external_id', sessionId);
    formData.append('data_type', 'gpx');
    formData.append('name', name);
    const fileBuffer = fs.readFileSync(tempFilePath);
    formData.append('file', new Blob([fileBuffer]), `${sessionId}.gpx`);

    const uploadResp = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData
    });
    if (!uploadResp.ok) throw new Error(`Strava upload failed: ${uploadResp.status}`);
    const payload = await uploadResp.json();

    const status = {
      uploadedToStrava: true
    }

    return sessionRef.ref.set({
      status: status,
      stravaId: payload!.id
    }, { merge: true })
  }
}

export async function getStravaAccessToken(stravaBlock: any, userId: string): Promise<string> {
  const accessToken = stravaBlock!.access_token
  const refreshToken = stravaBlock!.refresh_token
  const expiresAt: number = stravaBlock!.expires_at

  if (Math.floor(Date.now() / 1000) < expiresAt) {
    return accessToken
  }

  const fetchResp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      client_id: STRAVA_CLIENT.value(),
      client_secret: STRAVA_SECRET.value(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  })
  if (!fetchResp.ok) throw new Error(`Strava token refresh failed: ${fetchResp.status}`)
  const response = await fetchResp.text()

  interface StravaResponse {
    expires_at: number,
    expires_in: number,
    refresh_token: string,
    access_token: string,
  }

  const stravaResponse: StravaResponse = JSON.parse(response)

  const userRef: DocumentReference = firestore.collection("users").doc(userId)
  await userRef.update({
    "strava.access_token": stravaResponse.access_token,
    "strava.refresh_token": stravaResponse.refresh_token,
    "strava.expires_at": stravaResponse.expires_at,
  })
  return stravaResponse.access_token
}

export async function getPlan(id: string): Promise<DocumentSnapshot> {
  return firestore.collection("plans").doc(id).get()
}

export const linkAnonToPermAccount = onCall(async (request) => {

    if (!request.auth) {
        console.log("no auth!")
        throw new HttpsError('failed-precondition', 'The function must be called ' +
      'while authenticated.')
    }

    const newUid = request.auth.uid
    const oldUid = request.data.oldUid

    const oldSessionSnap = await getUserSessions(oldUid)

    const promises:Promise<WriteResult>[] = []

    oldSessionSnap.forEach(session => {
      const p:Promise<WriteResult> = session.ref.set({
        userId: newUid
      }, {merge: true})
      promises.push(p);
    })

    console.log("Successfully changed all sessions from " + oldUid + " to " + newUid + " for " + promises.length + " sessions")

    const oldPlanSnap = await getUserPlans(oldUid)

    oldPlanSnap.forEach(plan => {
      const p:Promise<WriteResult> = plan.ref.set({
        userId: newUid
      }, {merge: true})
      promises.push(p);
    })

    console.log("Successfully changed all plan from " + oldUid + " to " + newUid + " for " + promises.length + " plans + sessions")

    const userDoc = await firestore.collection("users").doc(oldUid).get()
    if (userDoc) {
      await firestore.collection("users").doc(newUid).set(userDoc!.data()!, {merge: true})
      await firestore.collection("users").doc(oldUid).delete()

      console.log("Successfully transfered user doc over")
    }


    return Promise.all(promises);
})

export function getUserSessions(id: string): Promise<QuerySnapshot> {
    return firestore.collection("sessions").where("userId", "==", id).get()
}

export function getUserPlans(id: string): Promise<QuerySnapshot> {
  return firestore.collection("plans").where("userId", "==", id).get()
}

export const deleteSession = onCall(async (request) => {
  if (!request.auth) {
      console.log("no auth!")
      throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const sessionId = request.data.sessionId
  const userId = request.auth.uid

  const session: DocumentSnapshot = await firestore.collection("sessions").doc(sessionId)!.get()
  const sessionData = session.data()!

  if (sessionData.userId != userId) {
    throw new HttpsError('failed-precondition', 'The user calling this function cannnot delete this session')
  }

  let status = sessionData.status
  if (!status) {
    status = {}
  }

  status.deleted = true

  return session.ref.set({
      userId : "deleted_" + sessionData.userId,
      status: status
  }, {merge: true})
})

export const acquireStravaToken = onCall(async (request) => {
  if (!request.auth) {
      console.log("no auth!")
      throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const userId = request.auth.uid

  const codeRef: CollectionReference = firestore.collection("codes")

  const codeDec = codeRef.doc();

  await codeDec.set({
    userId: userId,
    reason: "strava",
    expires: Math.floor(Date.now() / 1000) + 1200 // Expires in 20 minutes
  })

  return codeDec.id
})

export const exchange_token = onRequest({
  secrets: [STRAVA_CLIENT, STRAVA_SECRET]
}, async (req, res) => {
  const peaksCode = req.query.peaksCode as string
  const fetchResp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      client_id: STRAVA_CLIENT.value(),
      client_secret: STRAVA_SECRET.value(),
      code: req.query.code as string,
      grant_type: "authorization_code",
    }).toString(),
  })
  if (!fetchResp.ok) throw new Error(`Strava OAuth exchange failed: ${fetchResp.status}`)
  const response = await fetchResp.text()



  interface StravaAthlete {
    id: number,
    usename: string,
    firstname: string,
    lastname: string
  }

  interface StravaResponse {
    expires_at: number,
    refresh_token: string,
    access_token: string,
    athlete: StravaAthlete,
    enabled: boolean,
    athlete_id?: number
  }

  const stravaResponse: StravaResponse = JSON.parse(response)
  stravaResponse.enabled = true
  stravaResponse.athlete_id = stravaResponse.athlete.id

  const doc: DocumentSnapshot = await firestore.collection("codes").doc(peaksCode).get()!
  const userId = doc.data()!.userId!

  const userCollectionRef: DocumentReference = await firestore.collection("users").doc(userId)

  await userCollectionRef.set({
    strava: stravaResponse
  }, {merge: true})

  res.status(200).send("Aye")
});

export const deletePlan = onCall(async (request) => {

  if (!request.auth) {
      console.log("no auth!")
      throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const uid = request.auth.uid
  const pid = request.data.planId

  const plan: DocumentSnapshot = await getPlan(pid)

  if (plan!.data()!.userId !== uid) {
    throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  return plan.ref.delete()

})


export const appleIAPNotification = onRequest({
  secrets: [APPLE_IAP_SECRET]
}, async (req, res) => {
  // TODO: Re-enable RevenueCat forwarding once webhook key is available
  // const rcFetchResp = await fetch(`https://api.revenuecat.com/v1/incoming-webhooks/apple-server-to-server-notification/${REVENUECAT_WEBHOOK_KEY.value()}`, {
  //   method: 'POST',
  //   headers: {'Content-Type': 'application/json'},
  //   body: JSON.stringify(req.body)
  // })
  // const revenueCatResp = await rcFetchResp.json()
  // console.log("RevenueCat Resp:")
  // console.log(revenueCatResp)

  console.log("Notification Type " + req.body!.notification_type)

  const response = await verifyAppleReceipt((req.body!.unified_receipt!.latest_receipt) as string)

  let transactionId = ""

  response!.latest_receipt_info!.forEach(element => {
    if (element.original_transaction_id) {
      transactionId = element.original_transaction_id
    }
  });

  console.log("OG Transaction ID: " + transactionId)

  const result: QuerySnapshot = await firestore.collection("users").where("premium.transaction", "==", transactionId).get()

  if (result.docs.length == 0) {
    res.status(200).send("Document not found for user, so sending 200 and assuming revenuecats got our ass")
    return
  }

  const updateObj = {
      "receipt": response!.latest_receipt_info[response!.latest_receipt_info!.length - 1]
  }

  if (req.body!.auto_renew_status) {
    updateObj["renews"] = req.body!.auto_renew_status === "true"
  }

  updateObj["expires"] = new Date(+response!.latest_receipt_info[response!.latest_receipt_info!.length - 1].expires_date_ms)


  if (req.body!.auto_renew_status_change_date_ms) {
    updateObj["renewStatusChanged"] = +(req.body!.auto_renew_status_change_date_ms) / 1000
  }

  await result!.docs[0].ref.set({
    "premium": updateObj
  }, {merge: true})

  res.status(200).send("Ok")
  return
})

export const processAppleReceipt = onCall({
  secrets: [APPLE_IAP_SECRET]
}, async (request) => {
  if (!request.auth) {
      console.log("no auth!")
      throw new HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const uid = request.auth.uid

  const appleResponse = await verifyAppleReceipt(request.data!.receipt as string)

  const userCollectionRef: DocumentReference = await firestore.collection("users").doc(uid)

  await userCollectionRef.set({
    premium: {
      method: "apple",
      transaction: appleResponse!.latest_receipt_info![0].original_transaction_id,
      receipt: appleResponse!.latest_receipt_info[appleResponse!.latest_receipt_info!.length - 1],
      expires: new Date(+appleResponse!.latest_receipt_info[appleResponse!.latest_receipt_info!.length - 1].expires_date_ms)
    }
  }, {merge: true})

  return appleResponse
})

export async function verifyAppleReceipt(data: string): Promise<any> {
  const appleBody = JSON.stringify({
    "password": APPLE_IAP_SECRET.value(),
    "receipt-data": data
  })
  const appleHeaders = {'Content-Type': 'application/json'}

  let appleFetchResp = await fetch('https://buy.itunes.apple.com/verifyReceipt', {
    method: 'POST', headers: appleHeaders, body: appleBody
  })
  if (!appleFetchResp.ok) throw new Error(`Apple verify failed: ${appleFetchResp.status}`)
  let appleResponse = await appleFetchResp.json()

  if (appleResponse!.status === 21007) {
    console.log("Checking sandbox receipt")
    appleFetchResp = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST', headers: appleHeaders, body: appleBody
    })
    if (!appleFetchResp.ok) throw new Error(`Apple sandbox verify failed: ${appleFetchResp.status}`)
    appleResponse = await appleFetchResp.json()
  }

  return appleResponse
}

export const isPremium = onCall(async (request) => {
  if (!request.auth) {
      console.log("no auth!")
      return {premium: false}
  }

  const uid = request.auth.uid

  const userCollectionRef: DocumentReference = await firestore.collection("users").doc(uid)

  const userDoc: DocumentSnapshot = await userCollectionRef.get()

  if (userDoc?.data()?.premium?.method == "apple") {
    const expires = +(userDoc!.data()!.premium!.receipt!.expires_date_ms)/1000 // We don't want ms
    const renews = userDoc!.data()!.premium!.renews
    const currentTime = Math.floor(Date.now() / 1000)

    return {premium: expires + 3600 > currentTime, method: "apple", expires: expires, renews: renews, receipt: userDoc!.data()!.premium!.receipt}
  } else {
    return {premium: false}
  }
})

export const updateHeroImage = onCall(async (request) => {
  console.log("HECK YA")
  const uid = request.auth?.uid

  const destinationId = request.data.destinationId as string

  if (!uid) {
    throw new HttpsError('failed-precondition', 'The function must be called while authenticated.')
  }

  if (!destinationId) {
    throw new HttpsError('failed-precondition', 'destinationID is required for this function')
  }

  let imgData = request.data.imgData as string
  const imgUrl = request.data.imgUrl as string

  if (imgUrl) {
    imgData = await toDataURL(imgUrl) as string
  } else {
    console.log("FUCK")
  }

  const fileBucket = "donner-a8608.appspot.com"
  const fileName = `destinations/${destinationId}.jpg`
  const bucket = admin.storage().bucket(fileBucket);

  await uploadPicture(imgData, destinationId, bucket, fileName)

  const storageRoot = 'https://storage.googleapis.com/';
  const downloadUrl = storageRoot + fileBucket + "/" + encodeURIComponent(fileName);
  console.log("-------")
  console.log(downloadUrl)

  const destRef = firestore.collection("destinations").doc(destinationId)
  await destRef.set({
    "details" : {
      "heroImage": downloadUrl
    }
  }, {merge: true})

  return { newUrl: downloadUrl }

})

async function toDataURL(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`)
  const arrayBuf = await resp.arrayBuffer()
  const body = Buffer.from(arrayBuf)

  console.log("Original size: " + body.length)

  const min = await sharp(body).jpeg({ quality: 80, progressive: true }).toBuffer()

  console.log('Prev Size', Math.round(body.toString().length / 1000) + 'KB');
  console.log('New Size', Math.round(min.toString().length / 1000) + 'KB\n');

  console.log("New Size: " + min.length)

  const data = min.toString('base64');
  return data;
}

const uploadPicture = async (base64: string, _destinationId: string, bucket: any, fileName: string) => {
  return new Promise((resolve, reject) => {
    if (!base64) {
      reject("news.provider#uploadPicture - Could not upload picture because at least one param is missing.");
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(base64, 'base64'));

    // Create a reference to the new image file
    const file = bucket.file(fileName);

    bufferStream.pipe(file.createWriteStream({
      metadata: {
        contentType: 'image/jpeg'
      },
      predefinedAcl: 'publicRead',
      gzip: true,
      public: true
    }))
    .on('error', error => {
      reject(`news.provider#uploadPicture - Error while uploading picture ${JSON.stringify(error)}`);
    })
    .on('finish', (fileResp) => {
      resolve(fileResp)
    });
  })
};

export const avyUpdate = onSchedule({ schedule: 'every 4 hours' }, async (_event) => {
  const url = `https://api.avalanche.org/v2/public/products/map-layer`
  const avyFetchResp = await fetch(url)
  if (!avyFetchResp.ok) throw new Error(`Avalanche API failed: ${avyFetchResp.status}`)
  const response = await avyFetchResp.text()

  const avy: DocumentReference = await firestore.collection("updates").doc("avalanche")

  await avy.set({
    "status": response
  }, {merge: true})
});

export const avyData = onCall(async (request) => {
  const lat = request.data.lat
  const lng = request.data.lng

  const avyDoc: DocumentSnapshot = await firestore.collection("updates").doc("avalanche").get()
  const avyStatus: string = avyDoc.data()!.status
  const point = turf.point([parseFloat(lng), parseFloat(lat)]);
  console.log(point)
  const status = JSON.parse(avyStatus)
  for (let i = 0; i < status.features.length; i++) {
    const feature = turf.feature(status.features[i].geometry)
    if (turf.booleanPointInPolygon(point, feature)) {
      console.log(status.features[i].properties)
      return status.features[i].properties
    }
  }

  return {}
})

// Admin claims management
export const setAdminClaim = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('failed-precondition', 'Must be authenticated.')
  }

  // Only existing admins can grant admin
  const callerClaims = request.auth.token
  if (!callerClaims.admin) {
    throw new HttpsError('permission-denied', 'Only admins can grant admin access.')
  }

  const targetUid = request.data.uid as string
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'uid is required.')
  }

  await admin.auth().setCustomUserClaims(targetUid, { admin: true })
  return { success: true }
})

// Bootstrap: set admin claim via CLI (run once, then remove or guard)
// Usage: firebase functions:shell → setInitialAdmin({ uid: "YOUR_UID" })
export const setInitialAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('failed-precondition', 'Must be authenticated.')
  }

  const targetUid = request.data.uid as string
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'uid is required.')
  }

  // Safety: only allow setting yourself as admin
  if (request.auth.uid !== targetUid) {
    throw new HttpsError('permission-denied', 'Can only bootstrap yourself as admin.')
  }

  await admin.auth().setCustomUserClaims(targetUid, { admin: true })
  return { success: true }
})

// ---------------------------------------------------------------------------
// Slack notifications
// ---------------------------------------------------------------------------

async function sendSlackNotification(text: string) {
  const url = SLACK_WEBHOOK_URL.value()
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('Slack notification failed:', err)
  }
}

export const onNewUser = onDocumentCreated(
  { document: '/users/{userId}', secrets: [SLACK_WEBHOOK_URL] },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const user = snap.data()
    const name = user.name || 'Unknown'
    const email = user.email || ''
    await sendSlackNotification(`👤 *New user:* ${name} (${email})`)
  }
)

export const onNewSessionNotify = onDocumentCreated(
  { document: '/sessions/{sessionId}', secrets: [SLACK_WEBHOOK_URL] },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const session = snap.data()
    const userId = session.userId || 'unknown'

    // Look up user name
    let userName = userId
    try {
      const userDoc = await firestore.collection('users').doc(userId).get()
      if (userDoc.exists) {
        const userData = userDoc.data()
        userName = userData?.name || userId
      }
    } catch { /* fallback to userId */ }

    // Build destination list
    const destinations: string[] = []
    const reached = session.destinationsReached || []
    for (const destId of reached.slice(0, 5)) {
      try {
        const destDoc = await firestore.collection('destinations').doc(destId).get()
        if (destDoc.exists) {
          destinations.push(destDoc.data()?.name || destId)
        }
      } catch { /* skip */ }
    }

    const destText = destinations.length > 0
      ? `\nPeaks: ${destinations.join(', ')}`
      : ''
    const distance = session.overview?.distance
      ? ` • ${(session.overview.distance / 1609.34).toFixed(1)} mi`
      : ''
    const gain = session.overview?.gain
      ? ` • ${Math.round(session.overview.gain * 3.28084).toLocaleString()} ft gain`
      : ''

    await sendSlackNotification(
      `🥾 *New session* by ${userName}${distance}${gain}${destText}`
    )
  }
)

export const onNewPlan = onDocumentCreated(
  { document: '/plans/{planId}', secrets: [SLACK_WEBHOOK_URL] },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const plan = snap.data()
    const userId = plan.userId || 'unknown'

    let userName = userId
    try {
      const userDoc = await firestore.collection('users').doc(userId).get()
      if (userDoc.exists) {
        const userData = userDoc.data()
        userName = userData?.name || userId
      }
    } catch { /* fallback to userId */ }

    const name = plan.name || 'Untitled'
    const destCount = (plan.destinations || []).length
    await sendSlackNotification(
      `📋 *New plan:* "${name}" by ${userName} (${destCount} destination${destCount !== 1 ? 's' : ''})`
    )
  }
)

exports.friends = require('./friends')

const stravaImport = require('./strava')
exports.getStravaToken = stravaImport.getStravaToken
exports.stravaWebhook = stravaImport.stravaWebhook
