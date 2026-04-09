"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripReport, type TripReport } from "../../../../lib/actions/trip-reports";
import {
  getDestination,
  type DestinationDetail,
} from "../../../../lib/actions/destinations";

export default function TripReportDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [report, setReport] = useState<TripReport | null>(null);
  const [destinations, setDestinations] = useState<DestinationDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const r = await getTripReport(id);
      setReport(r);

      if (r && r.destinations.length > 0) {
        const dests = await Promise.all(
          r.destinations.map((destId) => getDestination(destId))
        );
        setDestinations(
          dests.filter((d): d is DestinationDetail => d !== null)
        );
      }

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">
          Trip report not found
        </div>
      </div>
    );
  }

  const date = new Date(report.date);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">Trip Report</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{report.title}</h1>
        <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
          <span>{report.userName}</span>
          <span>&middot;</span>
          <span>
            {date.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* Linked Destinations */}
      {destinations.length > 0 && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">
            Destinations
          </h3>
          <div className="flex flex-wrap gap-2">
            {destinations.map((dest) => (
              <Link
                key={dest.id}
                href={`/destinations/${dest.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <span>{dest.name || "Unnamed"}</span>
                {dest.elevation != null && (
                  <span className="text-gray-400 text-xs">
                    {Math.round(dest.elevation * 3.28084).toLocaleString()} ft
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Content Blocks */}
      <div className="space-y-6">
        {report.blocks.map((block, index) => {
          if (block.type === "text") {
            return (
              <div key={index} className="prose dark:prose-invert max-w-none">
                {block.content.split("\n").map((paragraph, pIdx) => (
                  <p
                    key={pIdx}
                    className="text-gray-800 dark:text-gray-200 leading-relaxed"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            );
          }

          if (block.type === "photo") {
            return (
              <figure key={index} className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={block.content}
                    alt={block.caption || "Trip photo"}
                    className="w-full"
                  />
                </div>
                {block.caption && (
                  <figcaption className="text-sm text-gray-500 text-center">
                    {block.caption}
                  </figcaption>
                )}
              </figure>
            );
          }

          return null;
        })}
      </div>

      {/* Footer */}
      {destinations.length > 0 && (
        <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-500 mb-3">
            More reports for these destinations
          </h3>
          <div className="flex flex-wrap gap-2">
            {destinations.map((dest) => (
              <Link
                key={dest.id}
                href={`/destinations/${dest.id}/reports`}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {dest.name || "Unnamed"} reports
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
