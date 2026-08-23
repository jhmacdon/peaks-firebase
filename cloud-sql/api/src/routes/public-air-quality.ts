import { Router } from "express";
import { asyncRoute } from "../lib/async-route";
import {
  AIR_QUALITY_CACHE_POLICY,
  AirQualityProvider,
  AirQualityRequestAbortedError,
  classifyAirQualitySourceAge,
  classifyAirQualityFreshness,
  createProductionAirQualityProvider,
} from "../air-quality-provider";
import { AIRNOW_SOURCE, AirQualityReportingArea } from "../air-quality-reporting-area";

export const AIR_QUALITY_MIN_ZOOM = 4;
export const AIR_QUALITY_MAX_ZOOM = 14;
export const AIR_QUALITY_VIEWPORT_GRID_DEGREES = 0.1;
export const AIR_QUALITY_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface AirQualityViewport {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  quantizationDegrees: number;
}

type ViewportParseResult =
  | { ok: true; viewport: AirQualityViewport }
  | { ok: false; message: string; fields: string[] };

const DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const WHOLE_NUMBER = /^\d+$/;

function readNumber(value: unknown, whole = false): number | null {
  if (typeof value !== "string" || value === "") return null;
  if (!(whole ? WHOLE_NUMBER : DECIMAL).test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function isGridAligned(value: number): boolean {
  const gridValue = value / AIR_QUALITY_VIEWPORT_GRID_DEGREES;
  return Math.abs(gridValue - Math.round(gridValue)) < 1e-9;
}

export function parseAirQualityViewport(query: Record<string, unknown>): ViewportParseResult {
  const names = ["west", "south", "east", "north"] as const;
  const parsed: Partial<Record<(typeof names)[number], number>> = {};
  const invalid: string[] = [];
  for (const name of names) {
    const value = readNumber(query[name]);
    if (value === null) invalid.push(name);
    else parsed[name] = value;
  }
  const zoom = readNumber(query.zoom, true);
  if (zoom === null) invalid.push("zoom");
  if (invalid.length > 0) {
    return { ok: false, message: "Viewport values must be single finite numbers.", fields: invalid };
  }

  const west = parsed.west!;
  const south = parsed.south!;
  const east = parsed.east!;
  const north = parsed.north!;
  if (west < -180 || east > 180 || west >= east) {
    return {
      ok: false,
      message: "west and east must form a non-wrapping longitude range within -180...180.",
      fields: ["west", "east"],
    };
  }
  if (south < -90 || north > 90 || south >= north) {
    return {
      ok: false,
      message: "south and north must form a latitude range within -90...90.",
      fields: ["south", "north"],
    };
  }
  if (zoom! < AIR_QUALITY_MIN_ZOOM || zoom! > AIR_QUALITY_MAX_ZOOM) {
    return {
      ok: false,
      message: `zoom must be an integer from ${AIR_QUALITY_MIN_ZOOM} through ${AIR_QUALITY_MAX_ZOOM}.`,
      fields: ["zoom"],
    };
  }

  const unaligned = names.filter((name) => !isGridAligned(parsed[name]!));
  if (unaligned.length > 0) {
    return {
      ok: false,
      message: "Viewport bounds must already be outward-rounded to the 0.1-degree grid.",
      fields: unaligned,
    };
  }

  // A generous zoom-linked cap rejects whole-country harvesting while still
  // allowing several screen widths for map prefetch. Dateline viewports must
  // be split into two calls so the cache key and point filter stay clear.
  const maxLongitudeSpan = Math.max(0.2, Math.min(90, 1440 / 2 ** zoom!));
  const maxLatitudeSpan = Math.max(0.2, Math.min(60, 1080 / 2 ** zoom!));
  const spanTolerance = 1e-9;
  if (
    east - west - maxLongitudeSpan > spanTolerance ||
    north - south - maxLatitudeSpan > spanTolerance
  ) {
    return {
      ok: false,
      message: "Viewport is too large for its zoom level.",
      fields: ["west", "south", "east", "north", "zoom"],
    };
  }

  return {
    ok: true,
    viewport: {
      west: rounded(west),
      south: rounded(south),
      east: rounded(east),
      north: rounded(north),
      zoom: zoom!,
      quantizationDegrees: AIR_QUALITY_VIEWPORT_GRID_DEGREES,
    },
  };
}

function isInViewport(area: AirQualityReportingArea, viewport: AirQualityViewport): boolean {
  const [longitude, latitude] = area.geometry.coordinates;
  return (
    longitude >= viewport.west &&
    longitude <= viewport.east &&
    latitude >= viewport.south &&
    latitude <= viewport.north
  );
}

function baseEnvelope(viewport: AirQualityViewport) {
  return {
    viewport,
    source: AIRNOW_SOURCE,
  };
}

export interface PublicAirQualityRouterOptions {
  nowMs?: () => number;
}

export function createPublicAirQualityRouter(
  provider: AirQualityProvider,
  options: PublicAirQualityRouterOptions = {}
): Router {
  const router = Router();
  const nowMs = options.nowMs ?? Date.now;

  router.get(
    "/viewport",
    asyncRoute(async (req, res) => {
      const parsed = parseAirQualityViewport(req.query as Record<string, unknown>);
      if (!parsed.ok) {
        res.status(400).set("Cache-Control", "no-store").json({
          status: "error",
          error: { code: "invalid_viewport", message: parsed.message, fields: parsed.fields },
        });
        return;
      }

      const abortController = new AbortController();
      const abort = () => abortController.abort();
      req.once("aborted", abort);
      res.once("close", abort);

      try {
        const result = await provider.load(abortController.signal);
        const base = baseEnvelope(parsed.viewport);
        const responseNowMs = nowMs();

        if (result.kind === "data" || result.kind === "no_data") {
          const sourceAge = classifyAirQualitySourceAge(
            result.updatedAt,
            responseNowMs,
            AIR_QUALITY_CACHE_POLICY.staleRetentionMs
          );
          if (
            sourceAge === "outside_retention" ||
            (result.kind === "no_data" && sourceAge === "unknown")
          ) {
            res.status(503).set("Cache-Control", "no-store").json({
              status: "error",
              ...base,
              reportingAreas: [],
              updatedAt: null,
              staleAfter: null,
              reason: "upstream_invalid",
              retryAfterSeconds: null,
              retryable: true,
            });
            return;
          }
        }

        if (result.kind === "disabled") {
          res.status(503).set("Cache-Control", "no-store").json({
            status: "disabled",
            ...base,
            reportingAreas: [],
            updatedAt: null,
            staleAfter: null,
            reason: result.reason,
            retryAfterSeconds: null,
          });
          return;
        }
        if (result.kind === "rate_limited") {
          res
            .status(429)
            .set("Cache-Control", "no-store")
            .set("Retry-After", String(result.retryAfterSeconds))
            .json({
              status: "rate_limited",
              ...base,
              reportingAreas: [],
              updatedAt: null,
              staleAfter: null,
              reason: null,
              retryAfterSeconds: result.retryAfterSeconds,
            });
          return;
        }
        if (result.kind === "error") {
          res.status(503).set("Cache-Control", "no-store").json({
            status: "error",
            ...base,
            reportingAreas: [],
            updatedAt: null,
            staleAfter: null,
            reason: result.reason,
            retryAfterSeconds: null,
            retryable: result.retryable,
          });
          return;
        }

        if (result.kind === "no_data") {
          const freshness = classifyAirQualityFreshness(
            result.updatedAt,
            responseNowMs,
            AIR_QUALITY_STALE_AFTER_MS
          );
          res.status(200).set(
            "Cache-Control",
            freshness.status === "fresh" ? "public, max-age=300" : "no-cache"
          ).json({
            status: "no_data",
            ...base,
            reportingAreas: [],
            updatedAt: result.updatedAt,
            staleAfter: freshness.staleAfter,
            reason: null,
            retryAfterSeconds: null,
          });
          return;
        }

        const freshness = classifyAirQualityFreshness(
          result.updatedAt,
          responseNowMs,
          AIR_QUALITY_STALE_AFTER_MS
        );
        const status = result.forceStale ? "stale" : freshness.status;
        const reportingAreas = result.reportingAreas
          .filter((area) => isInViewport(area, parsed.viewport))
          .sort((left, right) => left.id.localeCompare(right.id));
        if (reportingAreas.length === 0) {
          res.status(200).set(
            "Cache-Control",
            status === "fresh" ? "public, max-age=300" : "no-cache"
          ).json({
            status: "no_data",
            ...base,
            reportingAreas,
            updatedAt: result.updatedAt,
            staleAfter: freshness.staleAfter,
            reason: null,
            retryAfterSeconds: null,
          });
          return;
        }

        res
          .status(200)
          .set(
            "Cache-Control",
            status === "fresh"
              ? "public, max-age=300, stale-while-revalidate=900"
              : "no-cache"
          )
          .json({
            status,
            ...base,
            reportingAreas,
            updatedAt: result.updatedAt,
            staleAfter: freshness.staleAfter,
            reason: null,
            retryAfterSeconds: null,
          });
      } catch (error) {
        if (error instanceof AirQualityRequestAbortedError || abortController.signal.aborted) return;
        res.status(503).set("Cache-Control", "no-store").json({
          status: "error",
          ...baseEnvelope(parsed.viewport),
          reportingAreas: [],
          updatedAt: null,
          staleAfter: null,
          reason: "upstream_unavailable",
          retryAfterSeconds: null,
          retryable: true,
        });
      } finally {
        req.off("aborted", abort);
        res.off("close", abort);
      }
    })
  );

  return router;
}

export default createPublicAirQualityRouter(createProductionAirQualityProvider());
