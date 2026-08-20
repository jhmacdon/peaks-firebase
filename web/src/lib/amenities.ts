// Feature-specific facts about a destination, persisted as JSONB in
// destinations.amenities. Schema is feature-dependent — extend with
// HutAmenities as that feature grows facts to store. The DB only enforces
// JSONB validity; the contract here is the source of truth.
//
// Keep cloud-sql/migrate/src/lib/amenities.ts and web/src/lib/amenities.ts
// in sync — there is no shared package between the two apps, so any change
// to one must be mirrored to the other by hand. web/src/lib/amenities.test.ts
// asserts the two files are byte-identical.

export type ToiletType = 'flush' | 'pit' | 'vault' | 'none';
export type WaterAvailability = 'yes' | 'no' | 'seasonal';
export type ReservationPolicy = 'required' | 'recommended' | 'no';

export interface CampsiteFee {
  required: boolean;
  amount?: string;  // raw OSM value, e.g. "$15", "5 EUR"
}

export interface CampsiteAmenities {
  toilet?: ToiletType;
  drinking_water?: WaterAvailability;
  shower?: boolean;
  fee?: CampsiteFee;
  reservation?: ReservationPolicy;
  capacity?: number;
  fire_pit?: boolean;
  tents?: boolean;
  caravans?: boolean;
  max_length?: number;  // meters, for RV
  backcountry?: boolean;
  power_supply?: boolean;
}

// A single fact about a trailhead, carrying its own provenance rather than
// relying on one row-wide source. A parking capacity may come from OSM while
// the fee comes from a land manager's website, so each leaf needs to name
// its own source and its own verification time.
//
// retrieved_at is distinct from last_verified_at on purpose: fetching an OSM
// or agency record does not prove someone checked the real-world condition
// that day. Do not use destinations.updated_at as verification evidence —
// any row update changes it (see cloud-sql/CLAUDE.md).
export type SourcedValue<T> = {
  value: T;
  source: {
    kind: string;
    name: string;
    url?: string;
    license?: string;
    external_id?: string;
  };
  source_updated_at?: string;  // ISO date, when the provider last touched the record
  retrieved_at: string;        // ISO date, when we fetched it — fetching is not verifying
  last_verified_at?: string;   // ISO date, when a human/agency confirmed the real-world fact
};

export type TrailheadHighClearance = 'required' | 'recommended' | 'not_required';
export type TrailheadBathroomStatus = 'present' | 'absent';
export type TrailheadBathroomType = 'vault_pit' | 'flush' | 'portable' | 'composting' | 'unspecified';

// What the parking is, not how much of it there is. A source can map a lot
// without counting a single space — the National Park Service publishes 6,740
// lot polygons and no capacity field at all — and "there is a lot here" is a
// fact worth printing on its own. 'roadside' is a pullout or shoulder rather
// than a marked lot; 'garage' is a structure. Never infer capacity from this.
export type TrailheadParkingType = 'lot' | 'roadside' | 'garage' | 'other';

export interface TrailheadSeasonalWindow {
  opens: string;   // e.g. "05-15" (MM-DD) or a provider's raw seasonal text
  closes: string;
}

export interface TrailheadParking {
  type?: SourcedValue<TrailheadParkingType>;
  fee_required?: SourcedValue<boolean>;
  day_fee_usd?: SourcedValue<number>;
  annual_fee_usd?: SourcedValue<number>;
  passes_accepted?: SourcedValue<string[]>;   // e.g. ["America the Beautiful", "Northwest Forest Pass"]
  fee_waived_for?: SourcedValue<string[]>;    // e.g. ["holders of Access Pass"]
  capacity_vehicles?: SourcedValue<number>;
  fills_early_note?: SourcedValue<string>;    // free text, e.g. "full by 7am on summer weekends"
  location_note?: SourcedValue<string>;
}

// Typed now, populated by a later phase: no importer writes this block yet.
export interface TrailheadRoadAccess {
  surface?: SourcedValue<string>;             // e.g. "paved", "gravel", "dirt"
  high_clearance?: SourcedValue<TrailheadHighClearance>;
  four_wheel_drive?: SourcedValue<boolean>;
  seasonal_window?: SourcedValue<TrailheadSeasonalWindow>;
  limiting_segment_ref?: SourcedValue<string>;  // free-form reference to the road's worst segment
}

export interface TrailheadBathrooms {
  status?: SourcedValue<TrailheadBathroomStatus>;
  type?: SourcedValue<TrailheadBathroomType>;
  season_note?: SourcedValue<string>;   // e.g. "closed in winter, no water"
  location_note?: SourcedValue<string>;
}

// An absent leaf — or an absent block — means unknown. Never encode
// "unknown" as a value; omit the key instead.
export interface TrailheadAmenities {
  parking?: TrailheadParking;
  road_access?: TrailheadRoadAccess;
  bathrooms?: TrailheadBathrooms;
}

export type Amenities = CampsiteAmenities | TrailheadAmenities;

// CampsiteAmenities and TrailheadAmenities share no keys, so presence of any
// trailhead-only block is a reliable discriminant — the same
// `(value): value is T` type-predicate idiom used everywhere else in this
// codebase to narrow a union (e.g. route-integrity-repairs.ts'
// `validRepairState`, standard-route-job-state.ts's `isJobState`), rather
// than adding a `kind` tag field that every existing CampsiteAmenities
// writer (e.g. import-osm-campsites-wa.ts) would have to start setting.
// `{}` narrows as CampsiteAmenities, matching prior behavior (before this
// union existed, every Amenities value was read as CampsiteAmenities).
//
// TRAILHEAD_BLOCKS is keyed off `keyof TrailheadAmenities` rather than a
// hand-typed list of block names, so adding a fourth block to the interface
// (e.g. `water`) fails the build here instead of silently falling through to
// the campsite renderer.
const TRAILHEAD_BLOCKS: Record<keyof TrailheadAmenities, true> = {
  parking: true,
  road_access: true,
  bathrooms: true,
};

export function isTrailheadAmenities(amenities: Amenities): amenities is TrailheadAmenities {
  return Object.keys(TRAILHEAD_BLOCKS).some((key) => key in amenities);
}

export function isCampsiteAmenities(amenities: Amenities): amenities is CampsiteAmenities {
  return !isTrailheadAmenities(amenities);
}
