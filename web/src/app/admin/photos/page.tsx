"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "../../../components/admin-guard";
import { AdminPage, AdminPageHeader } from "../../../components/admin/admin-page";
import { Badge, type BadgeTone } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Input, Label, Select, Textarea } from "../../../components/ui/field";
import { Tabs } from "../../../components/ui/tabs";
import { useAuth } from "../../../lib/auth-context";
import {
  addDestinationPhotoCandidate,
  getDestinationPhotoCandidates,
  reviewDestinationPhotoCandidate,
  searchDestinationsForPhotoCandidate,
  updateDestinationPhotoCandidateFraming,
  type DestinationPhotoCandidate,
  type DestinationPhotoDecision,
  type DestinationPhotoStatus,
  type PhotoDestinationSearchResult,
} from "../../../lib/actions/destination-photos";
import { LOADING_LABEL } from "../../../lib/constants";
import { requestedDestinationPhotoFraming } from "../../../lib/destination-photo-review";

const STATUS_TABS: { id: DestinationPhotoStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "denied", label: "Denied" },
];

const SOURCE_OPTIONS = [
  ["wikimedia_commons", "Wikimedia Commons"],
  ["usgs", "USGS"],
  ["nps", "National Park Service"],
  ["flickr", "Flickr"],
  ["unsplash", "Unsplash"],
  ["pexels", "Pexels"],
  ["pixabay", "Pixabay"],
  ["other", "Other"],
] as const;

export default function AdminPhotosPage() {
  return (
    <AdminGuard>
      <PhotoReviewContent />
    </AdminGuard>
  );
}

function PhotoReviewContent() {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<DestinationPhotoStatus>("pending");
  const [candidates, setCandidates] = useState<DestinationPhotoCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to review photos");
      setCandidates(await getDestinationPhotoCandidates(token, status));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load photos");
    } finally {
      setLoading(false);
    }
  }, [getIdToken, status]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  return (
    <AdminPage>
      <AdminPageHeader
        title="Destination photos"
        description="Review licensed cover photos before they reach the site and app."
        actions={
          <Button
            type="button"
            variant={showAddForm ? "secondary" : "primary"}
            onClick={() => setShowAddForm((shown) => !shown)}
          >
            {showAddForm ? "Close form" : "Add candidate"}
          </Button>
        }
      />

      {showAddForm ? (
        <AddCandidateForm
          onAdded={() => {
            setShowAddForm(false);
            if (status === "pending") {
              void loadCandidates();
            } else {
              setStatus("pending");
            }
          }}
        />
      ) : null}

      <section className="mt-10" aria-label="Photo review queue">
        <Tabs
          items={STATUS_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
          value={status}
          onChange={(value) => setStatus(value as DestinationPhotoStatus)}
        />

        {loadError ? (
          <Notice className="mt-6">{loadError}</Notice>
        ) : loading ? (
          <EmptyState className="mt-6">{LOADING_LABEL}</EmptyState>
        ) : candidates.length === 0 ? (
          <EmptyState
            className="mt-6"
            title={`No ${status} photo candidates`}
            description="Candidates will appear here when they enter this review state."
          />
        ) : (
          <div className="mt-8 space-y-8">
            {candidates.map((candidate) => (
              <PhotoCandidateCard
                key={candidate.id}
                candidate={candidate}
                reviewEnabled={status === "pending"}
                onFinalized={(id) =>
                  setCandidates((current) => current.filter((item) => item.id !== id))
                }
              />
            ))}
          </div>
        )}
      </section>
    </AdminPage>
  );
}

function AddCandidateForm({ onAdded }: { onAdded: () => void }) {
  const { getIdToken } = useAuth();
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destination, setDestination] = useState<PhotoDestinationSearchResult | null>(null);
  const [matches, setMatches] = useState<PhotoDestinationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [sourcePageUrl, setSourcePageUrl] = useState("");
  const [sourceKind, setSourceKind] = useState("wikimedia_commons");
  const [photographer, setPhotographer] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [imageWidth, setImageWidth] = useState("");
  const [imageHeight, setImageHeight] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedDestinationId = destination?.id ?? null;

  useEffect(() => {
    if (selectedDestinationId || destinationQuery.trim().length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const token = await getIdToken();
        if (!token) return;
        const results = await searchDestinationsForPhotoCandidate(token, destinationQuery);
        if (!cancelled) setMatches(results);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not search destinations");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destinationQuery, getIdToken, selectedDestinationId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!destination) {
      setError("Choose a destination from the search results");
      return;
    }
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to add a photo");
      await addDestinationPhotoCandidate(token, {
        destinationId: destination.id,
        imageUrl,
        sourcePageUrl,
        sourceKind,
        photographer,
        licenseName,
        licenseUrl,
        imageWidth: imageWidth ? Number(imageWidth) : null,
        imageHeight: imageHeight ? Number(imageHeight) : null,
        notes,
      });
      onAdded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add candidate");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby="new-photo-candidate-heading"
      className="mt-10 rounded-media border border-border bg-surface p-5 sm:p-6"
    >
      <h2 id="new-photo-candidate-heading" className="text-lg font-medium text-ink">
        New photo candidate
      </h2>
      <p className="mt-1 text-sm text-muted">
        Add the image, its source, and the license details needed for review.
      </p>
      {error ? <Notice className="mt-4">{error}</Notice> : null}

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="relative md:col-span-2">
          <Label htmlFor="photo-destination-search">Destination</Label>
          {destination ? (
            <div className="flex min-h-10 items-center justify-between gap-4 rounded-ctl border border-border bg-page px-3 py-1.5">
              <span className="min-w-0 text-sm text-ink">
                <span className="font-medium">{destination.name}</span>
                <span className="ml-2 font-mono-num text-xs text-muted">{destination.id}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="quiet"
                onClick={() => {
                  setDestination(null);
                  setDestinationQuery("");
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="photo-destination-search"
                value={destinationQuery}
                onChange={(event) => setDestinationQuery(event.target.value)}
                placeholder="Search for a mountain"
                autoComplete="off"
              />
              {searching || matches.length > 0 ? (
                <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-ctl border border-border bg-page shadow-float">
                  {searching ? (
                    <p className="px-3 py-2 text-sm text-muted">Searching…</p>
                  ) : (
                    <div className="divide-y divide-hairline">
                      {matches.map((match) => (
                        <button
                          key={match.id}
                          type="button"
                          onClick={() => {
                            setDestination(match);
                            setMatches([]);
                          }}
                          className="flex w-full justify-between gap-4 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-fill"
                        >
                          <span>{match.name}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {[match.state_code, match.country_code].filter(Boolean).join(", ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        <TextField id="photo-image-url" label="Direct image URL" value={imageUrl} onChange={setImageUrl} type="url" />
        <TextField
          id="photo-source-page-url"
          label="Source page URL"
          value={sourcePageUrl}
          onChange={setSourcePageUrl}
          type="url"
        />
        <div>
          <Label htmlFor="photo-source-kind">Source</Label>
          <Select id="photo-source-kind" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          id="photo-photographer"
          label="Photographer or agency"
          value={photographer}
          onChange={setPhotographer}
        />
        <TextField
          id="photo-license-name"
          label="License name"
          value={licenseName}
          onChange={setLicenseName}
          placeholder="CC BY-SA 4.0"
        />
        <TextField
          id="photo-license-url"
          label="License URL"
          value={licenseUrl}
          onChange={setLicenseUrl}
          type="url"
        />
        <TextField id="photo-image-width" label="Image width" value={imageWidth} onChange={setImageWidth} type="number" />
        <TextField id="photo-image-height" label="Image height" value={imageHeight} onChange={setImageHeight} type="number" />
        <div className="md:col-span-2">
          <Label htmlFor="photo-review-notes">Review notes</Label>
          <Textarea
            id="photo-review-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Why this view works, what face is shown, or anything to verify."
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add to review queue"}
        </Button>
      </div>
    </form>
  );
}

function PhotoCandidateCard({
  candidate,
  reviewEnabled,
  onFinalized,
}: {
  candidate: DestinationPhotoCandidate;
  reviewEnabled: boolean;
  onFinalized: (id: string) => void;
}) {
  const { getIdToken } = useAuth();
  const [reviewing, setReviewing] = useState<DestinationPhotoDecision | null>(null);
  const [focalX, setFocalX] = useState(candidate.focal_x);
  const [focalY, setFocalY] = useState(candidate.focal_y);
  const [savedFocalX, setSavedFocalX] = useState(candidate.focal_x);
  const [savedFocalY, setSavedFocalY] = useState(candidate.focal_y);
  const [savingFraming, setSavingFraming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const framingChanged = focalX !== savedFocalX || focalY !== savedFocalY;

  const saveFraming = async () => {
    setSavingFraming(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to save this framing");
      const saved = await updateDestinationPhotoCandidateFraming(token, candidate.id, {
        focalX,
        focalY,
      });
      setSavedFocalX(saved.focalX);
      setSavedFocalY(saved.focalY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save framing");
    } finally {
      setSavingFraming(false);
    }
  };

  const review = async (decision: DestinationPhotoDecision) => {
    setReviewing(decision);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to review this photo");
      await reviewDestinationPhotoCandidate(
        token,
        candidate.id,
        decision,
        null,
        requestedDestinationPhotoFraming(decision, focalX, focalY)
      );
      onFinalized(candidate.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review failed");
      setReviewing(null);
    }
  };

  const hasCurrentCover = Boolean(candidate.current_image_url);

  return (
    <article className="overflow-hidden rounded-media border border-border bg-page">
      <div className={`grid grid-cols-1 ${hasCurrentCover ? "lg:grid-cols-2" : ""}`}>
        <PhotoPreview
          label="Candidate · wide preview"
          src={candidate.image_url}
          alt={`${candidate.destination_name} candidate cover`}
          focalX={focalX}
          focalY={focalY}
        />
        {hasCurrentCover ? (
          <PhotoPreview
            label="Current cover · wide"
            src={candidate.current_image_url!}
            alt={`${candidate.destination_name} current cover`}
            focalX={candidate.current_image_focal_x}
            focalY={candidate.current_image_focal_y}
          />
        ) : null}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={`/admin/destinations/${candidate.destination_id}`}
              className="text-lg font-medium text-accent-text hover:underline"
            >
              {candidate.destination_name}
            </Link>
            <p className="mt-1 text-sm text-muted">
              {candidate.photographer} ·{" "}
              <a
                href={candidate.license_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text hover:underline"
              >
                {candidate.license_name}
              </a>
              {candidate.image_width && candidate.image_height ? (
                <span className="font-mono-num">
                  {` · ${candidate.image_width.toLocaleString()}×${candidate.image_height.toLocaleString()}`}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={candidate.status} />
            <Button href={candidate.source_page_url} external variant="secondary" size="sm">
              Open source
            </Button>
          </div>
        </div>

        {candidate.notes ? <p className="mt-4 max-w-[68ch] text-sm text-ink-2">{candidate.notes}</p> : null}

        {reviewEnabled ? (
          <section className="mt-8" aria-labelledby={`framing-${candidate.id}`}>
            <h3 id={`framing-${candidate.id}`} className="font-medium text-ink">
              Cover framing
            </h3>
            <p className="mt-1 max-w-[68ch] text-sm text-muted">
              Reposition the full image once. Every crop below uses the same saved point, and approval also saves unsaved changes.
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-5">
              <RangeField
                label="Horizontal frame"
                startLabel="Left"
                endLabel="Right"
                value={focalX}
                onChange={setFocalX}
                disabled={reviewing !== null || savingFraming}
              />
              <RangeField
                label="Vertical frame"
                startLabel="Top"
                endLabel="Bottom"
                value={focalY}
                onChange={setFocalY}
                disabled={reviewing !== null || savingFraming}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={saveFraming}
                disabled={!framingChanged || reviewing !== null || savingFraming}
              >
                {savingFraming ? "Saving…" : framingChanged ? "Save framing" : "Framing saved"}
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-4">
              <PhotoPreview
                label="App header · 16:9"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-video"
                className="w-64 max-w-full rounded-media"
              />
              <PhotoPreview
                label="Mobile · 3:2"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-[3/2]"
                className="w-56 max-w-full rounded-media"
              />
              <PhotoPreview
                label="Card · square"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-square"
                className="w-36 max-w-full rounded-media"
              />
            </div>
          </section>
        ) : null}

        {error ? <Notice className="mt-5">{error}</Notice> : null}

        {reviewEnabled ? (
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={() => review("deny")}
              disabled={reviewing !== null || savingFraming}
            >
              {reviewing === "deny" ? "Denying…" : "Deny"}
            </Button>
            <Button
              type="button"
              onClick={() => review("approve")}
              disabled={reviewing !== null || savingFraming}
            >
              {reviewing === "approve"
                ? "Storing & approving…"
                : framingChanged
                  ? "Save framing & approve"
                  : "Approve cover"}
            </Button>
          </div>
        ) : (
          <p className="mt-5 text-xs text-muted">
            Reviewed{" "}
            <span className="font-mono-num">
              {candidate.reviewed_at ? new Date(candidate.reviewed_at).toLocaleString() : "—"}
            </span>
            {candidate.final_image_url ? (
              <>
                {" · "}
                <a
                  href={candidate.final_image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-text hover:underline"
                >
                  Stored image
                </a>
              </>
            ) : null}
          </p>
        )}
      </div>
    </article>
  );
}

function RangeField({
  label,
  startLabel,
  endLabel,
  value,
  onChange,
  disabled,
}: {
  label: string;
  startLabel: string;
  endLabel: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="min-w-48 flex-1">
      <div className="mb-1 flex justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono-num tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className="w-full accent-accent"
        aria-label={label}
      />
      <div className="flex justify-between text-xs text-faint">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

function PhotoPreview({
  label,
  src,
  alt,
  focalX = 50,
  focalY = 50,
  aspectClassName = "aspect-[2/1]",
  className = "",
}: {
  label: string;
  src: string;
  alt: string;
  focalX?: number;
  focalY?: number;
  aspectClassName?: string;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden bg-fill ${aspectClassName} ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        style={{ objectPosition: `${focalX}% ${focalY}%` }}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
      />
      <Badge className="absolute left-3 top-3">{label}</Badge>
    </div>
  );
}

function StatusBadge({ status }: { status: DestinationPhotoStatus }) {
  const tone: Record<DestinationPhotoStatus, BadgeTone> = {
    pending: "amber",
    approved: "emerald",
    denied: "red",
  };

  return (
    <Badge tone={tone[status]} className="capitalize">
      {status}
    </Badge>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Notice({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={`text-sm text-alert ${className}`.trim()}>
      {children}
    </p>
  );
}
