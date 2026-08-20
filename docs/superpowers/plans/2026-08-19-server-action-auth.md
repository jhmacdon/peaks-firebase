# Server-Side Authorization for Server Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side Firebase ID token verification to the Next.js server actions and Cloud Run plan endpoints that today trust the client-side guard alone.

**Architecture:** Web server actions gain a `token` first parameter, verified with the existing `verifyToken()` pattern (`src/lib/auth-actions.ts`); admin actions use a new `verifyAdminToken()` that also requires the `admin` custom claim. Personal-data actions derive the user ID from the verified token instead of accepting it as an argument. The three Cloud Run plan child endpoints add the same owner-or-party-member `EXISTS` clause the sibling `/:id/reached-destinations` endpoint already uses.

**Tech Stack:** Next.js 16 server actions, firebase-admin, Express (Cloud Run API), node:test.

**Spec:** Read-only Codex audit findings (2026-08-19), restated in full:

1. Admin actions accept no token or admin claim: `updateDestination` (`web/src/lib/actions/destinations.ts`), route accept/reject/save, and all admin session reads (`web/src/lib/actions/admin-sessions.ts`). The admin session actions expose private user IDs, activity metadata, and GPS points.
2. `getListProgress(listId, userId)` (`web/src/lib/actions/lists.ts`) and `getUnclimbedDestinations` (`web/src/lib/actions/search.ts`) accept arbitrary user IDs without a token.
3. `getUser(uid)` (`web/src/lib/actions/users.ts`) returns email and profile data for arbitrary UIDs with no caller check.
4. Cloud Run plan child endpoints `/plans/:id/destinations`, `/plans/:id/routes`, `/plans/:id/party` (`cloud-sql/api/src/routes/plans.ts`) verify a signed-in caller but not plan ownership/membership.

Fix: pass and verify a Firebase ID token (admin claim for admin actions; caller identity must match for personal-data actions; plan membership for the plan endpoints). Keep changes minimal and mechanical; update callers to pass the token.

## Global Constraints

- Repo: `/Users/josiahm/projects/peaks/firebase` (execute in an isolated worktree off `main`; the main checkout is dirty on another branch).
- Web verification: `cd web && npm run build && npm run lint` — zero errors required (web has no test script; the two `.test.ts` files there are run ad hoc, not in CI).
- API verification: `cd cloud-sql/api && npm run build && npm test && npm run lint`.
- Existing convention: token is the FIRST parameter of authenticated server actions; failure throws `new Error("Unauthorized")` (see `web/src/lib/actions/sessions.ts:96`).
- Clients get tokens via `const { getIdToken } = useAuth()` then `await getIdToken()` (returns `string | null`).
- All admin pages are wrapped in `AdminGuard`, so `getIdToken()` returning null there is a type-narrowing case, not a real flow: bail out of the handler silently.
- Do NOT touch admin actions the audit did not name (e.g. `createDestination`, `bulkImportDestinations`, boundary/geocode actions, route-import actions) — they are a tracked follow-up. Exception: `updateRoute` IS in scope (same page and same handler file as accept/reject; see Task 4).
- Orwell rules for any prose (commit messages, doc edits): short words, active voice, cut every needless word.

---

### Task 1: `verifyAdminToken` helper

**Files:**
- Modify: `web/src/lib/auth-actions.ts`

**Interfaces:**
- Consumes: existing `adminAuth` from `web/src/lib/firebase-admin.ts`.
- Produces: `verifyAdminToken(token: string): Promise<{ uid: string } | null>` — returns null unless the token is valid AND carries `admin === true` custom claim. Tasks 2–4 import it as `import { verifyAdminToken } from "../auth-actions";`.

- [ ] **Step 1: Add the helper**

Append to `web/src/lib/auth-actions.ts` (file already has `"use server"` and imports `adminAuth`):

```ts
export async function verifyAdminToken(
  token: string
): Promise<{ uid: string } | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.admin === true ? { uid: decoded.uid } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors (pre-existing errors, if any, are unchanged).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth-actions.ts
git commit -m "web: add verifyAdminToken helper"
```

---

### Task 2: Admin session reads require an admin token

**Files:**
- Modify: `web/src/lib/actions/admin-sessions.ts` (4 exported functions)
- Modify: `web/src/app/admin/sessions/page.tsx`
- Modify: `web/src/app/admin/sessions/[id]/page.tsx`

**Interfaces:**
- Consumes: `verifyAdminToken` from Task 1.
- Produces: new signatures — `getAdminSessions(token: string, search?, limit?, offset?, sort?, filters?)`, `getAdminSession(token: string, sessionId: string)`, `getAdminSessionPoints(token: string, sessionId: string)`, `getAdminSessionDestinations(token: string, sessionId: string)`.

- [ ] **Step 1: Gate the four actions**

In `web/src/lib/actions/admin-sessions.ts`, add the import:

```ts
import { verifyAdminToken } from "../auth-actions";
```

Add `token: string` as the new first parameter of `getAdminSessions`, `getAdminSession`, `getAdminSessionPoints`, and `getAdminSessionDestinations` (existing parameters and defaults unchanged), and insert as the first two lines of each body:

```ts
  const admin = await verifyAdminToken(token);
  if (!admin) throw new Error("Unauthorized");
```

- [ ] **Step 2: Update the sessions list page**

In `web/src/app/admin/sessions/page.tsx`:
- Add `import { useAuth } from "../../../lib/auth-context";` and inside the component: `const { getIdToken } = useAuth();`
- In `fetchSessions` (currently ~line 66), fetch the token first and pass it through:

```ts
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const token = await getIdToken();
    if (!token) return;
    const result = await getAdminSessions(
      token,
      search,
      pageSize,
      page * pageSize,
      { field: sortField, dir: sortDir },
      destinationId ? { destination_id: destinationId } : undefined
    );
    setSessions(result.sessions);
    setTotal(result.total);
    setLoading(false);
  }, [getIdToken, search, page, sortField, sortDir, destinationId]);
```

(Note: `getIdToken` joins the dependency array — this matches `reports/[id]/page.tsx:94`. If the component's `useAuth` destructuring already exists, extend it.)

- [ ] **Step 3: Update the session detail page**

In `web/src/app/admin/sessions/[id]/page.tsx`, in `SessionDetailContent`:
- Add the same `useAuth` import and `const { getIdToken } = useAuth();`
- Change the load effect (~line 74) to:

```ts
  useEffect(() => {
    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const [s, p, d] = await Promise.all([
        getAdminSession(token, id),
        getAdminSessionPoints(token, id),
        getAdminSessionDestinations(token, id),
      ]);
      setSession(s);
      setPoints(p);
      setDestinations(d);
      setLoading(false);
    }
    load();
  }, [getIdToken, id]);
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run build && npm run lint`
Expected: both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/admin-sessions.ts "web/src/app/admin/sessions/page.tsx" "web/src/app/admin/sessions/[id]/page.tsx"
git commit -m "web: require admin token for admin session reads"
```

---

### Task 3: `updateDestination` requires an admin token

**Files:**
- Modify: `web/src/lib/actions/destinations.ts` (`updateDestination`, ~line 341)
- Modify: `web/src/app/admin/destinations/[id]/page.tsx`

**Interfaces:**
- Consumes: `verifyAdminToken` from Task 1 (`destinations.ts` already imports from `../auth-actions` at line 16 — extend that import).
- Produces: `updateDestination(token: string, id: string, updates: {...})` — updates shape unchanged.

- [ ] **Step 1: Gate the action**

In `web/src/lib/actions/destinations.ts`, extend the existing import to `import { verifyToken, verifyAdminToken } from "../auth-actions";`, add `token: string` as the first parameter of `updateDestination`, and insert at the top of its body:

```ts
  const admin = await verifyAdminToken(token);
  if (!admin) throw new Error("Unauthorized");
```

- [ ] **Step 2: Update the caller**

In `web/src/app/admin/destinations/[id]/page.tsx`:
- Add `import { useAuth } from "../../../../lib/auth-context";` and `const { getIdToken } = useAuth();` in the component.
- Change `handleSave` (~line 82):

```ts
  const handleSave = async () => {
    setSaving(true);
    const token = await getIdToken();
    if (!token) {
      setSaving(false);
      return;
    }
    await updateDestination(token, id, { name: editName, type: editType, features: editFeatures });
    setDest((prev) =>
      prev ? { ...prev, name: editName, type: editType, features: editFeatures } : prev
    );
    setEditing(false);
    setSaving(false);
  };
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run build && npm run lint`
Expected: both pass with zero errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/actions/destinations.ts "web/src/app/admin/destinations/[id]/page.tsx"
git commit -m "web: require admin token for updateDestination"
```

---

### Task 4: Route accept/reject/save/update require an admin token

**Files:**
- Modify: `web/src/lib/actions/routes.ts` (`updateRoute` ~248, `acceptRoute` ~297, `rejectRoute` ~308, `acceptRouteWithSegments` ~396)
- Modify: `web/src/lib/actions/route-builder.ts` (`saveRoute` ~351)
- Modify: `web/src/lib/actions/segment-matcher.ts` (`saveRouteWithSegments` ~545)
- Modify: `web/src/app/admin/routes/[id]/page.tsx`
- Modify: `web/src/app/admin/routes/new/page.tsx`

**Interfaces:**
- Consumes: `verifyAdminToken` from Task 1.
- Produces: `updateRoute(token, id, data)`, `acceptRoute(token, id)`, `rejectRoute(token, id)`, `acceptRouteWithSegments(token, id)`, `saveRoute(token, input)`, `saveRouteWithSegments(token, input)` — all other parameters unchanged. (`acceptRoute` and `saveRoute` have no app callers today; secure them anyway, they are exported server actions.)

- [ ] **Step 1: Gate the six actions**

In each of `routes.ts`, `route-builder.ts`, `segment-matcher.ts` add:

```ts
import { verifyAdminToken } from "../auth-actions";
```

Add `token: string` as the new first parameter of all six functions and insert at the top of each body:

```ts
  const admin = await verifyAdminToken(token);
  if (!admin) throw new Error("Unauthorized");
```

Do NOT change `analyzePendingRoute` (called internally by `acceptRouteWithSegments` and by the detail page for read-only preview — out of the audit's scope).

- [ ] **Step 2: Update the route detail page**

In `web/src/app/admin/routes/[id]/page.tsx`:
- Add `import { useAuth } from "../../../../lib/auth-context";` and `const { getIdToken } = useAuth();`
- `handleSave` (~line 84): fetch token, bail if null (reset `setSaving(false)` first), call `updateRoute(token, id, { name: editName, completion: editCompletion })`.
- `handleAccept` (~line 94): fetch token after the `decomposition` guard, bail if null (reset `setReviewAction(null)`), call `acceptRouteWithSegments(token, id)`.
- `handleReject` (~line 106): fetch token after the `confirm()` guard, bail if null (reset `setReviewAction(null)`), call `rejectRoute(token, id)`.

Concretely:

```ts
  const handleSave = async () => {
    setSaving(true);
    const token = await getIdToken();
    if (!token) {
      setSaving(false);
      return;
    }
    await updateRoute(token, id, { name: editName, completion: editCompletion });
    setRoute((prev) =>
      prev ? { ...prev, name: editName, completion: editCompletion } : prev
    );
    setEditing(false);
    setSaving(false);
  };

  const handleAccept = async () => {
    if (!decomposition) return;
    setReviewAction("accepting");
    const token = await getIdToken();
    if (!token) {
      setReviewAction(null);
      return;
    }
    // Server re-analyzes with full point data — client decomposition is just for preview
    await acceptRouteWithSegments(token, id);
    setRoute((prev) => prev ? { ...prev, status: "active" } : prev);
    setDecomposition(null);
    setReviewAction(null);
    const segs = await getRouteSegments(id);
    setSegments(segs);
  };

  const handleReject = async () => {
    if (!confirm("Delete this pending route? This cannot be undone.")) return;
    setReviewAction("rejecting");
    const token = await getIdToken();
    if (!token) {
      setReviewAction(null);
      return;
    }
    await rejectRoute(token, id);
    window.location.href = "/admin/routes";
  };
```

- [ ] **Step 3: Update the route builder page**

In `web/src/app/admin/routes/new/page.tsx`:
- Add `useAuth` import (path `"../../../../lib/auth-context"`) and `const { getIdToken } = useAuth();`
- In `handleSave` (~line 266), inside the `try`, before calling `saveRouteWithSegments`:

```ts
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in");
```

and pass it: `await saveRouteWithSegments(token, { ... })` (object argument unchanged).

- [ ] **Step 4: Verify**

Run: `cd web && npm run build && npm run lint`
Expected: both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/routes.ts web/src/lib/actions/route-builder.ts web/src/lib/actions/segment-matcher.ts "web/src/app/admin/routes/[id]/page.tsx" web/src/app/admin/routes/new/page.tsx
git commit -m "web: require admin token for route mutations"
```

---

### Task 5: `getListProgress` and `getUnclimbedDestinations` derive the user from the token

**Files:**
- Modify: `web/src/lib/actions/lists.ts` (`getListProgress` ~line 154)
- Modify: `web/src/lib/actions/search.ts` (`getUnclimbedDestinations` ~line 389)
- Modify: `web/src/app/(public)/lists/[id]/page.tsx`

**Interfaces:**
- Consumes: existing `verifyToken` from `web/src/lib/auth-actions.ts`.
- Produces: `getListProgress(token: string, listId: string)`, `getUnclimbedDestinations(token: string, lat?, lng?, limit?)`. The `userId` parameter is REMOVED from both — the verified token's uid replaces it. (`getUnclimbedDestinations` has no callers in `web/src` today; the signature change breaks nobody.)

- [ ] **Step 1: Rework `getListProgress`**

In `web/src/lib/actions/lists.ts`, add `import { verifyToken } from "../auth-actions";`, then:

```ts
export async function getListProgress(
  token: string,
  listId: string
): Promise<ListProgress> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
```

Body unchanged except the second query's params become `[listId, user.uid]`.

- [ ] **Step 2: Rework `getUnclimbedDestinations`**

In `web/src/lib/actions/search.ts`, add `import { verifyToken } from "../auth-actions";`, then:

```ts
export async function getUnclimbedDestinations(
  token: string,
  lat?: number,
  lng?: number,
  limit: number = 20
): Promise<SearchDestination[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
```

Both query param arrays swap `userId` for `user.uid` (first positional param in each).

- [ ] **Step 3: Update the list detail page**

In `web/src/app/(public)/lists/[id]/page.tsx`, change the destructure at line 21 to `const { user, getIdToken } = useAuth();` and the progress effect (~line 43) to:

```ts
  const userId = user?.uid ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function loadProgress() {
      const token = await getIdToken();
      if (!token) return;
      const p = await getListProgress(token, id);
      if (!cancelled) {
        setProgress(p);
      }
    }
    loadProgress();
    return () => {
      cancelled = true;
    };
  }, [id, userId, getIdToken]);
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run build && npm run lint`
Expected: both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/lists.ts web/src/lib/actions/search.ts "web/src/app/(public)/lists/[id]/page.tsx"
git commit -m "web: derive user from token in progress and unclimbed queries"
```

---

### Task 6: `getUser` requires a token; email only for admin or self

**Files:**
- Modify: `web/src/lib/actions/users.ts`
- Modify: `web/src/components/party-list.tsx`
- Modify: `web/src/components/user-popover.tsx`

**Interfaces:**
- Consumes: `adminAuth` (already imported in `users.ts`).
- Produces: `getUser(token: string, uid: string): Promise<UserInfo | null>`. Any signed-in caller gets display name and avatar (needed by the plan party list); `email` is null unless the caller is an admin or is asking about themself.

- [ ] **Step 1: Rework `getUser`**

Replace the function in `web/src/lib/actions/users.ts`:

```ts
export async function getUser(token: string, uid: string): Promise<UserInfo | null> {
  let caller;
  try {
    caller = await adminAuth.verifyIdToken(token);
  } catch {
    throw new Error("Unauthorized");
  }
  // Email is private: only an admin or the user themself may see it.
  const includeEmail = caller.admin === true || caller.uid === uid;

  try {
    // Get Firebase Auth record
    const authUser = await adminAuth.getUser(uid);

    // Get Firestore profile for name/avatar (may have more detail than Auth)
    let firstName: string | null = null;
    let lastName: string | null = null;
    let photoURL = authUser.photoURL || null;

    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        firstName = data?.name?.first || null;
        lastName = data?.name?.last || null;
        if (data?.avatar) photoURL = data.avatar;
      }
    } catch {
      // Firestore profile may not exist
    }

    return {
      uid: authUser.uid,
      email: includeEmail ? authUser.email || null : null,
      displayName: authUser.displayName || [firstName, lastName].filter(Boolean).join(" ") || null,
      photoURL,
      firstName,
      lastName,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update `PartyList`**

In `web/src/components/party-list.tsx`:
- Add `import { useAuth } from "../lib/auth-context";` and `const { getIdToken } = useAuth();`
- Change `loadMembers`:

```ts
  const loadMembers = useCallback(async (ids: string[]) => {
    const token = await getIdToken();
    if (!token) return [];
    const results = await Promise.all(ids.map((uid) => getUser(token, uid)));
    return results.filter((u): u is UserInfo => u !== null);
  }, [getIdToken]);
```

(PartyList renders only on the authenticated plan detail page, so a token is always available there.)

- [ ] **Step 3: Update `UserPopover`**

In `web/src/components/user-popover.tsx`:
- Add `import { useAuth } from "../lib/auth-context";` and `const { getIdToken } = useAuth();`
- Change `handleClick`:

```ts
  const handleClick = async () => {
    setOpen((prev) => !prev);
    if (!fetched) {
      setLoading(true);
      const token = await getIdToken();
      const result = token ? await getUser(token, uid) : null;
      setUser(result);
      setFetched(true);
      setLoading(false);
    }
  };
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run build && npm run lint`
Expected: both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/users.ts web/src/components/party-list.tsx web/src/components/user-popover.tsx
git commit -m "web: require token for getUser and gate email to admin or self"
```

---

### Task 7: Cloud Run plan child endpoints enforce plan membership

**Files:**
- Modify: `cloud-sql/api/src/routes/plans.ts` (GET `/:id/destinations` ~251, `buildPlanRoutesQuery` ~292 + GET `/:id/routes` ~307, GET `/:id/party` ~314)
- Modify: `cloud-sql/api/src/__tests__/route-provenance-response.test.ts` (line 19)
- Create: `cloud-sql/api/src/__tests__/plan-child-endpoint-scoping.test.ts`

**Interfaces:**
- Consumes: `getUid(req)` from `cloud-sql/api/src/auth.ts` (already imported in `plans.ts`); the membership `EXISTS` pattern from the `/:id/reached-destinations` handler in the same file.
- Produces: exported pure builders `buildPlanDestinationsQuery(id: string, uid: string)`, `buildPlanPartyQuery(id: string, uid: string)`, and changed signature `buildPlanRoutesQuery(id: string, uid: string)` — each returns `{ text: string; values: unknown[] }` with `values: [id, uid]`. Non-members get an empty array (matches `/:id/reached-destinations` behavior).

- [ ] **Step 1: Write the failing test**

Create `cloud-sql/api/src/__tests__/plan-child-endpoint-scoping.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPlanDestinationsQuery,
  buildPlanPartyQuery,
  buildPlanRoutesQuery,
} from "../routes/plans";

test("plan child-endpoint queries scope to plan owner or party member", () => {
  for (const build of [
    buildPlanDestinationsQuery,
    buildPlanPartyQuery,
    buildPlanRoutesQuery,
  ]) {
    const query = build("plan-1", "user-1");
    assert.match(
      query.text,
      /p\.user_id = \$2 OR pp\.user_id = \$2/,
      "must scope to the plan owner or a party member"
    );
    assert.deepEqual(query.values, ["plan-1", "user-1"]);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cloud-sql/api && npm test`
Expected: FAIL — `buildPlanDestinationsQuery` / `buildPlanPartyQuery` are not exported.

- [ ] **Step 3: Implement the scoped queries**

In `cloud-sql/api/src/routes/plans.ts`:

Replace the GET `/:id/destinations` handler and add its builder:

```ts
export function buildPlanDestinationsQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            pd.ordinal
     FROM destinations d
     JOIN plan_destinations pd ON pd.destination_id = d.id
     WHERE pd.plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY pd.ordinal`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/destinations — owner or party member only
router.get("/:id/destinations", async (req, res: Response) => {
  const query = buildPlanDestinationsQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
});
```

Change `buildPlanRoutesQuery` to take `uid` and add the same `EXISTS` block after `AND r.status = 'active'`:

```ts
export function buildPlanRoutesQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT r.id, r.name, r.polyline6, r.geohashes, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.completion, r.shape, r.provenance,
            pr.ordinal
     FROM routes r
     JOIN plan_routes pr ON pr.route_id = r.id
     WHERE pr.plan_id = $1 AND r.status = 'active'
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY pr.ordinal`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/routes — owner or party member only
router.get("/:id/routes", async (req, res: Response) => {
  const query = buildPlanRoutesQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
});
```

Replace the GET `/:id/party` handler the same way:

```ts
export function buildPlanPartyQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT user_id, joined_at FROM plan_party
     WHERE plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY joined_at`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/party — owner or party member only
router.get("/:id/party", async (req, res: Response) => {
  const query = buildPlanPartyQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
});
```

Update `cloud-sql/api/src/__tests__/route-provenance-response.test.ts` line 19:

```ts
  const planRoutes = buildPlanRoutesQuery("plan-1", "user-1");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud-sql/api && npm run build && npm test && npm run lint`
Expected: build clean, all tests PASS (including the new scoping test and the untouched provenance test), lint clean.

- [ ] **Step 5: Commit**

```bash
git add cloud-sql/api/src/routes/plans.ts cloud-sql/api/src/__tests__/plan-child-endpoint-scoping.test.ts cloud-sql/api/src/__tests__/route-provenance-response.test.ts
git commit -m "api: scope plan child endpoints to owner or party member"
```

---

### Task 8: Update ARCHITECTURE.md and run full verification

**Files:**
- Modify: `web/ARCHITECTURE.md` (the "Auth for server actions" section, ~line 87)

**Interfaces:**
- Consumes: the now-true behavior from Tasks 1–7.
- Produces: docs that match the code.

- [ ] **Step 1: Fix the stale auth note**

In `web/ARCHITECTURE.md`, replace the line:

```
Admin actions have no server-side auth check — they rely on the client-side `AdminGuard`.
```

with:

```
Admin actions accept a Firebase ID token as the first parameter and verify it
server-side with `verifyAdminToken(token)` (`src/lib/auth-actions.ts`), which
requires the `admin` custom claim. `AdminGuard` remains the client-side gate.
```

Then run `rg -n "no server-side|AdminGuard" web/ARCHITECTURE.md` and fix any other line that still claims admin actions are unchecked.

- [ ] **Step 2: Full verification**

Run: `cd web && npm run build && npm run lint`
Expected: zero errors.

Run: `cd cloud-sql/api && npm run build && npm test && npm run lint`
Expected: zero errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/ARCHITECTURE.md
git commit -m "docs: server actions now verify admin tokens"
```
