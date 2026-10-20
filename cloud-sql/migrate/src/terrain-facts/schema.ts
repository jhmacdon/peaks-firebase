/**
 * The shape a terrain researcher must return. Codex enforces it through
 * `--output-schema`, so every property is required and nullable values are
 * spelled out: strict structured output has no optional keys.
 */

export const TERRAINS = ["maintained_trail", "rough_trail", "talus_or_boulders", "scramble", "technical_climb", "snow", "glacier", "road", "unknown"] as const;
export const FEATURE_TYPES = ["scramble", "technical_climb", "rough_trail", "talus_or_boulders", "glacier", "snowfield", "exposure", "fixed_aid", "other"] as const;
export const YDS = ["1", "2", "3", "4", "5", "unknown"] as const;
export const HANDS = ["required", "occasional", "not_needed", "unknown"] as const;
export const ANCHORS = ["waypoint", "elevation_band", "stretch", "summit_block", "route_wide", "unknown"] as const;
export const SOURCE_TYPES = ["official", "route_page", "guide_service", "guidebook_excerpt", "trip_report", "forum", "encyclopedia", "other"] as const;

export type Terrain = typeof TERRAINS[number];
export type FeatureType = typeof FEATURE_TYPES[number];
export type Yds = typeof YDS[number];
export type Hands = typeof HANDS[number];

export interface Claim { id: string; source_url: string; publisher: string; source_type: typeof SOURCE_TYPES[number]; quote: string; establishes: string }
export interface FeatureLocation { anchor: typeof ANCHORS[number]; waypoint_id: string | null; stretch_ids: string[]; from_ft: number | null; to_ft: number | null; claim_ids: string[]; note: string }
export interface Feature { id: string; type: FeatureType; yds_class: Yds; hands: Hands; location: FeatureLocation; season: string | null; claim_ids: string[]; conflicting: boolean; note: string }
export interface StretchFinding { stretch_id: string; terrain: Terrain; claim_ids: string[] }
export interface Valued<T> { value: T; claim_ids: string[] }
export interface Research {
  route_id: string;
  packet_sha256: string;
  route: { hardest_class: Valued<Yds>; hands_needed_anywhere: Valued<"yes" | "no" | "unknown">; glacier_travel: Valued<"yes" | "no" | "unknown">; technical_gear: Valued<"yes" | "no" | "unknown"> };
  features: Feature[];
  stretches: StretchFinding[];
  claims: Claim[];
  unknowns: string[];
  conflicts: string[];
  sources_consulted: string[];
}

const str = { type: "string" } as const;
const strs = { type: "array", items: str } as const;
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const valued = (values: readonly string[]) => obj({ value: { type: "string", enum: values }, claim_ids: strs });

export const researchSchema = obj({
  route_id: str,
  packet_sha256: str,
  route: obj({ hardest_class: valued(YDS), hands_needed_anywhere: valued(["yes", "no", "unknown"]), glacier_travel: valued(["yes", "no", "unknown"]), technical_gear: valued(["yes", "no", "unknown"]) }),
  features: { type: "array", items: obj({
    id: str, type: { type: "string", enum: FEATURE_TYPES }, yds_class: { type: "string", enum: YDS }, hands: { type: "string", enum: HANDS },
    location: obj({ anchor: { type: "string", enum: ANCHORS }, waypoint_id: nullable(str), stretch_ids: strs, from_ft: nullable({ type: "number" }), to_ft: nullable({ type: "number" }), claim_ids: strs, note: str }),
    season: nullable(str), claim_ids: strs, conflicting: { type: "boolean" }, note: str,
  }) },
  stretches: { type: "array", items: obj({ stretch_id: str, terrain: { type: "string", enum: TERRAINS }, claim_ids: strs }) },
  claims: { type: "array", items: obj({ id: str, source_url: str, publisher: str, source_type: { type: "string", enum: SOURCE_TYPES }, quote: str, establishes: str }) },
  unknowns: strs,
  conflicts: strs,
  sources_consulted: strs,
});
