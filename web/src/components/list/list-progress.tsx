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
  const { user, loading: authLoading } = useAuth();
  const [progress, setProgress] = useState<ListProgressData | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!user) {
      setProgress(null);
      return;
    }

    getListProgress(listId, user.uid)
      .then((result) => {
        if (!cancelled) setProgress(result);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, listId, user]);

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
