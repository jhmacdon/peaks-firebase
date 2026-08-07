"use server";

// Thin proxy to the Cloud Run API's plan air-quality endpoint. The API owns
// all merge logic (HRRR-Smoke + CAMS); web and iOS consume the same contract.
// Contract: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md

export interface AqHour {
  time: string;
  source: "hrrr_smoke" | "cams";
  pm25: number;
  category: string;
}

export interface AqDay {
  date: string;
  source: "hrrr_smoke" | "cams" | "mixed";
  pm25Max: number;
  usAqiMax: number | null;
  category: string;
  isPlanDay: boolean;
  hours: AqHour[];
}

export interface PlanAirQuality {
  available: boolean;
  reason?: string;
  timezone?: string;
  planDate?: string | null;
  planDayBeyondHorizon?: boolean;
  days?: AqDay[];
}

const API_URL =
  process.env.PEAKS_API_URL || "https://peaks-api-qownl77soa-uc.a.run.app";

export async function getPlanAirQuality(
  token: string,
  planId: string
): Promise<PlanAirQuality | null> {
  try {
    const res = await fetch(`${API_URL}/api/plans/${planId}/air-quality`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: PlanAirQuality = await res.json();
    return data.available || data.planDayBeyondHorizon ? data : null;
  } catch {
    return null;
  }
}
