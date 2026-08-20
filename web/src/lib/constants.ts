// Small, hand-picked constants shared across the public pages. Values here
// are either UI copy that must read identically everywhere, or curated data
// that isn't worth a database round trip.

/** The one loading string used across the app's public pages. Replaces the
 * "Loading..." / "Loading…" split — pick a spot, use it everywhere. */
export const LOADING_LABEL = "Loading…";

export interface CuratedDestination {
  id: string;
  name: string;
}

/**
 * "Popular searches" chips on the discover page. A hand-picked set of
 * well-known catalog entries, replacing a raw "most sessions" database
 * slice that surfaced obscure, zero-activity destinations.
 *
 * IDs were verified live against getpeaks.app search on 2026-08-19 (name,
 * elevation, and feature tags all checked against the real catalog entry —
 * direct database access was unavailable in that session). Re-verify before
 * reusing these IDs if the catalog changes.
 */
export const CURATED_POPULAR_DESTINATIONS: CuratedDestination[] = [
  { id: "Tg5URBHkVwPA1gGKKB4Q", name: "Mount Rainier" },
  { id: "Ta8deqYutGWWgheXfg4q", name: "Mount Whitney" },
  { id: "ERm0v7h6iCoEW5lLUUqF", name: "Mount Hood" },
  { id: "nSf6z4vL0zjdG2sXibBM", name: "Mount Si" },
  { id: "qx1MLLdRIw7qkPBQPBnU", name: "Katahdin" },
  { id: "OummFegY7fGoN2X7RdCz", name: "Half Dome" },
];
