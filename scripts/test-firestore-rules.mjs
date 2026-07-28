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
