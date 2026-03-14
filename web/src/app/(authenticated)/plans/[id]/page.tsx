"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth-context";
import {
  getPlan,
  updatePlan,
  deletePlan,
  inviteToPlan,
  type Plan,
} from "@/lib/actions/plans";
import { getDestination, type DestinationDetail } from "@/lib/actions/destinations";
import { getRoute, type RouteDetail } from "@/lib/actions/routes";
import PartyList from "@/components/party-list";
import DestinationPicker from "@/components/destination-picker";
import RoutePicker from "@/components/route-picker";

const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
});

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;
  const router = useRouter();
  const { user, getIdToken } = useAuth();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [destDetails, setDestDetails] = useState<
    Map<string, DestinationDetail>
  >(new Map());
  const [routeDetails, setRouteDetails] = useState<
    Map<string, RouteDetail>
  >(new Map());

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDestinations, setEditDestinations] = useState<string[]>([]);
  const [editRoutes, setEditRoutes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Invite state
  const [inviteUid, setInviteUid] = useState("");
  const [inviting, setInviting] = useState(false);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = plan?.userId === user?.uid;

  const loadPlan = useCallback(async () => {
    const token = await getIdToken();
    if (!token) return;

    const data = await getPlan(token, planId);
    setPlan(data);
    setLoading(false);

    if (data) {
      // Load destination details
      const destMap = new Map<string, DestinationDetail>();
      const destResults = await Promise.all(
        data.destinations.map((id) => getDestination(id))
      );
      for (let i = 0; i < data.destinations.length; i++) {
        const detail = destResults[i];
        if (detail) destMap.set(data.destinations[i], detail);
      }
      setDestDetails(destMap);

      // Load route details
      const routeMap = new Map<string, RouteDetail>();
      const routeResults = await Promise.all(
        data.routes.map((id) => getRoute(id))
      );
      for (let i = 0; i < data.routes.length; i++) {
        const detail = routeResults[i];
        if (detail) routeMap.set(data.routes[i], detail);
      }
      setRouteDetails(routeMap);
    }
  }, [getIdToken, planId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const startEditing = () => {
    if (!plan) return;
    setEditName(plan.name);
    setEditDescription(plan.description);
    setEditDate(plan.date || "");
    setEditDestinations([...plan.destinations]);
    setEditRoutes([...plan.routes]);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveChanges = async () => {
    if (!plan) return;
    setSaving(true);

    try {
      const token = await getIdToken();
      if (!token) return;

      await updatePlan(token, planId, {
        name: editName.trim(),
        description: editDescription.trim(),
        destinations: editDestinations,
        routes: editRoutes,
        date: editDate || undefined,
      });

      setEditing(false);
      await loadPlan();
    } catch (err) {
      console.error("Failed to save plan:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteUid.trim()) return;
    setInviting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      await inviteToPlan(token, planId, inviteUid.trim());
      setInviteUid("");
      await loadPlan();
    } catch (err) {
      console.error("Failed to invite:", err);
    } finally {
      setInviting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      await deletePlan(token, planId);
      router.push("/plans");
    } catch (err) {
      console.error("Failed to delete:", err);
      setDeleting(false);
    }
  };

  // Find a route polyline to display on the map
  const firstPolyline = Array.from(routeDetails.values()).find(
    (r) => r.polyline6
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Loading...</div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-gray-500 py-12 text-center">Plan not found</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          href="/plans"
          className="hover:text-gray-900 dark:hover:text-gray-100"
        >
          Plans
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {plan.name || "Untitled Plan"}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-2xl font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
            />
          ) : (
            <h1 className="text-2xl font-semibold">{plan.name}</h1>
          )}
          {plan.date && !editing && (
            <div className="text-sm text-gray-500 mt-1">
              {new Date(plan.date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
          {editing && (
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="mt-2 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          )}
        </div>
        {isOwner && !editing && (
          <button
            onClick={startEditing}
            className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
          >
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button
              onClick={saveChanges}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={cancelEditing}
              className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      {editing ? (
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          rows={3}
          placeholder="Trip notes..."
          className="w-full mb-6 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
        />
      ) : plan.description ? (
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {plan.description}
        </p>
      ) : null}

      {/* Map */}
      {firstPolyline?.polyline6 && !editing && (
        <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="font-semibold mb-3">Route Map</h3>
          <RouteMap polyline6={firstPolyline.polyline6} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Destinations */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Destinations ({plan.destinations.length})
          </h3>
          {editing ? (
            <DestinationPicker
              selectedIds={editDestinations}
              onChange={setEditDestinations}
            />
          ) : plan.destinations.length === 0 ? (
            <p className="text-sm text-gray-500">No destinations added</p>
          ) : (
            <div className="space-y-2">
              {plan.destinations.map((destId) => {
                const detail = destDetails.get(destId);
                return (
                  <Link
                    key={destId}
                    href={`/destinations/${destId}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {detail?.name || "Loading..."}
                      </div>
                      {detail?.elevation != null && (
                        <div className="text-xs text-gray-500">
                          {Math.round(
                            detail.elevation * 3.28084
                          ).toLocaleString()}{" "}
                          ft
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Routes */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Routes ({plan.routes.length})
          </h3>
          {editing ? (
            <RoutePicker selectedIds={editRoutes} onChange={setEditRoutes} />
          ) : plan.routes.length === 0 ? (
            <p className="text-sm text-gray-500">No routes added</p>
          ) : (
            <div className="space-y-2">
              {plan.routes.map((routeId) => {
                const detail = routeDetails.get(routeId);
                return (
                  <Link
                    key={routeId}
                    href={`/routes/${routeId}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {detail?.name || "Loading..."}
                      </div>
                      <div className="text-xs text-gray-500">
                        {detail?.distance != null &&
                          `${(detail.distance / 1609.34).toFixed(1)} mi`}
                        {detail?.gain != null &&
                          ` · ${Math.round(detail.gain * 3.28084).toLocaleString()} ft gain`}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Party */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="font-semibold mb-4">
            Party ({plan.party.length + 1})
          </h3>

          {/* Owner */}
          <div className="mb-3 p-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
            <div className="text-sm font-medium">
              {user?.displayName || user?.email || "You"}{" "}
              <span className="text-xs text-gray-500">(owner)</span>
            </div>
          </div>

          <PartyList partyIds={plan.party} />

          {/* Invite */}
          {isOwner && (
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={inviteUid}
                onChange={(e) => setInviteUid(e.target.value)}
                placeholder="User ID to invite"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteUid.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {inviting ? "..." : "Invite"}
              </button>
            </div>
          )}
        </div>

        {/* Danger Zone */}
        {isOwner && !editing && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-900 p-6">
            <h3 className="font-semibold mb-4 text-red-600 dark:text-red-400">
              Danger Zone
            </h3>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                Delete Plan
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Are you sure? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? "Deleting..." : "Yes, Delete"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-sm font-medium hover:border-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
