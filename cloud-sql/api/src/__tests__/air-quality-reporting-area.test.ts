import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseAirNowReportingAreaFile,
  parseAirNowReportingAreaLine,
} from "../air-quality-reporting-area";

const OBSERVATION =
  "08/23/26|08/23/26|16:00|PDT|0|O|Y|Seattle-Bellevue-Kent|WA|47.6062|-122.3321|PM2.5|58|Moderate|No||Puget Sound Clean Air Agency";

test("parser preserves AirNow's primary observed reporting-area values", () => {
  const parsed = parseAirNowReportingAreaLine(OBSERVATION);
  assert.equal(parsed.kind, "observation");
  if (parsed.kind !== "observation") return;

  assert.deepEqual(parsed.reportingArea, {
    id: "airnow:wa:seattle-bellevue-kent",
    name: "Seattle-Bellevue-Kent",
    kind: "reporting_area",
    geometry: { type: "Point", coordinates: [-122.3321, 47.6062] },
    aqi: 58,
    category: { id: "moderate", label: "Moderate", sourceValue: "Moderate" },
    dominantPollutant: "PM2.5",
    observedAt: { date: "2026-08-23", time: "16:00", timeZone: "PDT" },
    sourceAgency: "Puget Sound Clean Air Agency",
  });
});

test("parser accepts AirNow's one-digit observed hours", () => {
  const parsed = parseAirNowReportingAreaLine(
    OBSERVATION.replace("|16:00|PDT|", "|7:00|PDT|")
  );
  assert.equal(parsed.kind, "observation");
  if (parsed.kind !== "observation") return;

  assert.equal(parsed.reportingArea.observedAt?.time, "7:00");
});

test("parser ignores forecasts, prior-day summaries, and secondary pollutants", () => {
  const forecast = OBSERVATION.replace("|0|O|Y|", "|1|F|Y|");
  const priorDay = OBSERVATION.replace("|0|O|Y|", "|-1|Y|Y|");
  const secondary = OBSERVATION.replace("|0|O|Y|", "|0|O|N|");
  assert.equal(parseAirNowReportingAreaLine(forecast).kind, "ignored");
  assert.equal(parseAirNowReportingAreaLine(priorDay).kind, "ignored");
  assert.equal(parseAirNowReportingAreaLine(secondary).kind, "ignored");
});

test("provider-supplied AQI above 500 remains Hazardous", () => {
  const parsed = parseAirNowReportingAreaLine(
    OBSERVATION.replace("|58|Moderate|", "|725|Hazardous|")
  );
  assert.equal(parsed.kind, "observation");
  if (parsed.kind !== "observation") return;
  assert.equal(parsed.reportingArea.aqi, 725);
  assert.equal(parsed.reportingArea.category.id, "hazardous");
  assert.equal(parsed.reportingArea.category.sourceValue, "Hazardous");
});

test("parser validates every EPA category boundary without repairing source data", () => {
  const cases: Array<[number, string]> = [
    [0, "Good"],
    [50, "Good"],
    [51, "Moderate"],
    [100, "Moderate"],
    [101, "Unhealthy for Sensitive Groups"],
    [150, "Unhealthy for Sensitive Groups"],
    [151, "Unhealthy"],
    [200, "Unhealthy"],
    [201, "Very Unhealthy"],
    [300, "Very Unhealthy"],
    [301, "Hazardous"],
    [725, "Hazardous"],
  ];
  for (const [aqi, category] of cases) {
    const parsed = parseAirNowReportingAreaLine(
      OBSERVATION.replace("|58|Moderate|", `|${aqi}|${category}|`)
    );
    assert.equal(parsed.kind, "observation", `${aqi} ${category}`);
  }

  const contradiction = parseAirNowReportingAreaLine(
    OBSERVATION.replace("|58|Moderate|", "|58|Hazardous|")
  );
  assert.deepEqual(contradiction, { kind: "malformed", reason: "category_mismatch" });
});

test("parser excludes reporting areas outside the US product scope", () => {
  const canadian = OBSERVATION.replace("|WA|", "|BC|");
  assert.equal(parseAirNowReportingAreaLine(canadian).kind, "ignored");
});

test("parser rejects malformed source rows instead of inventing values", () => {
  assert.equal(parseAirNowReportingAreaLine("too|short").kind, "malformed");
  assert.deepEqual(parseAirNowReportingAreaLine(`${OBSERVATION}|unexpected`), {
    kind: "malformed",
    reason: "field_count",
  });
  assert.equal(
    parseAirNowReportingAreaLine(OBSERVATION.replace("|-122.3321|", "|west|"))
      .kind,
    "malformed"
  );
  assert.equal(
    parseAirNowReportingAreaLine(OBSERVATION.replace("|58|Moderate|", "|58|Unknown|"))
      .kind,
    "malformed"
  );
  assert.equal(
    parseAirNowReportingAreaLine(
      OBSERVATION.replace("|58|Moderate|", "|10001|Hazardous|")
    ).kind,
    "malformed"
  );
});

test("parser accepts only AirNow decimal and date-time syntax", () => {
  const malformedRows = [
    OBSERVATION.replace("|58|Moderate|", "|0x32|Good|"),
    OBSERVATION.replace("|47.6062|", "|4.76062e1|"),
    OBSERVATION.replace("08/23/26|08/23/26", "13/23/26|08/23/26"),
    OBSERVATION.replace("08/23/26|16:00", "02/30/26|16:00"),
    OBSERVATION.replace("|16:00|PDT|", "|24:00|PDT|"),
    OBSERVATION.replace("|16:00|PDT|", "|16:60|PDT|"),
    OBSERVATION.replace("|16:00|PDT|", "|16:00|PDTX|"),
  ];

  for (const row of malformedRows) {
    assert.equal(parseAirNowReportingAreaLine(row).kind, "malformed", row);
  }
});

test("file parser returns sorted records and row counts", () => {
  const second = OBSERVATION.split("Seattle-Bellevue-Kent").join("Yakima").replace(
    "|47.6062|-122.3321|",
    "|46.6021|-120.5059|"
  );
  const result = parseAirNowReportingAreaFile(
    [second, "bad|row", OBSERVATION, OBSERVATION.replace("|0|O|Y|", "|0|O|N|")].join(
      "\n"
    )
  );
  assert.deepEqual(
    result.reportingAreas.map((area) => area.id),
    ["airnow:wa:seattle-bellevue-kent", "airnow:wa:yakima"]
  );
  assert.equal(result.malformedRowCount, 1);
  assert.equal(result.ignoredRowCount, 1);
});
