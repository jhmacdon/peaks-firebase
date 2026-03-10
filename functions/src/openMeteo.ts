import * as request from "request-promise-native";

interface DailyForecast {
  date: string;
  snowfall_cm: number;
  snowfall_inches: number;
  precipitation_mm: number;
  temp_max_c: number;
  temp_min_c: number;
  estimated_snow_inches: number;
}

interface ForecastSummary {
  location: {
    latitude: number;
    longitude: number;
    elevation_m: number;
  };
  daily: DailyForecast[];
  last24h_inches: number;
  next1to5days_inches: number;
  next6to10days_inches: number;
  raw_snowfall_next1to5days_inches: number;
}

/**
 * Estimate snow accumulation from precipitation and temperature.
 * Open-Meteo's snowfall_sum often underestimates in mountain environments,
 * so we also compute an estimate using precipitation + snow-liquid ratio.
 *
 * When temps are well below freezing and there's significant precip,
 * we use a temperature-dependent snow:liquid ratio (typically 10:1 to 15:1).
 */
function estimateSnowFromPrecip(precipMm: number, tempMaxC: number, tempMinC: number): number {
  const avgTemp = (tempMaxC + tempMinC) / 2;

  // No snow if average temp is above 1.5°C
  if (avgTemp > 1.5) return 0;

  // Rain-snow mix zone: 0 to 1.5°C — partial snow
  let snowFraction = 1.0;
  if (avgTemp > 0) {
    snowFraction = 1.0 - (avgTemp / 1.5);
  }

  // Snow:liquid ratio varies with temperature
  // Colder temps = fluffier snow = higher ratio
  let ratio: number;
  if (avgTemp < -15) {
    ratio = 15;
  } else if (avgTemp < -10) {
    ratio = 13;
  } else if (avgTemp < -5) {
    ratio = 12;
  } else {
    ratio = 10;
  }

  const snowMm = precipMm * snowFraction * ratio;
  // Convert mm to inches
  return snowMm / 25.4;
}

export async function getOpenMeteoForecast(
  latitude: number,
  longitude: number,
  elevationM?: number
): Promise<ForecastSummary> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    daily: "snowfall_sum,precipitation_sum,temperature_2m_max,temperature_2m_min",
    timezone: "America/Los_Angeles",
    forecast_days: "16",
  });

  if (elevationM) {
    params.set("elevation", elevationM.toString());
  }

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const response = await request.get(url, { json: true });

  const daily = response.daily;
  const forecasts: DailyForecast[] = [];

  for (let i = 0; i < daily.time.length; i++) {
    const snowCm = daily.snowfall_sum[i] || 0;
    const precipMm = daily.precipitation_sum[i] || 0;
    const tempMax = daily.temperature_2m_max[i];
    const tempMin = daily.temperature_2m_min[i];

    const estimatedSnow = estimateSnowFromPrecip(precipMm, tempMax, tempMin);
    // Use the higher of Open-Meteo's snowfall or our precipitation-based estimate
    const bestEstimate = Math.max(snowCm / 2.54, estimatedSnow);

    forecasts.push({
      date: daily.time[i],
      snowfall_cm: snowCm,
      snowfall_inches: Math.round(snowCm / 2.54 * 10) / 10,
      precipitation_mm: precipMm,
      temp_max_c: tempMax,
      temp_min_c: tempMin,
      estimated_snow_inches: Math.round(bestEstimate * 10) / 10,
    });
  }

  // Last 24h = first day's data
  const last24h = forecasts.length > 0 ? forecasts[0].estimated_snow_inches : 0;

  // Next 1-5 days (indices 0-4)
  const next1to5 = forecasts.slice(0, 5).reduce((sum, d) => sum + d.estimated_snow_inches, 0);
  const raw1to5 = forecasts.slice(0, 5).reduce((sum, d) => sum + d.snowfall_inches, 0);

  // Next 6-10 days (indices 5-9)
  const next6to10 = forecasts.slice(5, 10).reduce((sum, d) => sum + d.estimated_snow_inches, 0);

  return {
    location: {
      latitude: response.latitude,
      longitude: response.longitude,
      elevation_m: response.elevation,
    },
    daily: forecasts,
    last24h_inches: Math.round(last24h * 10) / 10,
    next1to5days_inches: Math.round(next1to5 * 10) / 10,
    next6to10days_inches: Math.round(next6to10 * 10) / 10,
    raw_snowfall_next1to5days_inches: Math.round(raw1to5 * 10) / 10,
  };
}
