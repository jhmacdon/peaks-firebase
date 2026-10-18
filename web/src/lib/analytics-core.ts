/**
 * The logic behind `analytics.ts`, kept apart from the Petrics client so
 * `node --test` can load it: the vendored client ships as ESM only. Tests
 * pass a fake client to `createAnalytics`.
 */

import type { PetricsOptions, Properties } from "@petrics/client";

export interface PetricsEnv {
  sourceKey?: string;
  endpoint?: string;
}

/** Builds client options, or null when Petrics should stay off. */
export function petricsOptions(env: PetricsEnv, canCollect: boolean): PetricsOptions | null {
  const sourceKey = env.sourceKey?.trim();
  if (!canCollect || !sourceKey) return null;
  const endpoint = env.endpoint?.trim();
  return endpoint
    ? { sourceKey, endpoint, platform: "web" }
    : { sourceKey, platform: "web" };
}

/** True only in a real browser that isn't driven by tests or automation. */
export function canCollectAnalytics(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  // Playwright, Selenium and other e2e drivers set this.
  return navigator.webdriver !== true;
}

/** Strips the query string and fragment, which can hold personal data. */
export function pathOnly(path: string): string {
  const end = path.search(/[?#]/);
  const stripped = end === -1 ? path : path.slice(0, end);
  return stripped || "/";
}

/** The referrer's host alone, or undefined when it is empty or not a URL. */
export function referrerHost(referrer: string): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).host || undefined;
  } catch {
    return undefined;
  }
}

export function pageViewProperties(path: string, title: string, referrer: string): Properties {
  const properties: Properties = { path: pathOnly(path) };
  if (title) properties.title = title;
  const host = referrerHost(referrer);
  if (host) properties.referrer_host = host;
  return properties;
}

/** The part of the Petrics client the wrapper uses. */
export interface AnalyticsClient {
  readonly anonymousId: string;
  readonly userId: string | undefined;
  track(event: string, properties?: Properties): void;
  identify(userId: string): void;
  reset(): void;
}

/** What `pageView` reads from the page. */
export interface PageInfo {
  title: string;
  /** `document.referrer`, used for the first view only. */
  referrer: string;
  /** This site's host, the referrer of every in-app navigation. */
  host: string;
}

export interface Analytics {
  track(event: string, properties?: Properties): void;
  identify(userId: string): void;
  reset(): void;
  resetIfIdentified(): void;
  pageView(path: string): void;
}

/**
 * Builds the wrapper over a client getter. The getter returns null when
 * analytics is off; then every call does nothing. Calls never throw.
 */
export function createAnalytics(
  getClient: () => AnalyticsClient | null,
  getPage: () => PageInfo | null,
): Analytics {
  const run = (operation: (client: AnalyticsClient) => void): void => {
    const client = getClient();
    if (!client) return;
    try {
      operation(client);
    } catch {
      // Dropped on purpose: a failed analytics call must not reach the UI.
    }
  };
  let lastPagePath: string | undefined;

  return {
    track(event, properties) {
      run((client) => client.track(event, properties));
    },

    /** Ties later events to a Firebase UID. A different user first gets a fresh anonymous ID. */
    identify(userId) {
      run((client) => {
        if (client.userId === userId) return;
        if (client.userId !== undefined) client.reset();
        client.identify(userId);
      });
    },

    /** Forgets the user and starts a new anonymous ID. Call on sign-out. */
    reset() {
      run((client) => client.reset());
    },

    /**
     * Resets only when a user is still identified. Auth listeners call this
     * on every signed-out state, so a signed-out visitor keeps one anonymous
     * ID across page loads, while a sign-out from another tab still clears
     * the user.
     */
    resetIfIdentified() {
      run((client) => {
        if (client.userId !== undefined) client.reset();
      });
    },

    /**
     * Tracks `Page Viewed`. The first view takes its referrer from
     * `document.referrer`; later in-app views name this site's host, as a
     * full page load would.
     */
    pageView(path) {
      const page = getPage();
      if (!page) return;
      const cleanPath = pathOnly(path);
      // React runs effects twice in development; one route change is one view.
      if (cleanPath === lastPagePath) return;
      const referrer = lastPagePath === undefined ? page.referrer : `https://${page.host}`;
      lastPagePath = cleanPath;
      run((client) => client.track("Page Viewed", pageViewProperties(cleanPath, page.title, referrer)));
    },
  };
}
