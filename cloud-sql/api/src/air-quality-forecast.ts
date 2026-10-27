import { AirQualityResponse, buildAirQualityResponse, HrrrRow, snapToCell } from "./air-quality";
import { CamsFetcher } from "./open-meteo";

export interface AirQualityQueryable {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Plans and catalog routes share the same smoke rows and cached CAMS cell. */
export async function forecastAirQuality(
  point: { lat: number; lng: number },
  planDateSec: number | null,
  pool: AirQualityQueryable,
  cams: CamsFetcher,
  nowSec: () => number
): Promise<AirQualityResponse> {
  const cell = snapToCell(point.lat, point.lng);
  const [smokeResult, camsData] = await Promise.all([
    pool.query(
      `SELECT valid_at, run_at, smoke_ug_m3
       FROM smoke_forecasts
       WHERE cell_key = $1 AND valid_at >= now() - interval '1 hour'
       ORDER BY valid_at`,
      [cell.cellKey]
    ),
    cams(cell.lat, cell.lng),
  ]);
  const hrrrRows: HrrrRow[] = (
    smokeResult.rows as { valid_at: Date; run_at: Date; smoke_ug_m3: number }[]
  ).map((row) => ({
    validAtSec: Math.floor(new Date(row.valid_at).getTime() / 1000),
    smokeUgM3: row.smoke_ug_m3,
    runAtIso: new Date(row.run_at).toISOString(),
  }));
  return buildAirQualityResponse({ point, hrrrRows, cams: camsData, planDateSec, nowSec: nowSec() });
}
