import * as admin from 'firebase-admin'
const serviceAccount = require("./admin-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://donner-a8608.firebaseio.com"
});

const firestore = admin.firestore()

exports.admin = admin 
exports.firestore = firestore