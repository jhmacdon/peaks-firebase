export type SendResult =
  /** 2xx: every item in the batch is done (accepted or permanently rejected). */
  | { kind: "ok" }
  /** Permanent failure (400/401/403/413/415 and other 4xx): drop the batch. */
  | { kind: "drop"; status: number }
  /** 408/429/5xx, timeout or network error: keep the batch and retry later. */
  | { kind: "retry"; retryAfterMs?: number };

export interface TransportOptions {
  endpoint: string;
  sourceKey: string;
  fetch: typeof fetch;
  requestTimeoutMs: number;
}

/**
 * POSTs an already-serialized JSON body. Serialization happens before this
 * call, so only network failures reach the catch and count as retryable.
 */
export async function postJson(
  options: TransportOptions,
  path: "/v2/track" | "/v2/engage",
  body: string,
  keepalive = false,
): Promise<SendResult> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Petrics-Source-Key": options.sourceKey,
    },
    body,
  };
  if (keepalive) init.keepalive = true;
  const signal = timeoutSignal(options.requestTimeoutMs);
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await options.fetch(`${options.endpoint}${path}`, init);
  } catch {
    // Network error, abort, or timeout.
    return { kind: "retry" };
  }
  return classify(response);
}

export function classify(response: Response): SendResult {
  const { status } = response;
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 408 || status === 429 || status >= 500) {
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
    return retryAfterMs === undefined ? { kind: "retry" } : { kind: "retry", retryAfterMs };
  }
  return { kind: "drop", status };
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (!(ms > 0)) return undefined;
  const timeout = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof timeout === "function" ? timeout.call(AbortSignal, ms) : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}
