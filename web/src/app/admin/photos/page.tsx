"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "../../../components/admin-guard";
import AdminNav from "../../../components/admin-nav";
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
    loadCandidates();
  }, [loadCandidates]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Destination photos</h2>
            <p className="text-sm text-gray-500 mt-1">
              Review licensed cover photos before they reach the site and app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((shown) => !shown)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {showAddForm ? "Close form" : "Add candidate"}
          </button>
        </div>

        {showAddForm && (
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
        )}

        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatus(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                status === tab.id
                  ? "border-blue-600 text-blue-700 dark:text-blue-300"
                  : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : loading ? (
          <div className="text-gray-500 py-12 text-center">{LOADING_LABEL}</div>
        ) : candidates.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-6 py-12 text-center text-gray-500">
            No {status} photo candidates.
          </div>
        ) : (
          <div className="space-y-6">
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
      </main>
    </div>
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

  useEffect(() => {
    if (destination || destinationQuery.trim().length < 2) {
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
  }, [destination, destinationQuery, getIdToken]);

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
      className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6"
    >
      <h3 className="font-semibold mb-4">New photo candidate</h3>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative md:col-span-2">
          <FieldLabel>Destination</FieldLabel>
          {destination ? (
            <div className="flex items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2">
              <span>
                {destination.name}
                <span className="ml-2 text-xs text-gray-500 font-mono">{destination.id}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setDestination(null);
                  setDestinationQuery("");
                }}
                className="text-sm text-gray-500 hover:text-red-600"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                value={destinationQuery}
                onChange={(event) => setDestinationQuery(event.target.value)}
                placeholder="Search for a mountain"
                className={inputClassName}
              />
              {(searching || matches.length > 0) && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-lg">
                  {searching ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>
                  ) : (
                    matches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => {
                          setDestination(match);
                          setMatches([]);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex justify-between gap-4"
                      >
                        <span>{match.name}</span>
                        <span className="text-xs text-gray-500">
                          {[match.state_code, match.country_code].filter(Boolean).join(", ")}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <TextField label="Direct image URL" value={imageUrl} onChange={setImageUrl} type="url" />
        <TextField label="Source page URL" value={sourcePageUrl} onChange={setSourcePageUrl} type="url" />
        <label className="block">
          <FieldLabel>Source</FieldLabel>
          <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)} className={inputClassName}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <TextField label="Photographer or agency" value={photographer} onChange={setPhotographer} />
        <TextField label="License name" value={licenseName} onChange={setLicenseName} placeholder="CC BY-SA 4.0" />
        <TextField label="License URL" value={licenseUrl} onChange={setLicenseUrl} type="url" />
        <TextField label="Image width" value={imageWidth} onChange={setImageWidth} type="number" />
        <TextField label="Image height" value={imageHeight} onChange={setImageHeight} type="number" />
        <label className="block md:col-span-2">
          <FieldLabel>Review notes</FieldLabel>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Why this view works, what face is shown, or anything to verify."
            className={inputClassName}
          />
        </label>
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Adding…" : "Add to review queue"}
        </button>
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
        decision === "approve" ? { focalX, focalY } : undefined
      );
      onFinalized(candidate.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review failed");
      setReviewing(null);
    }
  };

  const hasCurrentCover = Boolean(candidate.current_image_url);
  return (
    <article className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className={`grid grid-cols-1 ${hasCurrentCover ? "lg:grid-cols-2" : ""}`}>
        <PhotoPreview
          label="Candidate · wide preview"
          src={candidate.image_url}
          alt={`${candidate.destination_name} candidate cover`}
          focalX={focalX}
          focalY={focalY}
        />
        {hasCurrentCover && (
          <PhotoPreview
            label="Current cover · wide"
            src={candidate.current_image_url!}
            alt={`${candidate.destination_name} current cover`}
            focalX={candidate.current_image_focal_x}
            focalY={candidate.current_image_focal_y}
          />
        )}
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={`/admin/destinations/${candidate.destination_id}`} className="text-lg font-semibold hover:underline">
              {candidate.destination_name}
            </Link>
            <div className="mt-1 text-sm text-gray-500">
              {candidate.photographer} ·{" "}
              <a href={candidate.license_url} target="_blank" rel="noopener noreferrer" className="underline">
                {candidate.license_name}
              </a>
              {candidate.image_width && candidate.image_height
                ? ` · ${candidate.image_width.toLocaleString()}×${candidate.image_height.toLocaleString()}`
                : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={candidate.status} />
            <a
              href={candidate.source_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Open source
            </a>
          </div>
        </div>

        {candidate.notes && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{candidate.notes}</p>}
        {reviewEnabled && (
          <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-48 flex-1">
                <div className="flex justify-between gap-3 text-xs text-gray-500 mb-1">
                  <span>Horizontal frame</span>
                  <span>{focalX}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={focalX}
                  onChange={(event) => setFocalX(Number(event.target.value))}
                  disabled={reviewing !== null || savingFraming}
                  className="w-full accent-blue-600"
                  aria-label="Horizontal cover framing"
                />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Left</span><span>Right</span>
                </div>
              </div>
              <div className="min-w-48 flex-1">
                <div className="flex justify-between gap-3 text-xs text-gray-500 mb-1">
                  <span>Vertical frame</span>
                  <span>{focalY}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={focalY}
                  onChange={(event) => setFocalY(Number(event.target.value))}
                  disabled={reviewing !== null || savingFraming}
                  className="w-full accent-blue-600"
                  aria-label="Vertical cover framing"
                />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Top</span><span>Bottom</span>
                </div>
              </div>
              <button
                type="button"
                onClick={saveFraming}
                disabled={!framingChanged || reviewing !== null || savingFraming}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-white dark:hover:bg-gray-900 disabled:opacity-50"
              >
                {savingFraming ? "Saving…" : framingChanged ? "Save framing" : "Framing saved"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Reposition the full image once. Every crop below uses the same saved point, and approval also saves unsaved changes.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <PhotoPreview
                label="App header · 16:9"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-video"
                className="w-64 max-w-full rounded-md"
              />
              <PhotoPreview
                label="Mobile · 3:2"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-[3/2]"
                className="w-56 max-w-full rounded-md"
              />
              <PhotoPreview
                label="Card · square"
                src={candidate.image_url}
                alt=""
                focalX={focalX}
                focalY={focalY}
                aspectClassName="aspect-square"
                className="w-36 max-w-full rounded-md"
              />
            </div>
          </div>
        )}
        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

        {reviewEnabled ? (
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => review("deny")}
              disabled={reviewing !== null || savingFraming}
              className="px-4 py-2 text-sm border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
            >
              {reviewing === "deny" ? "Denying…" : "Deny"}
            </button>
            <button
              type="button"
              onClick={() => review("approve")}
              disabled={reviewing !== null || savingFraming}
              className="px-4 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50"
            >
              {reviewing === "approve" ? "Storing & approving…" : "Approve cover"}
            </button>
          </div>
        ) : (
          <div className="mt-4 text-xs text-gray-500">
            Reviewed {candidate.reviewed_at ? new Date(candidate.reviewed_at).toLocaleString() : "—"}
            {candidate.final_image_url && (
              <> · <a href={candidate.final_image_url} target="_blank" rel="noopener noreferrer" className="underline">Stored image</a></>
            )}
          </div>
        )}
      </div>
    </article>
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
    <div className={`relative bg-gray-100 dark:bg-gray-950 overflow-hidden ${aspectClassName} ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        style={{ objectPosition: `${focalX}% ${focalY}%` }}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
      />
      <span className="absolute top-3 left-3 rounded bg-black/70 text-white text-xs px-2 py-1">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: DestinationPhotoStatus }) {
  const classes = {
    pending: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    approved: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300",
    denied: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300",
  }[status];
  return <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${classes}`}>{status}</span>;
}

const inputClassName =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-sm font-medium mb-1">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClassName}
      />
    </label>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "error" }) {
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tone === "error" ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" : ""}`}>
      {children}
    </div>
  );
}
