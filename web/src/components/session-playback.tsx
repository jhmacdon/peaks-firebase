"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionPoint } from "../lib/actions/sessions";
import {
  buildSessionDistances,
  findSessionPointIndex,
} from "../lib/session-track";
import {
  heartRateAtTime,
  summarizeSessionHealthData,
} from "../lib/session-health";
import ElevationProfile from "./elevation-profile";

const SessionMap = dynamic(() => import("./session-map"), {
  ssr: false,
});

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_PLAYBACK_DURATION_MS = 45_000;

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatDistance(meters: number): string {
  return `${(meters / 1609.344).toFixed(2)} mi`;
}

function formatElevation(meters: number | null): string {
  if (meters == null) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString("en-US")} ft`;
}

function formatSpeed(metersPerSecond: number | null): string {
  if (metersPerSecond == null || metersPerSecond < 0) return "—";
  return `${(metersPerSecond * 2.23694).toFixed(1)} mph`;
}

export default function SessionPlayback({
  points,
  healthData,
}: {
  points: SessionPoint[];
  healthData?: unknown;
}) {
  const pointCount = points.length;
  const firstTime = points[0]?.time ?? 0;
  const lastTime = points[pointCount - 1]?.time ?? firstTime;
  const totalDuration = Math.max(1, lastTime - firstTime);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);
  const progressRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const distances = useMemo(() => buildSessionDistances(points), [points]);
  const elevationPoints = useMemo(
    () =>
      points.flatMap((point, sourceIndex) =>
        point.elevation == null
          ? []
          : [
              {
                dist: distances[sourceIndex],
                ele: point.elevation,
                sourceIndex,
              },
            ]
      ),
    [distances, points]
  );
  const healthSummary = useMemo(
    () => summarizeSessionHealthData(healthData),
    [healthData]
  );

  function commitProgress(nextProgress: number) {
    const clamped = Math.max(0, Math.min(nextProgress, 1));
    progressRef.current = clamped;
    setProgress(clamped);
  }

  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    setIsPlaying(false);
  }, [pointCount, firstTime, lastTime]);

  useEffect(() => {
    if (!isPlaying || pointCount < 2) return;

    const startingProgress = progressRef.current >= 1 ? 0 : progressRef.current;
    if (startingProgress !== progressRef.current) {
      progressRef.current = startingProgress;
      setProgress(startingProgress);
    }
    const startedAt = performance.now();
    const playbackDuration = BASE_PLAYBACK_DURATION_MS / speed;

    const tick = (now: number) => {
      const nextProgress =
        startingProgress + (now - startedAt) / playbackDuration;
      if (nextProgress >= 1) {
        progressRef.current = 1;
        setProgress(1);
        setIsPlaying(false);
        frameRef.current = null;
        return;
      }

      progressRef.current = nextProgress;
      setProgress(nextProgress);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [isPlaying, speed, pointCount]);

  if (pointCount === 0) return null;

  const cursorTime = firstTime + progress * totalDuration;
  const activeIndex = findSessionPointIndex(points, cursorTime);
  const activePoint = points[Math.max(0, activeIndex)];
  const activeDistance = distances[Math.max(0, activeIndex)] ?? 0;
  const activeHeartRate = heartRateAtTime(
    healthSummary.heartRates,
    activePoint.time
  );
  let elevationHighlightIndex = -1;
  for (let index = 0; index < elevationPoints.length; index += 1) {
    if (elevationPoints[index].sourceIndex <= activeIndex) {
      elevationHighlightIndex = index;
    } else {
      break;
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Activity playback
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Scrub the track or play the full recording in about 45 seconds at 1×.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {PLAYBACK_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                speed === option
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              }`}
            >
              {option}×
            </button>
          ))}
        </div>
      </div>

      <SessionMap points={points} activeIndex={activeIndex} />

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPlaying((playing) => !playing)}
            disabled={pointCount < 2}
            className="inline-flex min-w-20 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pointCount < 2
              ? "No playback"
              : isPlaying
                ? "Pause"
                : progress >= 1
                  ? "Replay"
                  : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(progress * 1000)}
            disabled={pointCount < 2}
            onChange={(event) => {
              setIsPlaying(false);
              commitProgress(Number(event.target.value) / 1000);
            }}
            aria-label="Playback position"
            aria-valuetext={`${formatDuration(
              activePoint.time - firstTime
            )} of ${formatDuration(totalDuration)}`}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-teal-700"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {formatDuration(activePoint.time - firstTime)} /{" "}
            {formatDuration(totalDuration)}
          </span>
        </div>

        <div
          className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 ${
            activeHeartRate == null ? "sm:grid-cols-4" : "sm:grid-cols-5"
          }`}
        >
          <PlaybackMetric
            label="Time"
            value={new Date(activePoint.time * 1000).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          />
          <PlaybackMetric
            label="Distance"
            value={formatDistance(activeDistance)}
          />
          <PlaybackMetric
            label="Elevation"
            value={formatElevation(activePoint.elevation)}
          />
          <PlaybackMetric
            label="Speed"
            value={formatSpeed(activePoint.speed)}
          />
          {activeHeartRate != null && (
            <PlaybackMetric
              label="Heart rate"
              value={`${activeHeartRate} bpm`}
            />
          )}
        </div>

        {elevationPoints.length >= 2 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-300">
              Elevation
            </h3>
            <ElevationProfile
              points={elevationPoints}
              highlightIndex={
                elevationHighlightIndex >= 0 ? elevationHighlightIndex : null
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}

function PlaybackMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white px-3 py-2.5 dark:bg-gray-900">
      <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {label}
      </div>
    </div>
  );
}
