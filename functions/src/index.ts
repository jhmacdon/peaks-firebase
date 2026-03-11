import * as functions from 'firebase-functions'
import * as firAdmin from 'firebase-admin'
// var serviceAccount = require("./admin-service-account.json");
const firebase = require('./firebase')
const admin = firebase.admin

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: "https://donner-a8608.firebaseio.com"
// });

const algoliasearch = require('algoliasearch');
import * as request from "request-promise-native";
//import Query = admin.firestore.Query
import QuerySnapshot = firAdmin.firestore.QuerySnapshot
import DocumentReference = firAdmin.firestore.DocumentReference
import WriteResult = firAdmin.firestore.WriteResult
import CollectionReference = firAdmin.firestore.CollectionReference
import FieldValue = firAdmin.firestore.FieldValue
import DocumentSnapshot = firAdmin.firestore.DocumentSnapshot
import * as turf from '@turf/turf'
// import * as sharp from 'sharp';
import * as imagemin from 'imagemin'
const destinationHelpers = require('./destinationHelpers')
const imageminJpegRecompress 	= require('imagemin-jpeg-recompress');
// const spawn = require('child-process-promise').spawn;


const { buildGPX, BaseBuilder } = require('gpx-builder');
const { Point } = BaseBuilder.MODELS;
const { Segment } = BaseBuilder.MODELS;
const { Track } = BaseBuilder.MODELS;

// const { Readable } = require('stream')

const fsClient = new admin.firestore.v1.FirestoreAdminClient();

exports.scheduledFirestoreExport = functions.pubsub.schedule('every 168 hours').onRun((context) => {
  const bucket = 'gs://peaks-backups';
  const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
  const databaseName =
    fsClient.databasePath(projectId, '(default)');

  return fsClient.exportDocuments({
    name: databaseName,
    outputUriPrefix: bucket,
    // Leave collectionIds empty to export all collections
    // or set to a list of collection IDs to export,
    // collectionIds: ['users', 'posts']
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

import fs = require("fs");
import os = require('os');
import stream = require('stream')
// import { Bucket, File } from '@google-cloud/storage';
// import requestPromise = require('request-promise-native');
// import requestPromise = require('request-promise-native');
const path = require('path');
const strava = require('strava-v3')

strava.config({
  "access_token"  : functions.config().strava.access_token,
  "client_id"     : functions.config().strava.client,
  "client_secret" : functions.config().strava.secret,
  "redirect_uri"  : "https://us-central1-donner-a8608.cloudfunctions.net/exchange_token",
});


//import Task = algoliasearch.Task

// The Firebase Admin SDK to access the Firebase Realtime Database.


const firestore = firebase.firestore

const ALGOLIA_ID = functions.config().algolia.app_id;
const ALGOLIA_ADMIN_KEY = functions.config().algolia.api_key;
const ALGOLIA_DESTINATION_INDEX = 'destinations';

const client = algoliasearch(ALGOLIA_ID, ALGOLIA_ADMIN_KEY);
const destinationIndex = client.initIndex(ALGOLIA_DESTINATION_INDEX);

// Listens for new messages added to /messages/:pushId/original and creates an
// uppercase version of the message to /messages/:pushId/uppercase
export const onSessionCreated = functions.firestore.document('/sessions/{sessionId}').onCreate(async (snap, context) => {

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

// Listen for updates to any `user` document.
export const onSessionUpdated = functions.firestore.document('/sessions/{sessionId}').onUpdate(async (change, context) => {
      // Retrieve the current and previous value
      const session = change.after.data();
      const oldSession = change.before.data();

      // We'll only update if the ended status has changed.
      // This is crucial to prevent infinite loops.
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

// avg updates go here
// export async function updateDestinationAverages(reachedIds: Array<string>) {
//   const collectionRef: CollectionReference = await firestore.collection("averages")

//   const promises:Promise<WriteResult>[] = []

//   // reachedIds.forEach(async id => {
//   //   const average: DocumentSnapshot? = await (await collectionRef.where("destinationId", "==", id).get()).docs[0]
//   //   if (!average) {
//   //     return
//   //   }

//   // })
// }

export const onDestinationUpdated = functions.firestore.document('/destinations/{id}').onUpdate(async (change, context) => {
  const algDestination = change.after.data()
  algDestination!.objectID = change.after.id
  algDestination!._geoloc = {
    lat: algDestination!.l![0],
    lng: algDestination!.l![1]
  }

  if (algDestination!.recency) {
    algDestination!.recency = algDestination!.recency!._seconds
  }

  return destinationIndex.saveObject(algDestination!)
})

export const onListUpdated = functions.firestore.document('/lists/{id}').onUpdate(async (change, context) => {
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

export const onListAdded = functions.firestore.document('/lists/{id}').onCreate(async (snap, context) => {
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

export const onDestinationAdded = functions.firestore.document('/destinations/{id}').onCreate(async (snap, context) => {
  const algDestination = snap.data()
  algDestination!.objectID = snap.id
  algDestination!._geoloc = {
    lat: algDestination!.l![0],
    lng: algDestination!.l![1]
  }
  if (algDestination!.recency) {
    algDestination!.recency = algDestination!.recency!._seconds
  }
  return destinationIndex.addObject(algDestination!)
})

export const onDestinationRemoved = functions.firestore.document('/destinations/{id}').onDelete(async (snap, context) => {
  return destinationIndex.deleteObject(snap.id)
})

export const onPointsCreated = functions.firestore.document('/points/{id}').onCreate(async (snap, context) => {
  const id = snap.id

  return uploadGPXIfNeeded(id, snap)
})

export const onPointsUpdated = functions.firestore.document('/points/{id}').onUpdate(async (change, context) => {
  const id = change.after.id

  return uploadGPXIfNeeded(id, change.after)

})

export const uploadSessionToStrava = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
      console.log("no auth!")
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const sessionId = data.sessionId
  const userId = context.auth.uid
  const force: boolean = data.force || false

  const sessionRef = await firestore.collection("sessions").doc(sessionId).get()
  const session = sessionRef.data()
  
  if (session!.userId != userId) {
    console.log("no auth!")
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
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
    //var s = new Readable()
    // s._read = () => {};
    // s.push(gpxString)    // the string you want
    // s.push(null)

    const tempFilePath = path.join(os.tmpdir(), `${sessionId}.gpx`);

    console.log(tempFilePath)


    // const url = "https://www.strava.com/api/v3/uploads"

    // TODO naming logic

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

    const payload = await strava.uploads.post({
      access_token: accessToken,
      activity_type: "hike",
      external_id: sessionId,
      data_type: 'gpx',
      file: tempFilePath,
      name: name
    }, (a,b,c) => {
      console.log(a,b,c)
    });

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

  const url = `https://www.strava.com/oauth/token?client_id=${functions.config().strava.client}&client_secret=${functions.config().strava.secret}&refresh_token=${refreshToken}&grant_type=refresh_token`
  const response = await request.post(url, {})

  interface StravaResponse {
    expires_at: number,
    expires_in: number,
    refresh_token: string,
    access_token: string,
  }

  const stravaResponse: StravaResponse = JSON.parse(response)

  const userRef: DocumentReference = firestore.collection("users").doc(userId)
  await userRef.set({
    strava: stravaResponse
  }, {merge: true})
  return stravaResponse.access_token
}

export async function getPlan(id: string): Promise<DocumentSnapshot> {
  return firestore.collection("plans").doc(id).get()
}

export const linkAnonToPermAccount = functions.https.onCall( async (data, context) => {

    if (!context.auth) {
        console.log("no auth!")
        throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
      'while authenticated.')
    }

    const newUid = context.auth.uid
    const oldUid = data.oldUid

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

export const deleteSession = functions.https.onCall( async (data, context) => {
  if (!context.auth) {
      console.log("no auth!")
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const sessionId = data.sessionId
  const userId = context.auth.uid

  const session: DocumentSnapshot = await firestore.collection("sessions").doc(sessionId)!.get()
  const sessionData = session.data()!

  if (sessionData.userId != userId) {
    throw new functions.https.HttpsError('failed-precondition', 'The user calling this function cannnot delete this session')
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

export const acquireStravaToken = functions.https.onCall( async (data, context) => {
  if (!context.auth) {
      console.log("no auth!")
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const userId = context.auth.uid

  const codeRef: CollectionReference = firestore.collection("codes")

  const codeDec = codeRef.doc();

  await codeDec.set({
    userId: userId,
    reason: "strava",
    expires: Math.floor(Date.now() / 1000) + 1200 // Expires in 20 minutes
  })

  return codeDec.id
})

export const exchange_token = functions.https.onRequest(async (req, res) => {
  const peaksCode = req.query.peaksCode as string
  const url = `https://www.strava.com/oauth/token?client_id=${functions.config().strava.client}&client_secret=${functions.config().strava.secret}&code=${req.query.code}&grant_type=authorization_code`
  const response = await request.post(url, {})



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

  //const collectionRef: CollectionReference = await firestore.collection("destinations")

  res.status(200).send("Aye")
});

export const deletePlan = functions.https.onCall( async (data, context) => {

  if (!context.auth) {
      console.log("no auth!")
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const uid = context.auth.uid
  const pid = data.planId

  const plan: DocumentSnapshot = await getPlan(pid)

  if (plan!.data()!.userId !== uid) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  return plan.ref.delete()

})


export const appleIAPNotification = functions.https.onRequest(async (req, res) => {
  const revenueCatResp = await request.post(`https://api.revenuecat.com/v1/incoming-webhooks/apple-server-to-server-notification/${functions.config().revenuecat.webhook_key}`, {
    json: req.body
  })

  console.log("RevenueCat Resp:")
  console.log(revenueCatResp)

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

export const processAppleReceipt = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
      console.log("no auth!")
      throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
    'while authenticated.')
  }

  const uid = context.auth.uid

  const appleResponse = await verifyAppleReceipt(data!.receipt as string)

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
  let appleResponse = await request.post('https://buy.itunes.apple.com/verifyReceipt', {
    json: {
      "password": functions.config().apple.iap_secret,
      "receipt-data": data
    }
  })

  if (appleResponse!.status === 21007) {
    console.log("Checking sandbox receipt")
    // This is a sandbox receipt, test against the sandbox server
    appleResponse = await request.post('https://sandbox.itunes.apple.com/verifyReceipt', {
      json: {
        "password": functions.config().apple.iap_secret,
        "receipt-data": data
      }
    })
  }

  return appleResponse
}

export const isPremium = functions.https.onCall(async(data, context) => {
  // interface PremiumResponse {
  //   premium: boolean,
  //   expires?: number, // unix time, seconds
  //   method?: string
  // }

  if (!context.auth) {
      console.log("no auth!")
      return {premium: false}
  }

  const uid = context.auth.uid

  const userCollectionRef: DocumentReference = await firestore.collection("users").doc(uid)

  const userDoc: DocumentSnapshot = await userCollectionRef.get()

  // if (!userDoc) {
  //   return {premium: false}
  // }

  if (userDoc?.data()?.premium?.method == "apple") {
    const expires = +(userDoc!.data()!.premium!.receipt!.expires_date_ms)/1000 // We don't want ms
    const renews = userDoc!.data()!.premium!.renews
    const currentTime = Math.floor(Date.now() / 1000)



    return {premium: expires + 3600 > currentTime, method: "apple", expires: expires, renews: renews, receipt: userDoc!.data()!.premium!.receipt}
  } else {
    return {premium: false}
  }
})

exports.updateHeroImage = functions.https.onCall(async(data, context) => {
  console.log("HECK YA")
  const uid = context?.auth?.uid

  const destinationId = data.destinationId as string

  if (!uid) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.')
  }

  if (!destinationId) {
    throw new functions.https.HttpsError('failed-precondition', 'destinationID is required for this function')
  }

  let imgData = data.imgData as string 
  const imgUrl = data.imgUrl as string 

  if (imgUrl) {
    // console.log(imgUrl)
    imgData = await toDataURL(imgUrl) as string
    // console.log(data)

  } else {
    console.log("FUCK")
  }

    // Download file from bucket.
  const fileBucket = "donner-a8608.appspot.com"
  const fileName = `destinations/${destinationId}.jpg`
  // const filePath = `${fileBucket}/${fileName}`
  const bucket = admin.storage().bucket(fileBucket);
  // const file = bucket.file(fileName);

  // const tempFilePath = path.join(os.tmpdir(), fileName);
  // const metadata = {
  //   contentType: "image/jpeg",
  // }

  await uploadPicture(imgData, destinationId, bucket, fileName)

  // let bufferStream = new stream.PassThrough();
  // bufferStream.end(Buffer.from(imgData, 'base64'));

  // bufferStream.pipe(file.createWriteStream({
  //   metadata: {
  //     contentType: 'image/jpeg'
  //   }
  // }))
  // .on('error', error => {
  //   console.log(error)
  // })
  // .on('finish', (file) => {
  //   // The file upload is complete.
  //   console.log("news.provider#uploadPicture - Image successfully uploaded: ", JSON.stringify(file));
  // });

  // const streamRes = await pipeline(
  //   bufferStream.pipe(file.createWriteStream({
  //     metadata: metadata
  //   }))
  // );

  // await file.save(imgData, {
  //   metadata: metadata,
  //   predefinedAcl: 'publicRead'
  // })

  // const urlResponse = await file.getMetadata()
  // const url = urlResponse[0].mediaLink

  // const signedURL = await file.getSignedUrl({
  //   action: 'read',
  //   expires: '03-09-2491'
  // })
  // Once the thumbnail has been uploaded delete the local file to free up disk space.
  // return fs.unlinkSync(tempFilePath);
  // console.log(url)
  // console.log(signedURL)

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

function toDataURL(url) {
  return new Promise((resolve, reject) => {
    request.get({ url, encoding: null }, async function(error, response, body) {
        if (!error && response.statusCode === 200) {
            // const resizedImage = await sharp(body)
            //   .jpeg()
            //   .toBuffer();
            console.log("Original size: " + body.length)

            const imageminOptions = {
              plugins: [
                imageminJpegRecompress({
                  progressive: true,
                  quality: 'high',
                  accuracy: true,
                  target: 0.995,
                  min: 60,
                  max: 95
                })
              ]
            };

            const min = await imagemin.buffer(body, imageminOptions)

            console.log('Prev Size', Math.round(body.toString().length / 1000) + 'KB');
            console.log('New Size', Math.round(min.toString().length / 1000) + 'KB\n');

            console.log("New Size: " + min.length)
            // const data = 'data:' + "image/jpeg" + ';base64,' + new Buffer(min).toString('base64');

            const data = min.toString('base64');
            resolve(data);
            return data;
        } else {
          throw error;
        }
      });
  });
}

const uploadPicture = async (base64: string, destinationId: string, bucket: any, fileName: string) => {
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
      // The file upload is complete.
      resolve(fileResp)
      // console.log("news.provider#uploadPicture - Image successfully uploaded: ", JSON.stringify(file));
    });
  })
};

exports.avyUpdate = functions.pubsub.schedule('every 4 hours').onRun(async (context) => {
  const url = `https://api.avalanche.org/v2/public/products/map-layer`
  const response = await request.get(url, {})

  const avy: DocumentReference = await firestore.collection("updates").doc("avalanche")

  await avy.set({
    "status": response
  }, {merge: true})
});

export const avyData = functions.https.onCall(async (data, context) => {


  const lat = data.lat
  const lng = data.lng

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

exports.friends = require('./friends')

const stravaImport = require('./strava')
exports.getStravaToken = stravaImport.getStravaToken
exports.stravaWebhook = stravaImport.stravaWebhook