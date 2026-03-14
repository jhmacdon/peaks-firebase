"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripReportsForDestination } from "@/lib/actions/trip-reports";
import { getDestination, type DestinationDetail } from "@/lib/actions/destinations";
import TripReportCard from "@/components/trip-report-card";
import type { TripReport } from "@/lib/actions/trip-reports";
import { useAuth } from "@/lib/auth-context";

export default function DestinationReportsPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [reports, setReports] = useState<TripReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [d, r] = await Promise.all([
        getDestination(id),
        getTripReportsForDestination(id),
      ]);
      setDest(d);
      setReports(r);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!dest) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">
          Destination not found
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <Link
          href={`/destinations/${id}`}
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          {dest.name || "Unnamed"}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">Trip Reports</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Trip Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            {dest.name || "Unnamed"}
          </p>
        </div>
        {user && (
          <Link
            href={`/reports/new?dest=${id}`}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Write Report
          </Link>
        )}
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="text-sm text-gray-500 py-12 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          No trip reports yet for this destination.
          {user && (
            <>
              {" "}
              <Link
                href={`/reports/new?dest=${id}`}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Be the first to write one.
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <TripReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
