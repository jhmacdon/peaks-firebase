// Feature-specific facts about a destination, persisted as JSONB in
// destinations.amenities. Schema is feature-dependent — extend with
// HutAmenities / TrailheadAmenities as those features grow facts to
// store. The DB only enforces JSONB validity; the contract here is the
// source of truth.

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

export type Amenities = CampsiteAmenities;
