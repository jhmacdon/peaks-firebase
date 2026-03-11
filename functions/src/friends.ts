import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as firAdmin from 'firebase-admin'
import DocumentSnapshot = firAdmin.firestore.DocumentSnapshot
import DocumentReference = firAdmin.firestore.DocumentReference
import QuerySnapshot = firAdmin.firestore.QuerySnapshot
import QueryDocumentSnapshot = firAdmin.firestore.QueryDocumentSnapshot
import FieldValue = firAdmin.firestore.FieldValue
import { UserProfile, UserDocument } from "./friendsTypes"

const firebase = require('./firebase')
const admin = firebase.admin
const firestore = admin.firestore()

exports.acceptInvite = onCall(async (request) => {
    const uid = request.auth?.uid
    const inviteCode: string = request.data.invite

    if (!uid) {
        throw new HttpsError('failed-precondition', 'The function must be called while authenticated.')
    }

    const inviteDoc: DocumentSnapshot = await firestore.collection("invites").doc(inviteCode).get()

    const otherUser: string = inviteDoc.data()!.userId

    const friendDoc: DocumentReference = firestore.collection("friends").doc()

    if (otherUser === uid) {
        throw new HttpsError('failed-precondition', 'Cannot accept own invite code')
    }

    if (otherUser === undefined || otherUser === "") {
        throw new HttpsError('failed-precondition', 'Could not find user from invite code')
    }

    const friendsDocs: QuerySnapshot = await (await firestore.collection("friends").where("users", "array-contains", uid).where("users", "array-contains", otherUser).get())

    if (friendsDocs.docs.length > 0) {
        throw new HttpsError('failed-precondition', 'Users are already friends')
    }

    await friendDoc.set({
        "users": [uid, otherUser],
        "createdAt": new Date()
    })

    return getProfile(otherUser)
})

exports.acceptPlanInvite = onCall(async (request) => {
    const uid = request.auth?.uid
    if (!uid) { throw new HttpsError('failed-precondition', 'The function must be called while authenticated.') }
    const inviteCode: string = request.data.invite
    if (!inviteCode) { throw new HttpsError('failed-precondition', 'Invite code required') }
    const accepterProfile: UserProfile = (await getProfile(uid))!


    const inviteDoc: DocumentSnapshot = await firestore.collection("invites").doc(inviteCode).get()
    const planId = inviteDoc.data()?.planId
    if (!planId) { throw new HttpsError('failed-precondition', 'No plan found for the invite code specified') }
    const planDoc: DocumentSnapshot = await firestore.collection("plans").doc(planId).get()

    await planDoc.ref.update({
        party: FieldValue.arrayUnion(uid)
    })

    await sendPush(planDoc.data()!.userId, `${accepterProfile.name.first} ${accepterProfile.name.last} has joined your plan`, `Open to view plan`, accepterProfile.avatar, `https://peaksapp.com/plan/${planId}`)

    return planId
})

exports.removeFromPlan = onCall(async (request) => {
    const requesterId = request.auth?.uid
    const targetId = request.data.uid
    const planId = request.data.planId
    if (!requesterId || !targetId || !planId) { throw new HttpsError('failed-precondition', 'The function must be called while authenticated.') }

    const planRef: DocumentReference = firestore.collection("plans").doc(planId)
    return planRef.update({
        party: FieldValue.arrayRemove(targetId)
    })
})

exports.listFriends = onCall(async (request) => {
    const uid = request.auth?.uid
    if (!uid) {
        throw new HttpsError('failed-precondition', 'The function must be called while authenticated.')
    }

    const promises: Promise<UserProfile | undefined>[] = []

    const friendsDocs: QuerySnapshot = await (await firestore.collection("friends").where("users", "array-contains", uid).get())

    friendsDocs.docs.forEach((friend: QueryDocumentSnapshot) => {
        const u1 = friend.data()?.users[0]
        const u2 = friend.data()?.users[1]

        if (u1 == uid) {
            console.log("Adding " + u2)
            promises.push(getProfile(u2))
        } else if (u2 == uid) {
            console.log("Adding " + u1)
            promises.push(getProfile(u1))
        }
    })

    const friends: Array<UserProfile | undefined> = await Promise.all(promises)
    console.log("fuck")
    console.log(friends)
    return friends.filter(friend => friend !== undefined)
})

exports.getProfiles = onCall(async (request) => {
    const ids: string[] = (request.data.ids as string).split(",")
    const promises: Promise<UserProfile | undefined>[] = []

    ids.forEach((id: string) => {
        promises.push(getProfile(id))
    })

    return Promise.all(promises)
})

async function sendPush(userId: string, title: string, body: string, icon?: string, clickAction?: string) {
    const doc = await getUserDoc(userId)

    if (!doc.tokens || doc.tokens?.length < 1) {
        console.log("No tokens found for user")
        return
    }

    const messages = doc.tokens.map(token => {
        const msg: any = {
            token: token,
            notification: {
                title: title,
                body: body
            }
        }

        if (icon) {
            msg.notification.icon = icon
        }

        if (clickAction) {
            msg.notification.link = clickAction
            msg.data = { url: clickAction }
        }

        return msg
    })

    await admin.messaging().sendEach(messages)
}

async function getProfile(id: string): Promise<UserProfile | undefined> {
    const doc: UserDocument = await getUserDoc(id)
    return doc.profile
}

async function getUserDoc(id: string): Promise<UserDocument> {
    const doc: DocumentSnapshot = await ((await firestore.collection("users").doc(id)).get())
    const response: UserDocument = {
        id: id,
        profile: {
            id: id,
            name: {
                first: doc.data()!.profile.name.first,
                last: doc.data()!.profile.name.last,
            },
            avatar: doc.data()?.profile?.avatar
        },
        tokens: doc.data()?.tokens
    }

    return response
}
