"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth-context";

/** The one auth-dependent thing in the browse stack, so it is the one client
 * island in it: signed-in readers get a link to write a report, everyone
 * else gets the join link. Renders nothing until auth resolves, rather than
 * showing "Join" to a signed-in reader for a frame. */
export function DiscoverReportAction() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Link
      href={user ? "/reports/new" : "/register"}
      className="text-sm font-medium text-accent-text hover:underline"
    >
      {user ? "Write a report" : "Join to contribute"}
    </Link>
  );
}
