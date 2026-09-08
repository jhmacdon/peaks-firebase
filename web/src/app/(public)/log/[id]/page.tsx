"use client";

// A client page under a server `layout.tsx` that owns `generateMetadata`.
//
// Every other detail page in the overhaul is a server shell with client
// islands, and this one deliberately isn't: the whole page depends on *who
// is asking*. A signed-in owner reads five authenticated actions with their
// ID token; a signed-out reader gets the privacy-stripped public bundle;
// which of those two runs isn't known until Firebase Auth has settled in the
// browser. Splitting that into a server shell would mean either rendering
// the shell twice or moving auth to a cookie session, neither of which this
// task is the place for. The layout still renders the title, description and
// Open Graph tags server-side, so link unfurlers and the `noindex` directive
// never depend on hydration. Nothing here is cached: activities are
// per-user, and a private one must never survive in a shared cache.

import { ActivityPhotoGroups } from "../../../../components/activity-photo-groups";
import { getActivityPhotoGroups } from "../../../../lib/actions/activity-photos";
import type { ActivityPhotoGroup } from "../../../../lib/activity-photos";
import { Button } from "../../../../components/ui/button";
import { DetailSectionNav } from "../../../../components/detail-section-nav";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import {
  getSession,
  getSessionPoints,
  getSessionDestinations,
  getSessionRoutes,
  getSessionAreas,
} from "../../../../lib/actions/sessions";
import { getPublicSessionBundle } from "../../../../lib/actions/public-sessions";
import type {
  SessionDetail,
  SessionPoint,
  SessionDestination,
  SessionRoute,
} from "../../../../lib/actions/sessions";
import {
  sortAreasByProminence,
  type ProtectedArea,
} from "../../../../lib/area-types";
import SessionPlayback from "../../../../components/session-playback";
import SessionActions from "../../../../components/session-actions";
import { ActivityGlyph } from "../../../../components/session/activity-glyph";
import { SessionAchievements } from "../../../../components/session/session-achievements";
import { SessionRelated } from "../../../../components/session/session-related";
import { SessionRouteHistory } from "../../../../components/session/session-route-history";
import { SessionSecondaryStats } from "../../../../components/session/session-secondary-stats";
import { SessionSplits } from "../../../../components/session/session-splits";
import { Breadcrumb } from "../../../../components/detail-sections";
import { PageHeader } from "../../../../components/ui/page-header";
import { Topline } from "../../../../components/ui/topline";
import { EmptyState } from "../../../../components/ui/empty-state";
import { sessionActivityLabel } from "../../../../lib/session-track";
import { summarizeSessionHealthData } from "../../../../lib/session-health";
import { deriveActivityDisplayName } from "../../../../lib/seo-descriptions";
import {
  buildSessionAchievements,
  buildSessionSecondaryStats,
  buildSessionSplits,
  buildSessionTopline,
} from "../../../../lib/session-detail";
import { buildSessionDistances } from "../../../../lib/session-track";
import { LOADING_LABEL } from "../../../../lib/constants";

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user, loading: authLoading, getIdToken } = useAuth();
  const userId = user?.uid ?? null;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [points, setPoints] = useState<SessionPoint[]>([]);
  const [destinations, setDestinations] = useState<SessionDestination[]>([]);
  const [routes, setRoutes] = useState<SessionRoute[]>([]);
  const [areas, setAreas] = useState<ProtectedArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [photoGroups, setPhotoGroups] = useState<ActivityPhotoGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) {
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setLoading(true);
      setError(false);
      setPhotoGroups([]);
      try {
        if (!userId) {
          const bundle = await getPublicSessionBundle(id);
          if (cancelled) return;

          setSession(bundle?.session ?? null);
          setPoints(bundle?.points ?? []);
          setDestinations(bundle?.destinations ?? []);
          setRoutes(bundle?.routes ?? []);
          setAreas(bundle?.areas ?? []);
          if (bundle) {
            const photos = await getActivityPhotoGroups({ sessionId: id });
            if (!cancelled) setPhotoGroups(photos);
          }
          return;
        }

        const token = await getIdToken();
        if (!token) throw new Error("Missing sign-in token");

        const [nextSession, nextPoints, nextDestinations, nextRoutes, nextAreas] =
          await Promise.all([
            getSession(token, id),
            getSessionPoints(token, id),
            getSessionDestinations(token, id),
            getSessionRoutes(token, id),
            getSessionAreas(token, id),
          ]);

        if (cancelled) return;
        setSession(nextSession);
        setPoints(nextPoints);
        setDestinations(nextDestinations);
        setRoutes(nextRoutes);
        setAreas(nextAreas);
        if (nextSession) { const photos = await getActivityPhotoGroups({ sessionId: id }); if (!cancelled) setPhotoGroups(photos); }
      } catch {
        if (!cancelled) {
          setError(true);
          setSession(null);
          setPoints([]);
          setDestinations([]);
          setRoutes([]);
          setAreas([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, id, userId, attempt]);

  const achievements = useMemo(
    () => buildSessionAchievements(destinations, points),
    [destinations, points]
  );
  const healthSummary = useMemo(
    () => (session ? summarizeSessionHealthData(session.health_data) : null),
    [session]
  );
  const splits = useMemo(
    () => buildSessionSplits(points, buildSessionDistances(points)),
    [points]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <EmptyState>{LOADING_LABEL}</EmptyState>
      </div>
    );
  }

  if (error) return <div className="mx-auto max-w-[1200px] px-6 py-8"><EmptyState title="Activity could not load" description="Try again to load the activity and its photos." action={<Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>} /></div>;

  if (!session) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <EmptyState
          title="Activity not found"
          description="It may have been deleted, or its owner may keep it private."
        />
      </div>
    );
  }

  const displayName = deriveActivityDisplayName(session.name, destinations);
  const goalDestinations = destinations.filter(
    (destination) => destination.relation === "goal"
  );
  const toplineStats = buildSessionTopline(session);
  const secondaryStats = buildSessionSecondaryStats(session, healthSummary);
  const startDate = new Date(session.start_time);
  // The anatomy's "place" (audit §2b: timestamp · place). The activity has
  // no address of its own, so the most prominent protected area it crossed
  // stands in — a national park outranks a national forest, which outranks
  // a state park, which is the same order the chip row uses. Omitted
  // entirely when the track crossed nothing named.
  const placeName = sortAreasByProminence(areas)[0]?.name ?? null;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <PageHeader
        breadcrumb={
          userId ? (
            <Breadcrumb
              current={displayName}
              parentHref="/log"
              parentLabel="Session log"
            />
          ) : (
            <Breadcrumb current={displayName} />
          )
        }
        title={displayName}
        meta={
          <span className="flex items-center gap-2">
            <ActivityGlyph
              activityType={session.activity_type}
              className="h-5 w-5 shrink-0 text-muted"
            />
            <span>
              {sessionActivityLabel(session.activity_type)}
              {" · "}
              {startDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              {placeName ? ` · ${placeName}` : ""}
              {userId === session.user_id && session.user_id
                ? ` · ${session.is_public ? "Public" : "Private"}`
                : ""}
            </span>
          </span>
        }
      />

      <div className="mt-5">
        <SessionActions
          session={session}
          displayName={displayName}
          onUpdated={(updates) =>
            setSession((current) =>
              current ? { ...current, ...updates } : current
            )
          }
        />
      </div>
      <DetailSectionNav sections={[
        ...(points.length ? [{ id: "session-track", label: "Track" }] : []),
        ...(photoGroups.length ? [{ id: "session-photos", label: "Photos" }] : []),
        { id: "session-details", label: "Activity details" },
      ]} />
      <Topline stats={toplineStats} className="mt-10" />

      <SessionAchievements achievements={achievements} className="mt-10" />

      {points.length > 0 ? (
        <div id="session-track" className="mt-8 scroll-mt-24">
          <SessionPlayback
            points={points}
            healthData={session.health_data}
            distanceMeters={session.distance}
            gainMeters={session.gain}
            highPointMeters={session.highest_point}
          />
        </div>
      ) : null}

      <div className="mt-10"><ActivityPhotoGroups groups={photoGroups} id="session-photos" /></div>
      <details id="session-details" className="mt-8 scroll-mt-24 border-y border-hairline py-4">
        <summary className="min-h-11 cursor-pointer font-medium text-ink">Activity details and splits</summary>
        <SessionSecondaryStats stats={secondaryStats} className="mt-5" />
        <SessionSplits splits={splits} className="mt-8" />
      </details>

      <SessionRelated
        areas={areas}
        goalDestinations={goalDestinations}
        routes={routes}
        className="mt-12"
      />

      {/* Personal data — a public reader must never see another user's
          attempt history, so this only ever renders for the session's own
          owner (the same ownership check the Public/Private label above
          uses; `session.user_id` itself is blanked to "" by getSession's
          query for anyone who isn't the owner). */}
      {userId === session.user_id && session.user_id ? (
        <SessionRouteHistory
          sessionId={session.id}
          routes={routes}
          className="mt-12"
        />
      ) : null}

    </div>
  );
}
