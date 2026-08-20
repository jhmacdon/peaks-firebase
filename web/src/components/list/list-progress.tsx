"use client";

import { useEffect, useState } from "react";
import { getListProgress, type ListProgress as ListProgressData } from "../../lib/actions/lists";
import { useAuth } from "../../lib/auth-context";
import ProgressBar from "../progress-bar";
import { SectionHeading } from "../ui/section-heading";

/** Your completion on this list — the only part of the page that depends
 * on who's reading it, so it stays a client island while the rest of the
 * list page renders on the server (same contract as
 * components/destination/destination-activity.tsx). Renders nothing for a
 * signed-out reader, rather than a progress bar for a progress no one is
 * tracking. */
export function ListProgress({ listId }: { listId: string }) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [progress, setProgress] = useState<ListProgressData | null>(null);

  // getListProgress reads whose progress to count off the verified token, not
  // off a uid the client hands it — so the island sends the ID token and
  // never a caller-chosen user id.
  const userId = user?.uid ?? null;

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!userId) {
      setProgress(null);
      return;
    }

    async function load() {
      const token = await getIdToken();
      if (!token) return;
      const result = await getListProgress(token, listId);
      if (!cancelled) setProgress(result);
    }

    load().catch(() => {
      if (!cancelled) setProgress(null);
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, listId, userId, getIdToken]);

  if (!user || !progress) return null;

  return (
    <section aria-labelledby="list-progress">
      <SectionHeading>
        <span id="list-progress">Your progress</span>
      </SectionHeading>
      <ProgressBar completed={progress.completed} total={progress.total} className="mt-4 max-w-sm" />
    </section>
  );
}
