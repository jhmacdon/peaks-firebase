import {
  AirQualityProvider,
  AirQualityProviderResult,
} from "../../air-quality-provider";
import { AirQualityReportingArea } from "../../air-quality-reporting-area";

export function fixtureReportingArea(
  overrides: Partial<AirQualityReportingArea> = {}
): AirQualityReportingArea {
  return {
    id: "airnow:wa:seattle-bellevue-kent",
    name: "Seattle-Bellevue-Kent",
    kind: "reporting_area",
    geometry: { type: "Point", coordinates: [-122.3321, 47.6062] },
    aqi: 58,
    category: { id: "moderate", label: "Moderate", sourceValue: "Moderate" },
    dominantPollutant: "PM2.5",
    observedAt: { date: "2026-08-23", time: "16:00", timeZone: "PDT" },
    sourceAgency: "Puget Sound Clean Air Agency",
    ...overrides,
  };
}

export class FixtureAirQualityProvider implements AirQualityProvider {
  callCount = 0;

  constructor(
    private readonly handler: (
      callCount: number,
      signal?: AbortSignal
    ) => AirQualityProviderResult | Promise<AirQualityProviderResult>
  ) {}

  async load(signal?: AbortSignal): Promise<AirQualityProviderResult> {
    this.callCount += 1;
    return this.handler(this.callCount, signal);
  }
}
