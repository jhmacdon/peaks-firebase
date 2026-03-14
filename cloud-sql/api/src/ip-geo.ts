import { Request } from "express";

interface GeoResult {
  lat: number;
  lng: number;
}

// In-memory cache: IP → coordinates. IP-based location is coarse,
// so cache aggressively (entries never expire during process lifetime).
const cache = new Map<string, GeoResult | null>();

/**
 * Extract the client IP from the request (Cloud Run sets X-Forwarded-For).
 */
function getClientIP(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    // X-Forwarded-For can be "client, proxy1, proxy2" — take the first
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || null;
}

/**
 * Resolve approximate lat/lng from the request's client IP.
 * Uses ip-api.com (free, no key, 45 req/min).
 * Returns null if lookup fails or IP is private/localhost.
 */
export async function geolocateRequest(req: Request): Promise<GeoResult | null> {
  const ip = getClientIP(req);
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return null;
  }

  if (cache.has(ip)) {
    return cache.get(ip) || null;
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      cache.set(ip, null);
      return null;
    }
    const data = await res.json();
    if (data.status !== "success" || typeof data.lat !== "number") {
      cache.set(ip, null);
      return null;
    }
    const result: GeoResult = { lat: data.lat, lng: data.lon };
    cache.set(ip, result);
    return result;
  } catch {
    cache.set(ip, null);
    return null;
  }
}
