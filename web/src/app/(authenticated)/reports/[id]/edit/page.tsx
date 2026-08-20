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
import { LOADING_LABEL } from "../../../../../lib/constants";
import BlockEditor from "../../../../../components/block-editor";
import DestinationPicker from "../../../../../components/destination-picker";
import { Button } from "../../../../../components/ui/button";
import { Input, Label } from "../../../../../components/ui/field";

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
        <div className="text-muted py-12 text-center">{LOADING_LABEL}</div>
      </div>
    );
  }

  if (loadState !== "ready") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="rounded-media border border-border bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold mb-2 text-ink">
            {loadState === "not-found"
              ? "Trip report not found"
              : "This report cannot be edited"}
          </h1>
          <p className="text-sm text-muted mb-5">
            {loadState === "not-found"
              ? "The report may have been removed."
              : "Only the report owner can open this page."}
          </p>
          <Link
            href={`/reports/${reportId}`}
            className="text-sm font-medium text-accent-text hover:underline"
          >
            Back to trip report
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link href="/discover" className="hover:text-ink hover:underline">
          Discover
        </Link>
        <span>/</span>
        <Link
          href={`/reports/${reportId}`}
          className="hover:text-ink hover:underline truncate"
        >
          {title || "Trip Report"}
        </Link>
        <span>/</span>
        <span className="text-ink-2">Edit</span>
      </div>

      <h1 className="text-2xl font-semibold mb-8 text-ink">Edit Trip Report</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <div>
          <Label>Destinations</Label>
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
            className="p-3 bg-alert/10 border border-alert/30 rounded-ctl text-sm text-alert"
          >
            {saveError}
          </div>
        )}

        <div className="flex items-center gap-4 pt-4">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
          <Link
            href={`/reports/${reportId}`}
            className="text-sm text-muted hover:text-ink-2 hover:underline"
          >
            Cancel
          </Link>
        </div>
      </form>

      <section className="mt-12 pt-8 border-t border-alert/30">
        <h2 className="font-semibold text-alert mb-2">Delete Trip Report</h2>
        <p className="text-sm text-muted mb-4">
          This removes the report for everyone and cannot be undone.
        </p>

        {!confirmDelete ? (
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setConfirmDelete(true);
              setDeleteError(null);
            }}
          >
            Delete Report
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink">
              Are you sure you want to delete “{title}”?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, Delete Report"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {deleteError && (
          <div
            role="alert"
            className="mt-4 p-3 bg-alert/10 border border-alert/30 rounded-ctl text-sm text-alert"
          >
            {deleteError}
          </div>
        )}
      </section>
    </div>
  );
}
