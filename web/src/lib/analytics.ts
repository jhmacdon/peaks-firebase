/**
 * Petrics: our own analytics service, hosted in our Google Cloud.
 *
 * Browser only. The client starts on first use, once, and stays off on the
 * server, in tests, under browser automation, and when the build has no
 * source key. Analytics calls never throw into the app.
 */

import { createPetrics, type Petrics, type Properties } from "@petrics/client";
import { canCollectAnalytics, pageViewProperties, pathOnly, petricsOptions } from "./analytics-core";

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

function run(operation: (petrics: Petrics) => void): void {
  const petrics = getPetrics();
  if (!petrics) return;
  try {
    operation(petrics);
  } catch {
    // Dropped on purpose: a failed analytics call must not reach the UI.
  }
}

export function track(event: string, properties?: Properties): void {
  run((petrics) => petrics.track(event, properties));
}

/** Ties later events to a Firebase UID. A different user first gets a fresh anonymous ID. */
export function identify(userId: string): void {
  run((petrics) => {
    if (petrics.userId === userId) return;
    if (petrics.userId !== undefined) petrics.reset();
    petrics.identify(userId);
  });
}

/** Forgets the user and starts a new anonymous ID. Call on sign-out. */
export function reset(): void {
  run((petrics) => petrics.reset());
}

/**
 * Resets only when a user is still identified. Auth listeners call this on
 * every signed-out state, so a signed-out visitor keeps one anonymous ID
 * across page loads, while a sign-out from another tab still clears the user.
 */
export function resetIfIdentified(): void {
  run((petrics) => {
    if (petrics.userId !== undefined) petrics.reset();
  });
}

let lastPagePath: string | undefined;

/**
 * Tracks `Page Viewed`. The first view takes its referrer from
 * `document.referrer`; later in-app views name this site's host, as a full
 * page load would.
 */
export function pageView(path: string): void {
  if (typeof window === "undefined") return;
  const cleanPath = pathOnly(path);
  // React runs effects twice in development; one route change is one view.
  if (cleanPath === lastPagePath) return;
  const referrer = lastPagePath === undefined ? document.referrer : window.location.href;
  lastPagePath = cleanPath;
  track("Page Viewed", pageViewProperties(cleanPath, document.title, referrer));
}
