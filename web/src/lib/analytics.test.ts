import assert from "node:assert/strict";
import test from "node:test";
import {
  type AnalyticsClient,
  type PageInfo,
  canCollectAnalytics,
  createAnalytics,
  pageViewProperties,
  pathOnly,
  petricsOptions,
  referrerHost,
} from "./analytics-core";

test("Petrics stays off without a source key", () => {
  assert.equal(petricsOptions({}, true), null);
  assert.equal(petricsOptions({ sourceKey: "  " }, true), null);
});

test("Petrics stays off when collection is not allowed", () => {
  assert.equal(petricsOptions({ sourceKey: "ptr_v1_key" }, false), null);
});

test("Petrics builds web options from the env", () => {
  assert.deepEqual(petricsOptions({ sourceKey: " ptr_v1_key " }, true), {
    sourceKey: "ptr_v1_key",
    platform: "web",
  });
  assert.deepEqual(
    petricsOptions({ sourceKey: "ptr_v1_key", endpoint: "https://collector.example" }, true),
    { sourceKey: "ptr_v1_key", endpoint: "https://collector.example", platform: "web" },
  );
});

test("Petrics never collects outside a browser", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(canCollectAnalytics(), false);
});

test("pageView properties drop the query string and fragment", () => {
  assert.equal(pathOnly("/lists/abc?email=a@b.c#top"), "/lists/abc");
  assert.equal(pathOnly("/routes/r1#map"), "/routes/r1");
  assert.equal(pathOnly("?q=1"), "/");
  assert.deepEqual(
    pageViewProperties("/discover?q=me@example.com", "Discover | Peaks", ""),
    { path: "/discover", title: "Discover | Peaks" },
  );
});

test("pageView properties keep only the referrer host", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=mount+rainier"), "www.google.com");
  assert.equal(referrerHost("http://localhost:3000/login?next=/log"), "localhost:3000");
  assert.equal(referrerHost(""), undefined);
  assert.equal(referrerHost("not a url"), undefined);
  assert.deepEqual(
    pageViewProperties("/map", "", "https://news.ycombinator.com/item?id=1"),
    { path: "/map", referrer_host: "news.ycombinator.com" },
  );
});

interface SentEvent {
  event: string;
  anonymous_id: string;
  user_id: string | undefined;
  properties: Record<string, unknown>;
}

/**
 * Acts like the Petrics client's identity rules: identify keeps the anonymous
 * ID and adds the user; reset clears the user and starts a new anonymous ID.
 * The state outlives one wrapper, as localStorage outlives a page load.
 */
class FakeClient implements AnalyticsClient {
  anonymousId = "anon-1";
  userId: string | undefined;
  resets = 0;
  readonly sent: SentEvent[] = [];

  track(event: string, properties: Record<string, unknown> = {}): void {
    this.sent.push({ event, anonymous_id: this.anonymousId, user_id: this.userId, properties });
  }

  identify(userId: string): void {
    this.userId = userId;
  }

  reset(): void {
    this.resets += 1;
    this.userId = undefined;
    this.anonymousId = `anon-${this.resets + 1}`;
  }
}

const page: PageInfo = { title: "Peaks", referrer: "https://www.google.com/search?q=peaks", host: "getpeaks.app" };

/** Mirrors auth-context.tsx: identify, then Signed In. */
function signIn(analytics: ReturnType<typeof createAnalytics>, uid: string): void {
  analytics.identify(uid); // onAuthStateChanged
  analytics.identify(uid); // trackSignedIn
  analytics.track("Signed In", { method: "email", new_user: false });
}

/** Mirrors auth-context.tsx: Signed Out, reset, then the listener sees null. */
function signOut(analytics: ReturnType<typeof createAnalytics>): void {
  analytics.track("Signed Out");
  analytics.reset();
  analytics.resetIfIdentified(); // onAuthStateChanged(null)
}

test("identity follows anonymous visit, sign-in, sign-out, and a second user", () => {
  const client = new FakeClient();
  const analytics = createAnalytics(() => client, () => page);

  analytics.resetIfIdentified(); // signed-out visitor: listener fires with null
  analytics.pageView("/discover");
  analytics.pageView("/lists");
  signIn(analytics, "uid-a");
  analytics.pageView("/log");
  signOut(analytics);
  analytics.pageView("/discover");
  signIn(analytics, "uid-b");
  analytics.pageView("/plans");

  assert.deepEqual(
    client.sent.map((e) => [e.event, e.anonymous_id, e.user_id]),
    [
      ["Page Viewed", "anon-1", undefined],
      ["Page Viewed", "anon-1", undefined],
      ["Signed In", "anon-1", "uid-a"],
      ["Page Viewed", "anon-1", "uid-a"],
      ["Signed Out", "anon-1", "uid-a"],
      ["Page Viewed", "anon-2", undefined],
      ["Signed In", "anon-2", "uid-b"],
      ["Page Viewed", "anon-2", "uid-b"],
    ],
  );
  // Sign-out resets once; the null auth state after it finds nothing to clear.
  assert.equal(client.resets, 1);
  const secondUser = client.sent.slice(5);
  assert.ok(secondUser.every((e) => e.user_id !== "uid-a" && e.anonymous_id !== "anon-1"));
});

test("switching users with no sign-out in between starts a fresh anonymous ID", () => {
  const client = new FakeClient();
  const analytics = createAnalytics(() => client, () => page);
  signIn(analytics, "uid-a");
  signIn(analytics, "uid-b");
  const last = client.sent.at(-1)!;
  assert.equal(last.user_id, "uid-b");
  assert.equal(last.anonymous_id, "anon-2");
});

test("resetIfIdentified keeps a signed-out visitor's anonymous ID across loads", () => {
  const client = new FakeClient();
  for (let load = 0; load < 3; load += 1) {
    const analytics = createAnalytics(() => client, () => page);
    analytics.resetIfIdentified();
    analytics.pageView("/discover");
  }
  assert.equal(client.resets, 0);
  assert.deepEqual(new Set(client.sent.map((e) => e.anonymous_id)), new Set(["anon-1"]));
});

test("resetIfIdentified clears a user signed out in another tab", () => {
  const client = new FakeClient();
  client.identify("uid-a");
  createAnalytics(() => client, () => page).resetIfIdentified();
  assert.equal(client.userId, undefined);
  assert.equal(client.anonymousId, "anon-2");
});

test("pageView sends one view per route and names the right referrer host", () => {
  const client = new FakeClient();
  const analytics = createAnalytics(() => client, () => page);
  analytics.pageView("/discover?q=me@example.com");
  analytics.pageView("/discover"); // React dev runs the effect twice
  analytics.pageView("/map");
  assert.deepEqual(
    client.sent.map((e) => e.properties),
    [
      { path: "/discover", title: "Peaks", referrer_host: "www.google.com" },
      { path: "/map", title: "Peaks", referrer_host: "getpeaks.app" },
    ],
  );
});

test("every call does nothing when analytics is off", () => {
  const analytics = createAnalytics(() => null, () => page);
  assert.doesNotThrow(() => {
    analytics.track("Signed In", { method: "email" });
    analytics.identify("uid-a");
    analytics.pageView("/discover");
    analytics.resetIfIdentified();
    analytics.reset();
  });
});

test("a throwing client never reaches the caller", () => {
  const client = new FakeClient();
  client.track = () => {
    throw new Error("storage full");
  };
  const analytics = createAnalytics(() => client, () => page);
  assert.doesNotThrow(() => analytics.track("Signed Out"));
});
