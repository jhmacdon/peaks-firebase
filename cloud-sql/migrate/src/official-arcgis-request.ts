export const OFFICIAL_ARCGIS_REQUEST_TIMEOUT_MS = 30_000;

export function officialArcgisRequestOptions(userAgent: string): RequestInit {
  return {
    headers: { "user-agent": userAgent },
    signal: AbortSignal.timeout(OFFICIAL_ARCGIS_REQUEST_TIMEOUT_MS),
  };
}

export default {
  OFFICIAL_ARCGIS_REQUEST_TIMEOUT_MS,
  officialArcgisRequestOptions,
};
