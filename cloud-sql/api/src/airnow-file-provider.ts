import {
  AIRNOW_SOURCE,
  parseAirNowReportingAreaFile,
} from "./air-quality-reporting-area";
import type {
  AirQualityProvider,
  AirQualityProviderResult,
} from "./air-quality-provider";
import { AirQualityRequestAbortedError } from "./air-quality-errors";

export const AIRNOW_FILE_FETCH_POLICY = {
  timeoutMs: 10_000,
  // The nationwide file was 1,794,816 bytes on 2026-08-23. Three MiB leaves
  // room for normal growth while bounding decompressed bytes held in memory.
  maxResponseBytes: 3 * 1024 * 1024,
  maxMalformedRowRatio: 0.05,
  // A normal nationwide file currently has about 744 distinct reporting
  // areas. Reject a small valid fragment instead of turning the missing
  // country into false no-data responses.
  minReportingAreaCount: 500,
  defaultRetryAfterSeconds: 60,
  maxRetryAfterSeconds: 6 * 60 * 60,
} as const;

export interface AirNowFileProviderOptions {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxMalformedRowRatio?: number;
  minReportingAreaCount?: number;
}

class ResponseTooLargeError extends Error {}

function invalidResult(): AirQualityProviderResult {
  return { kind: "error", reason: "upstream_invalid", retryable: true };
}

function unavailableResult(retryable: boolean): AirQualityProviderResult {
  return { kind: "error", reason: "upstream_unavailable", retryable };
}

function retryAfterSeconds(value: string | null, nowMs: number): number {
  let seconds: number = AIRNOW_FILE_FETCH_POLICY.defaultRetryAfterSeconds;
  const normalized = value?.trim() ?? "";
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isSafeInteger(parsed)) seconds = Math.max(1, parsed);
  } else if (normalized) {
    const retryAtMs = Date.parse(normalized);
    if (Number.isFinite(retryAtMs)) {
      seconds = Math.max(1, Math.ceil((retryAtMs - nowMs) / 1_000));
    }
  }
  return Math.min(seconds, AIRNOW_FILE_FETCH_POLICY.maxRetryAfterSeconds);
}

function parseContentLength(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return "invalid";
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function parseLastModified(value: string | null, fetchedAtMs: number): string | null {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > fetchedAtMs) return null;
  return new Date(parsed).toISOString();
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already ending. There is no useful work left to cancel.
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Loads AirNow's official key-free nationwide reporting-area file. This class
 * owns network and file-shape guards only; CachedAirQualityProvider owns the
 * 20-minute single-flight cache and six-hour retained-data window.
 */
export class AirNowFileAirQualityProvider implements AirQualityProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxMalformedRowRatio: number;
  private readonly minReportingAreaCount: number;

  constructor(options: AirNowFileProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowMs = options.nowMs ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? AIRNOW_FILE_FETCH_POLICY.timeoutMs;
    this.maxResponseBytes =
      options.maxResponseBytes ?? AIRNOW_FILE_FETCH_POLICY.maxResponseBytes;
    this.maxMalformedRowRatio =
      options.maxMalformedRowRatio ?? AIRNOW_FILE_FETCH_POLICY.maxMalformedRowRatio;
    this.minReportingAreaCount =
      options.minReportingAreaCount ?? AIRNOW_FILE_FETCH_POLICY.minReportingAreaCount;
  }

  async load(signal?: AbortSignal): Promise<AirQualityProviderResult> {
    if (signal?.aborted) throw new AirQualityRequestAbortedError();

    const controller = new AbortController();
    let callerAborted = false;
    const abortForCaller = () => {
      callerAborted = true;
      controller.abort();
    };
    signal?.addEventListener("abort", abortForCaller, { once: true });
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(AIRNOW_SOURCE.dataUrl, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: { Accept: "text/plain, application/octet-stream" },
      });
      const fetchedAtMs = this.nowMs();

      if (response.status === 429) {
        await cancelBody(response);
        return {
          kind: "rate_limited",
          retryAfterSeconds: retryAfterSeconds(
            response.headers.get("retry-after"),
            fetchedAtMs
          ),
        };
      }
      if (!response.ok) {
        await cancelBody(response);
        return unavailableResult(response.status >= 500 || response.status === 408);
      }

      const contentLength = parseContentLength(response.headers.get("content-length"));
      if (
        contentLength === "invalid" ||
        (contentLength !== null &&
          (contentLength === 0 || contentLength > this.maxResponseBytes))
      ) {
        await cancelBody(response);
        return invalidResult();
      }

      const updatedAt = parseLastModified(
        response.headers.get("last-modified"),
        fetchedAtMs
      );
      if (!updatedAt) {
        await cancelBody(response);
        return invalidResult();
      }

      let body: Uint8Array;
      try {
        body = await readBoundedBody(response, this.maxResponseBytes);
      } catch (error) {
        if (error instanceof ResponseTooLargeError) return invalidResult();
        throw error;
      }
      if (body.byteLength === 0) return invalidResult();

      let contents: string;
      try {
        contents = new TextDecoder("utf-8", { fatal: true }).decode(body);
      } catch {
        return invalidResult();
      }

      const parsed = parseAirNowReportingAreaFile(contents);
      const candidateRowCount =
        parsed.reportingAreas.length + parsed.malformedRowCount;
      const distinctReportingAreaCount = new Set(
        parsed.reportingAreas.map((area) => area.id)
      ).size;
      if (
        candidateRowCount === 0 ||
        distinctReportingAreaCount < this.minReportingAreaCount ||
        parsed.malformedRowCount / candidateRowCount > this.maxMalformedRowRatio
      ) {
        return invalidResult();
      }

      return {
        kind: "data",
        reportingAreas: parsed.reportingAreas,
        updatedAt,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
      };
    } catch {
      if (callerAborted || signal?.aborted) throw new AirQualityRequestAbortedError();
      return unavailableResult(true);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortForCaller);
    }
  }
}
