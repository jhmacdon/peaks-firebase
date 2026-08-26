import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  console.error("Usage: node scripts/backfill-plan-is-public.mjs [--apply]");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault() });
}

const firestore = getFirestore();
const plans = await firestore.collection("plans").get();
const targets = plans.docs.filter((plan) => typeof plan.data().isPublic !== "boolean");

console.log(`Found ${plans.size} plans; ${targets.length} need isPublic=false.`);

if (!apply || targets.length === 0) {
  console.log(apply ? "Nothing to update." : "Dry run only. Re-run with --apply to update plans.");
  process.exit(0);
}

for (let index = 0; index < targets.length; index += 450) {
  const batch = firestore.batch();
  for (const plan of targets.slice(index, index + 450)) {
    batch.update(plan.ref, { isPublic: false });
  }
  await batch.commit();
}

console.log(`Set isPublic=false on ${targets.length} plans.`);
