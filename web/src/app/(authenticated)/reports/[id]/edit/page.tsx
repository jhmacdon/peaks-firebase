"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../../lib/auth-context";
import {
  deleteTripReport,
  getTripReportForEdit,
  updateTripReport,
  type TripReportBlock,
} from "../../../../../lib/actions/trip-reports";
import {
  getDestination,
  type DestinationDetail,
} from "../../../../../lib/actions/destinations";
import BlockEditor from "../../../../../components/block-editor";
import DestinationPicker from "../../../../../components/destination-picker";

interface SelectedDestination {
  id: string;
  name: string;
}

type LoadState = "loading" | "ready" | "not-found" | "unavailable";

function dateInputValue(value: string): string {
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export default function EditTripReportPage() {
  const params = useParams();
  const reportId = params.id as string;
  const router = useRouter();
  const { getIdToken } = useAuth();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [blocks, setBlocks] = useState<TripReportBlock[]>([]);
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<
    SelectedDestination[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      try {
        const token = await getIdToken();
        if (!token) {
          if (!cancelled) setLoadState("unavailable");
          return;
        }

        const report = await getTripReportForEdit(token, reportId);
        if (!report) {
          if (!cancelled) setLoadState("not-found");
          return;
        }

        const destinationResults = await Promise.all(
          report.destinations.map(async (destinationId) => {
            try {
              return await getDestination(destinationId);
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        setTitle(report.title);
        setDate(dateInputValue(report.date));
        setBlocks(
          report.blocks.length > 0
            ? report.blocks.map((block) => ({ ...block }))
            : [{ type: "text", content: "" }]
        );
        setDestinationIds([...report.destinations]);
        setSelectedDestinations(
          report.destinations.map((destinationId, index) => {
            const destination = destinationResults[index] as
              | DestinationDetail
              | null;
            return {
              id: destinationId,
              name: destination?.name || destinationId.slice(0, 8),
            };
          })
        );
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("unavailable");
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, reportId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);

    if (!title.trim()) {
      setSaveError("Title is required.");
      return;
    }
    if (!date) {
      setSaveError("Date is required.");
      return;
    }
    if (destinationIds.length === 0) {
      setSaveError("Select at least one destination.");
      return;
    }

    const nonEmptyBlocks = blocks.filter((block) => block.content.trim());
    if (nonEmptyBlocks.length === 0) {
      setSaveError("Add at least one content block.");
      return;
    }

    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Please sign in again.");

      await updateTripReport(token, reportId, {
        title: title.trim(),
        date,
        destinations: destinationIds,
        blocks: nonEmptyBlocks,
      });

      router.replace(`/reports/${reportId}`);
      router.refresh();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save report."
      );
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error("Please sign in again.");

      await deleteTripReport(token, reportId);
      router.replace("/discover");
      router.refresh();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete report."
      );
      setDeleting(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (loadState !== "ready") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <h1 className="text-xl font-semibold mb-2">
            {loadState === "not-found"
              ? "Trip report not found"
              : "This report cannot be edited"}
          </h1>
          <p className="text-sm text-gray-500 mb-5">
            {loadState === "not-found"
              ? "The report may have been removed."
              : "Only the report owner can open this page."}
          </p>
          <Link
            href={`/reports/${reportId}`}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Back to trip report
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/discover"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Discover
        </Link>
        <span>/</span>
        <Link
          href={`/reports/${reportId}`}
          className="hover:text-gray-900 dark:hover:text-gray-100 truncate"
        >
          {title || "Trip Report"}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">Edit</span>
      </div>

      <h1 className="text-2xl font-semibold mb-8">Edit Trip Report</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="date"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Destinations
          </label>
          <DestinationPicker
            selectedIds={destinationIds}
            selectedDestinations={selectedDestinations}
            onChange={setDestinationIds}
          />
        </div>

        <BlockEditor blocks={blocks} onChange={setBlocks} />

        {saveError && (
          <div
            role="alert"
            className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300"
          >
            {saveError}
          </div>
        )}

        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <Link
            href={`/reports/${reportId}`}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </Link>
        </div>
      </form>

      <section className="mt-12 pt-8 border-t border-red-200 dark:border-red-900">
        <h2 className="font-semibold text-red-600 dark:text-red-400 mb-2">
          Delete Trip Report
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          This removes the report for everyone and cannot be undone.
        </p>

        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(true);
              setDeleteError(null);
            }}
            className="px-4 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            Delete Report
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Are you sure you want to delete “{title}”?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Deleting..." : "Yes, Delete Report"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-gray-400 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {deleteError && (
          <div
            role="alert"
            className="mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300"
          >
            {deleteError}
          </div>
        )}
      </section>
    </div>
  );
}
