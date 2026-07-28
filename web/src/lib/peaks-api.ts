const DEFAULT_PEAKS_API_URL =
  "https://peaks-api-726404093396.us-central1.run.app";

export class PeaksAPIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function apiUrl(path: string): string {
  const base = (process.env.PEAKS_API_URL ?? DEFAULT_PEAKS_API_URL).replace(
    /\/+$/,
    ""
  );
  return `${base}${path}`;
}

export async function peaksAPI<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  fallbackError = "The Peaks service rejected the request"
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error("The Peaks service could not be reached");
  }

  const responseText = await response.text();
  let responseBody: unknown = null;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = null;
    }
  }

  if (!response.ok) {
    const apiMessage =
      responseBody &&
      typeof responseBody === "object" &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : fallbackError;
    throw new PeaksAPIRequestError(apiMessage, response.status);
  }

  return responseBody as T;
}
