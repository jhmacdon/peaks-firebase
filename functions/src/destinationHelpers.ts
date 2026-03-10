import * as firAdmin from 'firebase-admin'
import DocumentSnapshot = firAdmin.firestore.DocumentSnapshot
const firebase = require('./firebase')
const admin = firebase.admin
import CollectionReference = firAdmin.firestore.CollectionReference
const firestore = admin.firestore()


export async function getDestinations(ids: string[]): Promise<DocumentSnapshot[]> {
    const collectionRef: CollectionReference = await firestore.collection("destinations")
  
    const promises:Promise<DocumentSnapshot>[] = []
  
    ids.forEach(id => {
      promises.push(collectionRef.doc(id).get())
    });
  
    return Promise.all(promises)
}

export async function getDestination(id: string): Promise<DocumentSnapshot> {
    return firestore.collection("destinations").doc(id).get()
}

export async function getDestinationWeather(destinationId: string): Promise<DocumentSnapshot> {
  const docResults = await (await firestore.collection("weather").where("destinationId", "==", destinationId).limit(1).get()).docs
  return docResults[0]
}