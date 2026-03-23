import { refreshStravaToken } from "../strava";

// Mock firebase module to prevent initialization during import
jest.mock("../firebase", () => ({
  admin: {
    firestore: () => ({}),
  },
}));

// Mock firebase-functions to prevent secret/onCall initialization
jest.mock("firebase-functions/v2/https", () => ({
  onCall: () => () => {},
  onRequest: () => () => {},
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));
jest.mock("firebase-functions/params", () => ({
  defineSecret: () => ({ value: () => "mock" }),
}));

function mockFetch(status: number, body: string | object): typeof fetch {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(bodyStr),
  });
}

describe("refreshStravaToken", () => {
  it("sends credentials as form-encoded POST body, not query params", async () => {
    const fakeFetch = mockFetch(200, {
      access_token: "new_access",
      refresh_token: "new_refresh",
      expires_at: 9999999999,
    });

    await refreshStravaToken("my_client_id", "my_secret", "my_refresh", fakeFetch);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (fakeFetch as jest.Mock).mock.calls[0];

    // URL must be plain — no query params
    expect(url).toBe("https://www.strava.com/oauth/token");
    expect(url).not.toContain("?");

    // Body must be form-encoded with correct params
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const params = new URLSearchParams(opts.body);
    expect(params.get("client_id")).toBe("my_client_id");
    expect(params.get("client_secret")).toBe("my_secret");
    expect(params.get("refresh_token")).toBe("my_refresh");
    expect(params.get("grant_type")).toBe("refresh_token");
  });

  it("returns parsed token data on success", async () => {
    const fakeFetch = mockFetch(200, {
      access_token: "acc_123",
      refresh_token: "ref_456",
      expires_at: 1700000000,
      extra_field: "ignored",
    });

    const result = await refreshStravaToken("cid", "cs", "rt", fakeFetch);

    expect(result).toEqual({
      access_token: "acc_123",
      refresh_token: "ref_456",
      expires_at: 1700000000,
    });
  });

  it("throws with Strava error body on 400", async () => {
    const fakeFetch = mockFetch(400, {
      message: "Bad Request",
      errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
    });

    await expect(
      refreshStravaToken("cid", "cs", "bad_token", fakeFetch)
    ).rejects.toThrow(/400/);

    // Verify the error includes the response body for debugging
    await expect(
      refreshStravaToken("cid", "cs", "bad_token", fakeFetch)
    ).rejects.toThrow(/invalid/);
  });

  it("throws with status on 401 (revoked app)", async () => {
    const fakeFetch = mockFetch(401, { message: "Authorization Error" });

    await expect(
      refreshStravaToken("cid", "cs", "revoked_token", fakeFetch)
    ).rejects.toThrow(/401/);
  });

  it("does not include credentials in the URL", async () => {
    const fakeFetch = mockFetch(200, {
      access_token: "a",
      refresh_token: "r",
      expires_at: 0,
    });

    await refreshStravaToken("secret_client", "secret_secret", "secret_refresh", fakeFetch);

    const [url] = (fakeFetch as jest.Mock).mock.calls[0];
    expect(url).not.toContain("secret_client");
    expect(url).not.toContain("secret_secret");
    expect(url).not.toContain("secret_refresh");
  });
});
