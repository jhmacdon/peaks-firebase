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
import { Button } from "../../../../components/ui/button";
import { Input, Label, Select } from "../../../../components/ui/field";
import { StatCluster } from "../../../../components/ui/stat";

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
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/log" className="hover:text-ink hover:underline">
          Session Log
        </Link>
        <span>/</span>
        <span className="text-ink-2">Import GPX</span>
      </div>

      <h1 className="text-2xl font-semibold text-ink">Import a GPX activity</h1>
      <p className="mt-2 text-sm leading-6 text-ink-2">
        Add a recorded track from Garmin, Gaia GPS, Strava, or another GPX
        source. Peaks will match places, protected areas, and routes after the
        upload.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div>
          <Label htmlFor="gpx-file">GPX file</Label>
          <input
            id="gpx-file"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            disabled={reading || submitting}
            onChange={(event) => chooseFile(event.target.files?.[0])}
            className="mt-1.5 block w-full rounded-ctl border border-border bg-page px-3 py-2 text-sm text-ink file:mr-3 file:rounded-ctl file:border-0 file:bg-fill file:px-3 file:py-1.5 file:font-medium file:text-accent-text hover:file:bg-border"
          />
          <p className="mt-1.5 text-xs text-muted">
            Up to 8 MB and 25,000 timed track points.
          </p>
        </div>

        {reading && (
          <div className="rounded-media border border-border bg-surface p-5 text-sm text-muted">
            Reading track…
          </div>
        )}

        {preview && (
          <>
            <section className="rounded-media border border-border bg-surface p-5">
              <StatCluster
                value={preview.points.length.toLocaleString()}
                label={`timed track points · ${new Date(
                  preview.startTime * 1000
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}`}
                scale="page"
              />
              <div className="mt-5 grid grid-cols-3 gap-4 border-t border-hairline pt-4">
                <StatCluster
                  value={(preview.stats.distance / 1609.34).toFixed(1)}
                  unit="mi"
                  label="Distance"
                  scale="card"
                />
                <StatCluster
                  value={Math.round(
                    preview.stats.gain * 3.28084
                  ).toLocaleString()}
                  unit="ft"
                  label="Elevation"
                  scale="card"
                />
                <StatCluster
                  value={formatDuration(preview.stats.totalTime)}
                  label="Time"
                  scale="card"
                />
              </div>
              {preview.ignoredPointCount > 0 && (
                <p className="mt-4 text-xs text-muted">
                  {preview.ignoredPointCount.toLocaleString()} invalid or
                  duplicate points will be skipped.
                </p>
              )}
            </section>

            <div>
              <Label htmlFor="activity-name">Activity name</Label>
              <Input
                id="activity-name"
                type="text"
                maxLength={120}
                value={name}
                disabled={submitting}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="activity-type">Activity type</Label>
              <Select
                id="activity-type"
                value={activityType}
                disabled={submitting}
                onChange={(event) =>
                  setActivityType(event.target.value as SessionActivityType)
                }
              >
                <option value="outdoor-trek">Hike</option>
                <option value="ski">Ski</option>
                <option value="outdoor-moto">Moto</option>
              </Select>
            </div>

            <label className="flex items-start gap-3 rounded-ctl border border-border bg-page p-4">
              <input
                type="checkbox"
                checked={isPublic}
                disabled={submitting}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  Make this activity public
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  Anyone with its link can view the track and activity details.
                </span>
              </span>
            </label>
          </>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-ctl border border-alert/30 bg-alert/10 p-3 text-sm text-alert"
          >
            {error}
          </div>
        )}

        {result?.warning && (
          <div role="status" className="text-sm text-ink-2">
            <p>{result.warning}</p>
            <Link
              href={`/log/${result.id}`}
              className="mt-2 inline-block font-semibold text-accent-text underline underline-offset-2"
            >
              Open activity
            </Link>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!preview || reading || submitting}>
            {submitting ? "Importing and matching…" : "Import activity"}
          </Button>
          <Button href="/log" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
