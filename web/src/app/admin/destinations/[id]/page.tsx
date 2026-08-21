"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AdminGuard from "../../../../components/admin-guard";
import UserPopover from "../../../../components/user-popover";
import dynamic from "next/dynamic";
import {
  AdminPage,
  AdminPageHeader,
} from "../../../../components/admin/admin-page";
import { Breadcrumb } from "../../../../components/detail-sections";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Select } from "../../../../components/ui/field";
import { SectionHeading } from "../../../../components/ui/section-heading";
import { StatCluster } from "../../../../components/ui/stat";
import { useAuth } from "../../../../lib/auth-context";
import {
  getDestination,
  getDestinationRoutes,
  getDestinationLists,
  getDestinationSessionCount,
  updateDestination,
  updateDestinationBoundary,
  deleteDestinationBoundary,
  reverseGeocodeDestination,
  type DestinationDetail,
  type DestinationRoute,
  type DestinationList,
} from "../../../../lib/actions/destinations";
import {
  isTrailheadAmenities,
  type Amenities,
  type CampsiteAmenities,
  type TrailheadAmenities,
} from "../../../../lib/amenities";
import { roadAccessBadge } from "../../../../lib/trailhead-road-access";
import { parkingBadge } from "../../../../lib/trailhead-parking";
import { LOADING_LABEL } from "../../../../lib/constants";

const DestinationMap = dynamic(() => import("../../../../components/destination-map"), {
  ssr: false,
});

const BoundaryEditorMap = dynamic(() => import("../../../../components/boundary-editor-map"), {
  ssr: false,
});

export default function DestinationDetailPage() {
  return (
    <AdminGuard>
      <DestinationDetailContent />
    </AdminGuard>
  );
}

function DestinationDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const { getIdToken } = useAuth();

  const [dest, setDest] = useState<DestinationDetail | null>(null);
  const [routes, setRoutes] = useState<DestinationRoute[]>([]);
  const [lists, setLists] = useState<DestinationList[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editFeatures, setEditFeatures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [pendingBoundary, setPendingBoundary] = useState<GeoJSON.Polygon | null>(null);
  const [savingBoundary, setSavingBoundary] = useState(false);

  useEffect(() => {
    async function load() {
      const [d, r, l, s] = await Promise.all([
        getDestination(id),
        getDestinationRoutes(id),
        getDestinationLists(id),
        getDestinationSessionCount(id),
      ]);
      setDest(d);
      setRoutes(r);
      setLists(l);
      setSessionCount(s);
      if (d) {
        setEditName(d.name || "");
        setEditType(d.type);
        setEditFeatures(Array.isArray(d.features) ? [...d.features] : []);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    const token = await getIdToken();
    if (!token) {
      setSaving(false);
      return;
    }
    await updateDestination(token, id, { name: editName, type: editType, features: editFeatures });
    setDest((prev) =>
      prev ? { ...prev, name: editName, type: editType, features: editFeatures } : prev
    );
    setEditing(false);
    setSaving(false);
  };

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const result = await reverseGeocodeDestination(id);
      setDest((prev) =>
        prev
          ? {
              ...prev,
              country_code: result.country_code || prev.country_code,
              state_code: result.state_code || prev.state_code,
            }
          : prev
      );
    } catch (err: unknown) {
      console.error("Geocoding failed:", err);
    } finally {
      setGeocoding(false);
    }
  };

  const handleSaveBoundary = async () => {
    if (!pendingBoundary) return;
    setSavingBoundary(true);
    await updateDestinationBoundary(id, pendingBoundary);
    setDest((prev) => prev ? { ...prev, boundary: pendingBoundary } : prev);
    setEditingBoundary(false);
    setPendingBoundary(null);
    setSavingBoundary(false);
  };

  const handleDeleteBoundary = async () => {
    setSavingBoundary(true);
    await deleteDestinationBoundary(id);
    setDest((prev) => prev ? { ...prev, boundary: null } : prev);
    setEditingBoundary(false);
    setPendingBoundary(null);
    setSavingBoundary(false);
  };

  if (loading) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">{LOADING_LABEL}</div>
      </AdminPage>
    );
  }

  if (!dest) {
    return (
      <AdminPage>
        <div className="py-16 text-center text-sm text-muted">Destination not found</div>
      </AdminPage>
    );
  }

  return (
    <AdminPage className="space-y-12">
      <AdminPageHeader
        breadcrumb={
          <Breadcrumb
            current={dest.name || "Unnamed"}
            parentHref="/admin/destinations"
            parentLabel="Destinations"
          />
        }
        title={
          editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Destination name"
              className="w-full max-w-xl border-b-2 border-accent bg-transparent pb-1 font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]"
              autoFocus
            />
          ) : (
            dest.name || "Unnamed"
          )
        }
        description={<span className="font-mono-num text-xs text-faint">{dest.id}</span>}
        actions={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <StatCluster
          scale="topline"
          label="Elevation"
          value={dest.elevation ? Math.round(dest.elevation * 3.28084).toLocaleString() : "—"}
          unit={dest.elevation ? "ft" : undefined}
        />
        <StatCluster
          scale="topline"
          label="Prominence"
          value={dest.prominence ? Math.round(dest.prominence * 3.28084).toLocaleString() : "—"}
          unit={dest.prominence ? "ft" : undefined}
        />
        <StatCluster scale="topline" label="Routes" value={routes.length.toLocaleString()} />
        {sessionCount > 0 ? (
          <Link href={`/admin/sessions?destination=${id}`} className="hover:underline">
            <StatCluster scale="topline" label="Sessions" value={sessionCount.toLocaleString()} />
          </Link>
        ) : (
          <StatCluster scale="topline" label="Sessions" value="0" />
        )}
      </div>

      {dest.hero_image && (
        <figure className="overflow-hidden rounded-media bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dest.hero_image}
            alt={dest.name || "Destination"}
            className="h-72 w-full object-cover lg:h-96"
          />
          {dest.hero_image_attribution && (
            <figcaption className="px-4 py-2 text-xs text-muted">
              Photo:{" "}
              {dest.hero_image_attribution_url ? (
                <a
                  href={dest.hero_image_attribution_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-text hover:underline"
                >
                  {dest.hero_image_attribution}
                </a>
              ) : (
                dest.hero_image_attribution
              )}
            </figcaption>
          )}
        </figure>
      )}

      {dest.lat != null && dest.lng != null && (
        <section aria-labelledby="destination-location">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SectionHeading>
              <span id="destination-location">Location</span>
            </SectionHeading>
            <div className="flex flex-wrap items-center gap-2">
              {dest.boundary && !editingBoundary ? <Badge>Boundary set</Badge> : null}
              {editingBoundary ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingBoundary(false);
                      setPendingBoundary(null);
                    }}
                  >
                    Cancel
                  </Button>
                  {dest.boundary || pendingBoundary ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={handleDeleteBoundary}
                      disabled={savingBoundary}
                    >
                      Clear boundary
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={handleSaveBoundary}
                    disabled={!pendingBoundary || savingBoundary}
                  >
                    {savingBoundary ? "Saving..." : "Save boundary"}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingBoundary(true);
                    setPendingBoundary(null);
                  }}
                >
                  {dest.boundary ? "Edit boundary" : "Draw boundary"}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-media">
            {editingBoundary ? (
              <BoundaryEditorMap
                lat={dest.lat}
                lng={dest.lng}
                name={dest.name}
                boundary={dest.boundary}
                onBoundaryChange={setPendingBoundary}
              />
            ) : (
              <DestinationMap
                lat={dest.lat}
                lng={dest.lng}
                name={dest.name}
                boundary={dest.boundary}
                className="z-0 h-80"
              />
            )}
          </div>
        </section>
      )}

      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <section aria-labelledby="destination-details">
          <SectionHeading>
            <span id="destination-details">Details</span>
          </SectionHeading>
          <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-sm">
              <DetailRow label="Type">
                {editing ? (
                  <Select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="h-8 max-w-40 py-0 text-xs"
                  >
                    <option value="point">Point</option>
                    <option value="region">Region</option>
                  </Select>
                ) : (
                  <span className="capitalize">{dest.type}</span>
                )}
              </DetailRow>
              <DetailRow label="Owner">
                {dest.owner === "peaks" ? (
                  <Badge>Peaks (system)</Badge>
                ) : (
                  <UserPopover uid={dest.owner} />
                )}
              </DetailRow>
              <DetailRow label="Features">
                {editing ? (
                  <div className="flex flex-wrap gap-1.5 justify-end items-center">
                    {editFeatures.map((f) => (
                      <Badge key={f}>
                        {f}
                        <button
                          onClick={() => setEditFeatures((fs) => fs.filter((x) => x !== f))}
                          aria-label={`Remove ${f}`}
                          className="ml-1 text-faint transition-colors hover:text-alert"
                        >
                          &times;
                        </button>
                      </Badge>
                    ))}
                    <Select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !editFeatures.includes(e.target.value)) {
                          setEditFeatures((fs) => [...fs, e.target.value]);
                        }
                      }}
                      className="h-8 max-w-32 py-0 text-xs"
                    >
                      <option value="">+ Add</option>
                      {["summit", "trailhead", "volcano", "fire-lookout", "hut", "lookout", "lake", "landform", "viewpoint", "waterfall", "campsite"]
                        .filter((f) => !editFeatures.includes(f))
                        .map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                    </Select>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {Array.isArray(dest.features) && dest.features.length > 0 ? (
                      dest.features.map((f) => (
                        <Badge key={f}>{f}</Badge>
                      ))
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </div>
                )}
              </DetailRow>
              {(Array.isArray(dest.activities) && dest.activities.length > 0) && (
                <DetailRow label="Activities">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {dest.activities.map((a) => (
                      <Badge key={a}>{a}</Badge>
                    ))}
                  </div>
                </DetailRow>
              )}
              {dest.amenities && Object.keys(dest.amenities).length > 0 && (
                <DetailRow label="Amenities">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {formatAmenityBadges(dest.amenities).map((b) => (
                      <Badge key={b}>{b}</Badge>
                    ))}
                  </div>
                </DetailRow>
              )}
              <DetailRow label="Country">
                {dest.country_code || <span className="text-faint">—</span>}
              </DetailRow>
              <DetailRow label="State">
                {dest.state_code || <span className="text-faint">—</span>}
              </DetailRow>
              {(!dest.country_code || !dest.state_code) && dest.lat != null && dest.lng != null && (
                <DetailRow label="Location data">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleGeocode}
                    disabled={geocoding}
                  >
                    {geocoding ? "Looking up..." : "Populate Location Data"}
                  </Button>
                </DetailRow>
              )}
              {dest.lat != null && dest.lng != null && (
                <DetailRow label="Coordinates">
                  <span className="font-mono-num text-xs text-ink-2">
                    {dest.lat.toFixed(5)}, {dest.lng.toFixed(5)}
                  </span>
                </DetailRow>
              )}
              {dest.geohash && (
                <DetailRow label="Geohash">
                  <span className="font-mono-num text-xs text-ink-2">{dest.geohash}</span>
                </DetailRow>
              )}
              <DetailRow label="Created">
                {new Date(dest.created_at).toLocaleDateString()}
              </DetailRow>
              <DetailRow label="Updated">
                {new Date(dest.updated_at).toLocaleDateString()}
              </DetailRow>
            </dl>
        </section>

        <div className="space-y-12">
          <section aria-labelledby="destination-routes">
            <SectionHeading>
              <span id="destination-routes">Routes ({routes.length})</span>
            </SectionHeading>
              {routes.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No routes linked</p>
              ) : (
                <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {routes.map((route) => (
                    <li key={route.id}>
                      <Link
                        href={`/admin/routes/${route.id}`}
                        className="group flex items-center justify-between gap-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink group-hover:underline">
                            {route.name || "Unnamed Route"}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {route.distance ? (
                              <span className="font-mono-num tabular-nums">
                                {(route.distance / 1609.34).toFixed(1)} mi
                              </span>
                            ) : null}
                            {route.gain ? (
                              <>
                                {route.distance ? " · " : null}
                                <span className="font-mono-num tabular-nums">
                                  {Math.round(route.gain * 3.28084).toLocaleString()} ft
                                </span>{" "}
                                gain
                              </>
                            ) : null}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono-num text-xs text-faint">
                          #{route.ordinal}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section aria-labelledby="destination-lists">
            <SectionHeading>
              <span id="destination-lists">Lists ({lists.length})</span>
            </SectionHeading>
              {lists.length === 0 ? (
                <p className="mt-4 text-sm text-muted">Not in any lists</p>
              ) : (
                <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                  {lists.map((list) => (
                    <li key={list.id}>
                      <Link
                        href={`/lists/${list.id}`}
                        className="group flex items-center justify-between gap-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink group-hover:underline">
                            {list.name || "Unnamed List"}
                          </span>
                          {list.description ? (
                            <span className="mt-0.5 block max-w-xs truncate text-xs text-muted">
                              {list.description}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          <span className="font-mono-num tabular-nums">
                            {list.destination_count.toLocaleString()}
                          </span>{" "}
                          dest.
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      </div>
    </AdminPage>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}

function formatAmenityBadges(a: Amenities): string[] {
  return isTrailheadAmenities(a) ? formatTrailheadAmenityBadges(a) : formatCampsiteAmenityBadges(a);
}

function formatCampsiteAmenityBadges(a: CampsiteAmenities): string[] {
  const out: string[] = [];
  if (a.toilet === "flush") out.push("flush toilet");
  else if (a.toilet === "pit") out.push("pit toilet");
  else if (a.toilet === "vault") out.push("vault toilet");
  else if (a.toilet === "none") out.push("no toilet");
  if (a.drinking_water === "yes") out.push("water");
  else if (a.drinking_water === "seasonal") out.push("seasonal water");
  else if (a.drinking_water === "no") out.push("no water");
  if (a.shower) out.push("shower");
  if (a.fee?.required) out.push(a.fee.amount ? `fee (${a.fee.amount})` : "fee");
  else if (a.fee && a.fee.required === false) out.push("free");
  if (a.reservation === "required") out.push("reservation required");
  else if (a.reservation === "recommended") out.push("reservation recommended");
  if (a.capacity != null) out.push(`${a.capacity} sites`);
  if (a.fire_pit) out.push("fire pit");
  if (a.tents === false) out.push("no tents");
  if (a.caravans) out.push("RVs ok");
  if (a.max_length != null) out.push(`max ${a.max_length}m`);
  if (a.backcountry) out.push("backcountry");
  if (a.power_supply) out.push("power");
  return out;
}

// A representative subset, not every leaf — matches formatCampsiteAmenityBadges
// above. Structured facts, plus the lot's own name, which is what someone
// checking an import against a map actually needs. The road and parking chips
// are composed by the same helpers the public page prints, so the two cannot
// drift.
function formatTrailheadAmenityBadges(a: TrailheadAmenities): string[] {
  const out: string[] = [];
  const { parking, road_access, bathrooms } = a;

  // A dollar amount is a fee fact on its own: the importer writes day_fee_usd
  // without fee_required whenever the source dataset contradicts a no-fee
  // claim, so the boolean cannot be the gate.
  const dayFee = parking?.day_fee_usd?.value;
  const annualFee = parking?.annual_fee_usd?.value;
  if (dayFee != null) out.push(`parking fee ($${dayFee}/day)`);
  else if (parking?.fee_required?.value) out.push("parking fee");
  else if (annualFee != null) out.push(`parking fee (annual $${annualFee})`);
  else if (parking?.fee_required?.value === false) out.push("free parking");
  // Spaces where they were counted, otherwise the kind of parking — the same
  // helper the public page prints, so the two cannot drift.
  const parkingChip = parkingBadge(parking);
  if (parkingChip) out.push(parkingChip);

  if (bathrooms?.status?.value === "present") {
    switch (bathrooms.type?.value) {
      case "flush": out.push("flush toilet"); break;
      case "vault_pit": out.push("vault toilet"); break;
      case "portable": out.push("portable toilet"); break;
      case "composting": out.push("composting toilet"); break;
      default: out.push("restroom");
    }
  } else if (bathrooms?.status?.value === "absent") {
    out.push("no restroom");
  }

  const road = roadAccessBadge(road_access);
  if (road) out.push(road);

  return out;
}
