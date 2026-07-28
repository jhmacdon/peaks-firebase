"use client";

import { useMemo } from "react";
import { summarizeSessionHealthData } from "../lib/session-health";

export default function SessionHealthSummary({
  healthData,
}: {
  healthData: unknown;
}) {
  const summary = useMemo(
    () => summarizeSessionHealthData(healthData),
    [healthData]
  );
  if (
    summary.averageHeartRate == null &&
    summary.maximumHeartRate == null &&
    summary.activeCalories == null
  ) {
    return null;
  }

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">
          Heart rate and energy
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Health samples attached to this activity.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800">
        <HealthMetric
          label="Average heart rate"
          value={
            summary.averageHeartRate == null
              ? "—"
              : `${summary.averageHeartRate} bpm`
          }
        />
        <HealthMetric
          label="Maximum heart rate"
          value={
            summary.maximumHeartRate == null
              ? "—"
              : `${summary.maximumHeartRate} bpm`
          }
        />
        <HealthMetric
          label="Active energy"
          value={
            summary.activeCalories == null
              ? "—"
              : `${summary.activeCalories.toLocaleString("en-US")} cal`
          }
        />
      </div>
    </section>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-3 dark:bg-gray-900">
      <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {label}
      </div>
    </div>
  );
}
