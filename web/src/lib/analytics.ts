/**
 * Petrics: our own analytics service, hosted in our Google Cloud.
 *
 * Browser only. The client starts on first use, once, and stays off on the
 * server, in tests, under browser automation, and when the build has no
 * source key. Analytics calls never throw into the app.
 */

import { createPetrics, type Petrics } from "@petrics/client";
import { canCollectAnalytics, createAnalytics, petricsOptions } from "./analytics-core";

let client: Petrics | null = null;
let started = false;

function getPetrics(): Petrics | null {
  if (started) return client;
  // Stay unstarted on the server so the first browser call can still start it.
  if (typeof window === "undefined") return null;
  started = true;
  const options = petricsOptions(
    {
      // Spelled out in full so Next inlines them into the client bundle.
      sourceKey: process.env.NEXT_PUBLIC_PETRICS_SOURCE_KEY,
      endpoint: process.env.NEXT_PUBLIC_PETRICS_ENDPOINT,
    },
    canCollectAnalytics(),
  );
  if (!options) return null;
  try {
    client = createPetrics(options);
  } catch {
    client = null;
  }
  return client;
}

const analytics = createAnalytics(getPetrics, () =>
  typeof window === "undefined"
    ? null
    : { title: document.title, referrer: document.referrer, host: window.location.host },
);

export const { track, identify, reset, resetIfIdentified, pageView } = analytics;
