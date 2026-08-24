import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AirQualityRequestAbortedError } from "../air-quality-provider";
import {
  AIRNOW_FILE_FETCH_POLICY,
  AirNowFileAirQualityProvider,
} from "../airnow-file-provider";

const NOW_MS = Date.parse("2026-08-23T23:39:43.000Z");
const LAST_MODIFIED = "Sun, 23 Aug 2026 23:27:13 GMT";
const OBSERVATION =
  "08/23/26|08/23/26|16:00|PDT|0|O|Y|Seattle-Bellevue-Kent|WA|47.6062|-122.3321|PM2.5|58|Moderate|No||Puget Sound Clean Air Agency";

function sourceResponse(
  body: BodyInit | null = OBSERVATION,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status: 200,
    headers: { "Last-Modified": LAST_MODIFIED, ...headers },
  });
}

function providerFor(
  fetchImpl: typeof fetch,
  options: Partial<ConstructorParameters<typeof AirNowFileAirQualityProvider>[0]> = {}
): AirNowFileAirQualityProvider {
  return new AirNowFileAirQualityProvider({
    fetchImpl,
    nowMs: () => NOW_MS,
    minReportingAreaCount: 1,
    ...options,
  });
}

test("AirNow file provider passes through real source values and Last-Modified", async () => {
  let requestedUrl: string | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    return sourceResponse();
  };

  const result = await providerFor(fetchImpl).load();
  assert.equal(requestedUrl, "https://files.airnowtech.org/airnow/today/reportingarea.dat");
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.equal(result.updatedAt, "2026-08-23T23:27:13.000Z");
  assert.equal(result.fetchedAt, "2026-08-23T23:39:43.000Z");
  assert.equal(result.reportingAreas.length, 1);
  assert.equal(result.reportingAreas[0].aqi, 58);
  assert.equal(result.reportingAreas[0].dominantPollutant, "PM2.5");
});

test("AirNow file provider requires a trustworthy Last-Modified", async () => {
  const cases = [
    new Response(OBSERVATION),
    sourceResponse(OBSERVATION, { "Last-Modified": "not-a-date" }),
    sourceResponse(OBSERVATION, {
      "Last-Modified": "Mon, 24 Aug 2026 00:00:00 GMT",
    }),
  ];

  for (const response of cases) {
    const result = await providerFor(async () => response).load();
    assert.deepEqual(result, {
      kind: "error",
      reason: "upstream_invalid",
      retryable: true,
    });
  }
});

test("AirNow file provider checks declared and streamed byte limits", async () => {
  const cap = Buffer.byteLength(OBSERVATION);
  const declaredTooLarge = sourceResponse(OBSERVATION, {
    "Content-Length": String(cap + 1),
  });
  assert.deepEqual(
    await providerFor(async () => declaredTooLarge, { maxResponseBytes: cap }).load(),
    { kind: "error", reason: "upstream_invalid", retryable: true }
  );

  const streamedTooLarge = sourceResponse(`${OBSERVATION}\n${OBSERVATION}`);
  assert.deepEqual(
    await providerFor(async () => streamedTooLarge, { maxResponseBytes: cap }).load(),
    { kind: "error", reason: "upstream_invalid", retryable: true }
  );

  const exactBoundary = await providerFor(async () => sourceResponse(), {
    maxResponseBytes: cap,
  }).load();
  assert.equal(exactBoundary.kind, "data");
  assert.equal(AIRNOW_FILE_FETCH_POLICY.maxResponseBytes, 3 * 1024 * 1024);
  assert.equal(AIRNOW_FILE_FETCH_POLICY.minReportingAreaCount, 500);
});

test("AirNow file provider maps timeout and caller abort separately", async () => {
  const waitingFetch: typeof fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });

  assert.deepEqual(
    await providerFor(waitingFetch, { timeoutMs: 5 }).load(),
    { kind: "error", reason: "upstream_unavailable", retryable: true }
  );

  const controller = new AbortController();
  const canceled = providerFor(waitingFetch, { timeoutMs: 1_000 }).load(
    controller.signal
  );
  controller.abort();
  await assert.rejects(canceled, AirQualityRequestAbortedError);
});

test("AirNow file provider maps HTTP status and Retry-After", async () => {
  const numericLimit = await providerFor(async () =>
    new Response(null, { status: 429, headers: { "Retry-After": "120" } })
  ).load();
  assert.deepEqual(numericLimit, { kind: "rate_limited", retryAfterSeconds: 120 });

  const datedLimit = await providerFor(async () =>
    new Response(null, {
      status: 429,
      headers: { "Retry-After": "Sun, 23 Aug 2026 23:40:13 GMT" },
    })
  ).load();
  assert.deepEqual(datedLimit, { kind: "rate_limited", retryAfterSeconds: 30 });

  assert.deepEqual(
    await providerFor(async () => new Response(null, { status: 503 })).load(),
    { kind: "error", reason: "upstream_unavailable", retryable: true }
  );
  assert.deepEqual(
    await providerFor(async () => new Response(null, { status: 404 })).load(),
    { kind: "error", reason: "upstream_unavailable", retryable: false }
  );
});

test("AirNow file provider rejects empty, invalid UTF-8, and malformed files", async () => {
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  const bodies: BodyInit[] = [
    "",
    invalidUtf8,
    `${OBSERVATION}\nbad|row`,
    "bad|row\nalso|bad",
  ];

  for (const body of bodies) {
    const result = await providerFor(async () => sourceResponse(body)).load();
    assert.deepEqual(result, {
      kind: "error",
      reason: "upstream_invalid",
      retryable: true,
    });
  }
});

test("AirNow file provider rejects an incomplete nationwide file", async () => {
  const repeatedSingleArea = Array.from({ length: 600 }, () => OBSERVATION).join("\n");
  const result = await providerFor(async () => sourceResponse(repeatedSingleArea), {
    minReportingAreaCount: 2,
  }).load();

  assert.deepEqual(result, {
    kind: "error",
    reason: "upstream_invalid",
    retryable: true,
  });
});

test("ignored rows cannot dilute malformed primary observations", async () => {
  const ignored = OBSERVATION.replace("|0|O|Y|", "|1|F|N|");
  const malformedPrimary = OBSERVATION.replace("|58|Moderate|", "|58|Good|");
  const body = [
    ...Array.from({ length: 100 }, () => ignored),
    OBSERVATION,
    malformedPrimary,
  ].join("\n");

  const result = await providerFor(async () => sourceResponse(body)).load();
  assert.deepEqual(result, {
    kind: "error",
    reason: "upstream_invalid",
    retryable: true,
  });
});
