"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import {
  importGPXSession,
  type ImportGPXSessionResult,
} from "../../../../lib/actions/session-import";
import {
  MAX_GPX_SESSION_FILE_BYTES,
  parseSessionGPX,
  type ParsedGPXSession,
} from "../../../../lib/session-import";
import type { SessionActivityType } from "../../../../lib/actions/sessions";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

export default function ImportGPXPage() {
  const router = useRouter();
  const { getIdToken } = useAuth();
  const [gpxContent, setGPXContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [activityType, setActivityType] =
    useState<SessionActivityType>("outdoor-trek");
  const [isPublic, setIsPublic] = useState(false);
  const [preview, setPreview] = useState<ParsedGPXSession | null>(null);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportGPXSessionResult | null>(null);

  const chooseFile = async (file: File | undefined) => {
    setError(null);
    setResult(null);
    setPreview(null);
    setGPXContent("");
    setFileName("");

    if (!file) return;
    if (file.size > MAX_GPX_SESSION_FILE_BYTES) {
      setError("GPX file is larger than 8 MB");
      return;
    }

    setReading(true);
    try {
      const content = await file.text();
      const parsed = parseSessionGPX(content, file.name);
      setGPXContent(content);
      setFileName(file.name);
      setPreview(parsed);
      setName(parsed.name);
    } catch (fileError) {
      setError(
        fileError instanceof Error
          ? fileError.message
          : "The GPX file could not be read"
      );
    } finally {
      setReading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview || !gpxContent) {
      setError("Choose a GPX file first");
      return;
    }
    if (!name.trim()) {
      setError("Activity name is required");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in to import an activity");
      const importResult = await importGPXSession(token, {
        gpxContent,
        fileName,
        name,
        activityType,
        isPublic,
      });

      if (!importResult.warning) {
        router.push(`/log/${importResult.id}`);
        return;
      }
      setResult(importResult);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The GPX file could not be imported"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/log"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Session Log
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">Import GPX</span>
      </div>

      <h1 className="text-2xl font-semibold">Import a GPX activity</h1>
      <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
        Add a recorded track from Garmin, Gaia GPS, Strava, or another GPX
        source. Peaks will match places, protected areas, and routes after the
        upload.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div>
          <label
            htmlFor="gpx-file"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            GPX file
          </label>
          <input
            id="gpx-file"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            disabled={reading || submitting}
            onChange={(event) => chooseFile(event.target.files?.[0])}
            className="mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:font-medium file:text-teal-800 hover:file:bg-teal-100 dark:border-gray-700 dark:bg-gray-900 dark:file:bg-teal-950 dark:file:text-teal-200"
          />
          <p className="mt-1.5 text-xs text-gray-500">
            Up to 8 MB and 25,000 timed track points.
          </p>
        </div>

        {reading && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">
            Reading track…
          </div>
        )}

        {preview && (
          <>
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <p className="text-3xl font-semibold tracking-tight">
                {preview.points.length.toLocaleString()}
              </p>
              <p className="mt-0.5 text-sm text-gray-500">
                timed track points ·{" "}
                {new Date(preview.startTime * 1000).toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }
                )}
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                <div>
                  <dt className="text-xs text-gray-500">Distance</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {(preview.stats.distance / 1609.34).toFixed(1)} mi
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Elevation</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {Math.round(
                      preview.stats.gain * 3.28084
                    ).toLocaleString()}{" "}
                    ft
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Time</dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {formatDuration(preview.stats.totalTime)}
                  </dd>
                </div>
              </dl>
              {preview.ignoredPointCount > 0 && (
                <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">
                  {preview.ignoredPointCount.toLocaleString()} invalid or
                  duplicate points will be skipped.
                </p>
              )}
            </section>

            <div>
              <label
                htmlFor="activity-name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Activity name
              </label>
              <input
                id="activity-name"
                type="text"
                maxLength={120}
                value={name}
                disabled={submitting}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-gray-700 dark:bg-gray-900"
              />
            </div>

            <div>
              <label
                htmlFor="activity-type"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Activity type
              </label>
              <select
                id="activity-type"
                value={activityType}
                disabled={submitting}
                onChange={(event) =>
                  setActivityType(event.target.value as SessionActivityType)
                }
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="outdoor-trek">Hike</option>
                <option value="ski">Ski</option>
                <option value="outdoor-moto">Moto</option>
              </select>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <input
                type="checkbox"
                checked={isPublic}
                disabled={submitting}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              <span>
                <span className="block text-sm font-medium">
                  Make this activity public
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                  Anyone with its link can view the track and activity details.
                </span>
              </span>
            </label>
          </>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {result?.warning && (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <p>{result.warning}</p>
            <Link
              href={`/log/${result.id}`}
              className="mt-2 inline-block font-semibold underline underline-offset-2"
            >
              Open activity
            </Link>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!preview || reading || submitting}
            className="rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
          >
            {submitting ? "Importing and matching…" : "Import activity"}
          </button>
          <Link
            href="/log"
            className="rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium transition-colors hover:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-600"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
