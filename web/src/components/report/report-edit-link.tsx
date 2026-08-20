"use client";

import { useEffect, useState } from "react";
import { canEditTripReport } from "../../lib/actions/trip-reports";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../ui/button";

/** Whether the current reader owns this report — the only part of the page
 * that depends on who's reading it, so it stays a client island while the
 * rest of the report renders on the server. Renders nothing until (and
 * unless) ownership is confirmed, rather than flashing an Edit button that
 * then disappears. */
export function ReportEditLink({ reportId }: { reportId: string }) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) return;
    if (!user) {
      setCanEdit(false);
      return;
    }

    getIdToken()
      .then((token) => (token ? canEditTripReport(token, reportId) : false))
      .then((result) => {
        if (!cancelled) setCanEdit(result);
      })
      .catch(() => {
        if (!cancelled) setCanEdit(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, reportId, user]);

  if (!canEdit) return null;

  return (
    <Button href={`/reports/${reportId}/edit`} variant="secondary" size="sm">
      Edit
    </Button>
  );
}
