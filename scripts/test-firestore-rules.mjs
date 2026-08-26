const projectId = process.env.GCLOUD_PROJECT || "peaks-rules-test";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreHost =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const firestoreBase = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;

async function signUp(label) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${label}-${Date.now()}@example.com`,
        password: "rules-test-password",
        returnSecureToken: true,
      }),
    }
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Could not create ${label}: ${JSON.stringify(body)}`);
  }
  return { uid: body.localId, token: body.idToken };
}

async function request(path, { method = "GET", token, fields } = {}) {
  return fetch(`${firestoreBase}/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fields ? { "Content-Type": "application/json" } : {}),
    },
    body: fields ? JSON.stringify({ fields }) : undefined,
  });
}

async function expectStatus(label, response, expected) {
  if (response.status === expected) return;
  const body = await response.text();
  throw new Error(
    `${label}: expected ${expected}, received ${response.status}: ${body}`
  );
}

const owner = await signUp("owner");
const attacker = await signUp("attacker");
const partyMember = await signUp("party-member");

const privatePlanPath = "plans/private-plan";
const privatePlanFields = {
  userId: { stringValue: owner.uid },
  name: { stringValue: "Private route" },
  party: { arrayValue: { values: [{ stringValue: partyMember.uid }] } },
};
await expectStatus(
  "owner can create private route",
  await request(privatePlanPath, {
    method: "PATCH",
    token: owner.token,
    fields: privatePlanFields,
  }),
  200
);
await expectStatus(
  "anonymous cannot read private route",
  await request(privatePlanPath),
  403
);
await expectStatus(
  "attacker cannot read private route",
  await request(privatePlanPath, { token: attacker.token }),
  403
);
await expectStatus(
  "party member can read private route",
  await request(privatePlanPath, { token: partyMember.token }),
  200
);
await expectStatus(
  "party member cannot publish private route",
  await request(privatePlanPath, {
    method: "PATCH",
    token: partyMember.token,
    fields: {
      ...privatePlanFields,
      isPublic: { booleanValue: true },
    },
  }),
  403
);
await expectStatus(
  "owner can publish route",
  await request(privatePlanPath, {
    method: "PATCH",
    token: owner.token,
    fields: {
      ...privatePlanFields,
      isPublic: { booleanValue: true },
    },
  }),
  200
);
await expectStatus(
  "anonymous cannot read raw public route document",
  await request(privatePlanPath),
  403
);
await expectStatus(
  "party member can still read published route document",
  await request(privatePlanPath, { token: partyMember.token }),
  200
);

const privateRoutePath = "routes/private-route";
const privateRouteFields = {
  owner: { stringValue: owner.uid },
  name: { stringValue: "Owner route geometry" },
};
await expectStatus(
  "owner can create route geometry",
  await request(privateRoutePath, {
    method: "PATCH",
    token: owner.token,
    fields: privateRouteFields,
  }),
  200
);
await expectStatus(
  "anonymous cannot read private route geometry",
  await request(privateRoutePath),
  403
);
await expectStatus(
  "attacker cannot read private route geometry",
  await request(privateRoutePath, { token: attacker.token }),
  403
);
await expectStatus(
  "owner can read route geometry",
  await request(privateRoutePath, { token: owner.token }),
  200
);
await expectStatus(
  "attacker cannot publish route geometry",
  await request(privateRoutePath, {
    method: "PATCH",
    token: attacker.token,
    fields: {
      ...privateRouteFields,
      isPublic: { booleanValue: true },
    },
  }),
  403
);
await expectStatus(
  "owner can publish route geometry",
  await request(privateRoutePath, {
    method: "PATCH",
    token: owner.token,
    fields: {
      ...privateRouteFields,
      isPublic: { booleanValue: true },
    },
  }),
  200
);
await expectStatus(
  "anonymous cannot read raw user route geometry after publish",
  await request(privateRoutePath),
  403
);

const sessionPath = "sessions/private-session";
const privateSessionFields = {
  userId: { stringValue: owner.uid },
  name: { stringValue: "Private activity" },
  status: {
    mapValue: {
      fields: {
        public: { booleanValue: false },
      },
    },
  },
};
await expectStatus(
  "owner can create private activity",
  await request(sessionPath, {
    method: "PATCH",
    token: owner.token,
    fields: privateSessionFields,
  }),
  200
);
await expectStatus(
  "anonymous cannot read private activity",
  await request(sessionPath),
  403
);
await expectStatus(
  "attacker cannot read private activity",
  await request(sessionPath, { token: attacker.token }),
  403
);
await expectStatus(
  "owner can read private activity",
  await request(sessionPath, { token: owner.token }),
  200
);

const pointsPath = "points/private-session";
await expectStatus(
  "owner can create activity points",
  await request(pointsPath, {
    method: "PATCH",
    token: owner.token,
    fields: {
      sessionId: { stringValue: "private-session" },
      points: { arrayValue: { values: [] } },
    },
  }),
  200
);
await expectStatus(
  "attacker cannot read private activity points",
  await request(pointsPath, { token: attacker.token }),
  403
);
await expectStatus(
  "attacker cannot write activity points",
  await request(pointsPath, {
    method: "PATCH",
    token: attacker.token,
    fields: {
      sessionId: { stringValue: "private-session" },
      points: { arrayValue: { values: [] } },
    },
  }),
  403
);
await expectStatus(
  "owner can publish activity",
  await request(sessionPath, {
    method: "PATCH",
    token: owner.token,
    fields: {
      ...privateSessionFields,
      status: {
        mapValue: {
          fields: {
            public: { booleanValue: true },
          },
        },
      },
    },
  }),
  200
);
await expectStatus(
  "anonymous cannot read raw public activity document",
  await request(sessionPath),
  403
);
await expectStatus(
  "anonymous cannot read raw public activity points",
  await request(pointsPath),
  403
);
await expectStatus(
  "owner can still read published activity",
  await request(sessionPath, { token: owner.token }),
  200
);
await expectStatus(
  "owner can still read published activity points",
  await request(pointsPath, { token: owner.token }),
  200
);

const reportPath = "tripReports/owner-report";
const reportFields = {
  userId: { stringValue: owner.uid },
  title: { stringValue: "Owner report" },
};

await expectStatus(
  "owner can create report",
  await request(reportPath, {
    method: "PATCH",
    token: owner.token,
    fields: reportFields,
  }),
  200
);
await expectStatus("public can read report", await request(reportPath), 200);
await expectStatus(
  "attacker cannot update owner report",
  await request(reportPath, {
    method: "PATCH",
    token: attacker.token,
    fields: {
      ...reportFields,
      title: { stringValue: "Taken over" },
    },
  }),
  403
);
await expectStatus(
  "attacker cannot change report owner",
  await request(reportPath, {
    method: "PATCH",
    token: attacker.token,
    fields: {
      ...reportFields,
      userId: { stringValue: attacker.uid },
    },
  }),
  403
);
await expectStatus(
  "owner can update report",
  await request(reportPath, {
    method: "PATCH",
    token: owner.token,
    fields: {
      ...reportFields,
      title: { stringValue: "Owner edit" },
    },
  }),
  200
);
await expectStatus(
  "attacker cannot delete owner report",
  await request(reportPath, {
    method: "DELETE",
    token: attacker.token,
  }),
  403
);

const savedPath = `users/${owner.uid}/savedDestinations/destination-1`;
const savedFields = {
  savedAt: { timestampValue: new Date().toISOString() },
  deleted: { booleanValue: false },
};
await expectStatus(
  "owner can save destination",
  await request(savedPath, {
    method: "PATCH",
    token: owner.token,
    fields: savedFields,
  }),
  200
);
await expectStatus(
  "owner can read saved destination",
  await request(savedPath, { token: owner.token }),
  200
);
await expectStatus(
  "attacker cannot read saved destination",
  await request(savedPath, { token: attacker.token }),
  403
);
await expectStatus(
  "attacker cannot overwrite saved destination",
  await request(savedPath, {
    method: "PATCH",
    token: attacker.token,
    fields: savedFields,
  }),
  403
);

const placePath = `users/${owner.uid}/savedPlaces/camp-1`;
const placeFields = {
  id: { stringValue: "camp-1" },
  deleted: { booleanValue: false },
  updatedAt: { timestampValue: new Date().toISOString() },
};
await expectStatus(
  "owner can create saved place",
  await request(placePath, {
    method: "PATCH",
    token: owner.token,
    fields: placeFields,
  }),
  200
);
await expectStatus(
  "owner can read saved place",
  await request(placePath, { token: owner.token }),
  200
);
await expectStatus(
  "attacker cannot read saved place",
  await request(placePath, { token: attacker.token }),
  403
);
await expectStatus(
  "attacker cannot overwrite saved place",
  await request(placePath, {
    method: "PATCH",
    token: attacker.token,
    fields: placeFields,
  }),
  403
);

const userPath = `users/${owner.uid}`;
await expectStatus(
  "owner can update profile",
  await request(userPath, {
    method: "PATCH",
    token: owner.token,
    fields: { name: { stringValue: "Owner" } },
  }),
  200
);
await expectStatus(
  "attacker cannot update owner profile",
  await request(userPath, {
    method: "PATCH",
    token: attacker.token,
    fields: { name: { stringValue: "Attacker" } },
  }),
  403
);

await expectStatus(
  "owner can delete report",
  await request(reportPath, {
    method: "DELETE",
    token: owner.token,
  }),
  200
);

console.log("Firestore ownership rules passed");
