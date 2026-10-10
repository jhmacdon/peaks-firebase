/**
 * Pure helpers for `analytics.ts`. They live apart from the Petrics client so
 * `node --test` can load them: the vendored client ships as ESM only.
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
  if (process.env.NODE_ENV === "test") return false;
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
