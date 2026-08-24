import { AirQualityReportingArea } from "./air-quality-reporting-area";
import {
  AirNowFileAirQualityProvider,
  AirNowFileProviderOptions,
} from "./airnow-file-provider";
import { AirQualityRequestAbortedError } from "./air-quality-errors";

export { AirQualityRequestAbortedError } from "./air-quality-errors";

export type AirQualityProviderResult =
  | {
      kind: "data";
      reportingAreas: AirQualityReportingArea[];
      updatedAt: string | null;
      fetchedAt: string;
      forceStale?: boolean;
    }
  | {
      kind: "no_data";
      updatedAt: string | null;
      fetchedAt: string;
    }
  | {
      kind: "rate_limited";
      retryAfterSeconds: number;
    }
  | {
      kind: "error";
      reason: "upstream_unavailable" | "upstream_invalid";
      retryable: boolean;
    };

export interface AirQualityProvider {
  load(signal?: AbortSignal): Promise<AirQualityProviderResult>;
}

export interface AirQualityCacheOptions {
  freshTtlMs: number;
  staleRetentionMs: number;
  nowMs?: () => number;
}

export const AIR_QUALITY_CACHE_POLICY = {
  freshTtlMs: 20 * 60 * 1000,
  staleRetentionMs: 6 * 60 * 60 * 1000,
} as const;

interface CacheEntry {
  result: Extract<AirQualityProviderResult, { kind: "data" | "no_data" }>;
  storedAtMs: number;
}

export type AirQualitySourceAgeState =
  | "within_retention"
  | "unknown"
  | "outside_retention";

export function classifyAirQualitySourceAge(
  updatedAt: string | null,
  nowMs: number,
  retentionMs: number
): AirQualitySourceAgeState {
  const sourceUpdatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(sourceUpdatedAtMs)) return "unknown";
  const ageMs = nowMs - sourceUpdatedAtMs;
  if (ageMs < 0 || ageMs >= retentionMs) return "outside_retention";
  return "within_retention";
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AirQualityRequestAbortedError());

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new AirQualityRequestAbortedError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

/**
 * Small process-local cache for the live provider. Requests share one
 * upstream load. Aborting one waiter releases only that caller, so another
 * coalesced request can still receive and cache the same result.
 */
export class CachedAirQualityProvider {
  private cached?: CacheEntry;
  private inFlight?: Promise<AirQualityProviderResult>;
  private rateLimitUntilMs?: number;
  private readonly nowMs: () => number;

  constructor(
    private readonly upstream: AirQualityProvider,
    private readonly options: AirQualityCacheOptions
  ) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  private normalizeLoadedResult(result: AirQualityProviderResult): AirQualityProviderResult {
    const now = this.nowMs();
    if (result.kind === "rate_limited") {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSeconds));
      this.rateLimitUntilMs = Math.max(
        this.rateLimitUntilMs ?? 0,
        now + retryAfterSeconds * 1_000
      );
      return { kind: "rate_limited", retryAfterSeconds };
    }
    if (result.kind === "data" || result.kind === "no_data") {
      const sourceAge = classifyAirQualitySourceAge(
        result.updatedAt,
        now,
        this.options.staleRetentionMs
      );
      if (sourceAge === "outside_retention") {
        return { kind: "error", reason: "upstream_invalid", retryable: true };
      }
      if (sourceAge === "unknown") {
        return result.kind === "data"
          ? { ...result, forceStale: true }
          : { kind: "error", reason: "upstream_invalid", retryable: true };
      }
      const loadedUpdatedAtMs = Date.parse(result.updatedAt!);
      const cachedUpdatedAtMs = this.cached?.result.updatedAt
        ? Date.parse(this.cached.result.updatedAt)
        : Number.NaN;
      if (
        Number.isFinite(cachedUpdatedAtMs) &&
        loadedUpdatedAtMs < cachedUpdatedAtMs
      ) {
        return { kind: "error", reason: "upstream_invalid", retryable: true };
      }
      this.rateLimitUntilMs = undefined;
      this.cached = { result, storedAtMs: now };
    }
    return result;
  }

  private retainedData(now: number): Extract<AirQualityProviderResult, { kind: "data" }> | null {
    if (this.cached?.result.kind !== "data") return null;
    if (
      classifyAirQualitySourceAge(
        this.cached.result.updatedAt,
        now,
        this.options.staleRetentionMs
      ) !== "within_retention"
    ) {
      return null;
    }
    if (now - this.cached.storedAtMs >= this.options.staleRetentionMs) return null;
    return { ...this.cached.result, forceStale: true };
  }

  async load(signal?: AbortSignal): Promise<AirQualityProviderResult> {
    const now = this.nowMs();
    if (this.cached && now - this.cached.storedAtMs < this.options.freshTtlMs) {
      if (classifyAirQualitySourceAge(
        this.cached.result.updatedAt,
        now,
        this.options.staleRetentionMs
      ) === "within_retention") {
        return this.cached.result;
      }
      this.cached = undefined;
    }

    if (this.rateLimitUntilMs && now < this.rateLimitUntilMs) {
      const retained = this.retainedData(now);
      if (retained) return retained;
      return {
        kind: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.rateLimitUntilMs - now) / 1_000)
        ),
      };
    }
    if (this.rateLimitUntilMs) this.rateLimitUntilMs = undefined;

    if (!this.inFlight) {
      const pending = this.upstream
        .load()
        .then((result) => this.normalizeLoadedResult(result));
      this.inFlight = pending;
      const clear = () => {
        if (this.inFlight === pending) this.inFlight = undefined;
      };
      pending.then(clear, clear);
    }

    let result: AirQualityProviderResult;
    try {
      result = await waitForCaller(this.inFlight, signal);
    } catch (error) {
      if (error instanceof AirQualityRequestAbortedError) throw error;
      const retained = this.retainedData(this.nowMs());
      if (retained) return retained;
      throw error;
    }
    if (result.kind === "error" || result.kind === "rate_limited") {
      const retained = this.retainedData(this.nowMs());
      if (retained) return retained;
    }
    return result;
  }
}

export function classifyAirQualityFreshness(
  updatedAt: string | null,
  nowMs: number,
  staleAfterMs: number
): { status: "fresh" | "stale"; staleAfter: string | null } {
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) return { status: "stale", staleAfter: null };
  const staleAtMs = updatedAtMs + staleAfterMs;
  return {
    status: nowMs >= staleAtMs ? "stale" : "fresh",
    staleAfter: new Date(staleAtMs).toISOString(),
  };
}

export function createProductionAirQualityProvider(
  options: AirNowFileProviderOptions = {}
): AirQualityProvider {
  return new CachedAirQualityProvider(
    new AirNowFileAirQualityProvider(options),
    {
      ...AIR_QUALITY_CACHE_POLICY,
      nowMs: options.nowMs,
    }
  );
}
