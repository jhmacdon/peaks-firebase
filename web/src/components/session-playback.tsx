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
import { formatClock, smoothMetricSeries } from "../lib/session-detail";
import { describeElevationProfile } from "../lib/format";
import ElevationProfile, {
  type ElevationProfileMetric,
} from "./elevation-profile";
import { useElevationProfileColors } from "./use-elevation-profile-colors";
import { Button } from "./ui/button";
import { Chip } from "./ui/chip";
import { StatCluster } from "./ui/stat";

const SessionMap = dynamic(() => import("./session-map"), {
  ssr: false,
});

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_PLAYBACK_DURATION_MS = 45_000;

type ChartMetric = "elevation" | "speed" | "heartRate";

function formatDistance(meters: number): string {
  return `${(meters / 1609.344).toFixed(2)}`;
}

function formatElevation(meters: number | null): string | null {
  if (meters == null) return null;
  return Math.round(meters * 3.28084).toLocaleString("en-US");
}

function formatSpeed(milesPerHour: number | null | undefined): string | null {
  if (milesPerHour == null || !Number.isFinite(milesPerHour)) return null;
  return milesPerHour.toFixed(1);
}

export default function SessionPlayback({
  points,
  healthData,
  distanceMeters = null,
  gainMeters = null,
  highPointMeters = null,
}: {
  points: SessionPoint[];
  healthData?: unknown;
  /** The activity's own recorded figures, used only to write the chart's
   * text alternative. They beat anything summed off the plotted series —
   * the recorder measured the climb, the series merely draws it — and they
   * keep the spoken summary agreeing with the topline above it. */
  distanceMeters?: number | null;
  gainMeters?: number | null;
  highPointMeters?: number | null;
}) {
  const pointCount = points.length;
  const firstTime = points[0]?.time ?? 0;
  const lastTime = points[pointCount - 1]?.time ?? firstTime;
  const totalDuration = Math.max(1, lastTime - firstTime);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("elevation");
  const progressRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const colors = useElevationProfileColors();

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

  // Speed is smoothed once, per track point, and everything downstream —
  // the chart line and the scrubber's own reading — uses the smoothed
  // series, so the two never disagree. Per-point GPS speed swings several
  // mph between consecutive samples; unsmoothed it draws a picket fence and
  // makes the reading jump as you drag.
  const rawSpeedsMph = useMemo(
    () =>
      points.map((point) =>
        point.speed != null && Number.isFinite(point.speed) && point.speed >= 0
          ? point.speed * 2.23694
          : null
      ),
    [points]
  );
  const smoothedSpeedsMph = useMemo(
    () => smoothMetricSeries(rawSpeedsMph),
    [rawSpeedsMph]
  );

  // Both optional series are sampled onto the elevation chart's own x-axis,
  // so a toggle only swaps which one gets the accent line — the grey
  // elevation area underneath never moves.
  const speedValues = useMemo(
    () =>
      elevationPoints.map((point) => smoothedSpeedsMph[point.sourceIndex] ?? null),
    [elevationPoints, smoothedSpeedsMph]
  );
  const heartRateValues = useMemo(
    () =>
      elevationPoints.map((point) =>
        heartRateAtTime(healthSummary.heartRates, points[point.sourceIndex].time)
      ),
    [elevationPoints, healthSummary.heartRates, points]
  );

  const hasSpeed = speedValues.filter((value) => value != null).length >= 2;
  const hasHeartRate = healthSummary.heartRates.length >= 2;
  const activeMetric: ChartMetric =
    (chartMetric === "speed" && !hasSpeed) ||
    (chartMetric === "heartRate" && !hasHeartRate)
      ? "elevation"
      : chartMetric;

  // Heart rate is left alone: those are real per-second measurements, and a
  // window wide enough to tame GPS speed would erase a genuine interval.
  const chartMetricSeries: ElevationProfileMetric | null = useMemo(() => {
    if (activeMetric === "speed") {
      return {
        values: speedValues,
        formatTick: (value) => value.toFixed(1),
        unit: "mph",
      };
    }
    if (activeMetric === "heartRate") {
      return {
        values: heartRateValues,
        formatTick: (value) => String(Math.round(value)),
        unit: "bpm",
      };
    }
    return null;
  }, [activeMetric, heartRateValues, speedValues]);

  // Averaged over the raw samples, not the smoothed line — a mean of means
  // would drift at the ends where the window tapers.
  const metricAverage = useMemo(() => {
    const series =
      activeMetric === "speed"
        ? rawSpeedsMph
        : activeMetric === "heartRate"
          ? heartRateValues
          : null;
    if (!series) return null;
    const samples = series.filter(
      (value): value is number => value != null && Number.isFinite(value)
    );
    if (samples.length === 0) return null;
    const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
    return activeMetric === "speed"
      ? `${mean.toFixed(1)} mph avg`
      : `${Math.round(mean)} bpm avg`;
  }, [activeMetric, heartRateValues, rawSpeedsMph]);

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
  const activeElevation = formatElevation(activePoint.elevation);
  const activeSpeed = formatSpeed(smoothedSpeedsMph[Math.max(0, activeIndex)]);
  let elevationHighlightIndex = -1;
  for (let index = 0; index < elevationPoints.length; index += 1) {
    if (elevationPoints[index].sourceIndex <= activeIndex) {
      elevationHighlightIndex = index;
    } else {
      break;
    }
  }

  const metricOptions: { id: ChartMetric; label: string }[] = [
    { id: "elevation", label: "Elevation" },
    ...(hasSpeed ? [{ id: "speed" as const, label: "Speed" }] : []),
    ...(hasHeartRate ? [{ id: "heartRate" as const, label: "Heart rate" }] : []),
  ];

  // What the chart is showing, said in words. The elevation summary is
  // always true of the plot; a selected metric adds a clause rather than
  // replacing it, because the grey area is still there underneath.
  const profileSummary = describeElevationProfile({
    distanceMeters,
    gainMeters,
    highPointMeters,
  });
  const chartLabel =
    activeMetric === "speed"
      ? `${profileSummary}, with speed in miles per hour plotted against distance`
      : activeMetric === "heartRate"
        ? `${profileSummary}, with heart rate in beats per minute plotted against distance`
        : profileSummary;

  // The spoken form of the cursor readout below. Labelled, units spelled
  // out — this string is only ever heard.
  const cursorReadout = [
    `Time ${new Date(activePoint.time * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`,
    `distance ${formatDistance(activeDistance)} miles`,
    activeElevation ? `elevation ${activeElevation} feet` : null,
    activeSpeed ? `speed ${activeSpeed} miles per hour` : null,
    activeHeartRate != null
      ? `heart rate ${activeHeartRate} beats per minute`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  return (
    <section aria-label="Map and playback">
      {/* One rounded container for the whole section: media at the top, the
          controls and chart flat underneath (design-tokens.md law 1). */}
      <div className="overflow-hidden rounded-media border border-border">
        <SessionMap
          points={points}
          activeIndex={activeIndex}
          className="h-80 sm:h-96"
        />

        <div className="space-y-6 px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setIsPlaying((playing) => !playing)}
              disabled={pointCount < 2}
              className="min-w-24"
            >
              {pointCount < 2
                ? "No playback"
                : isPlaying
                  ? "Pause"
                  : progress >= 1
                    ? "Replay"
                    : "Play"}
            </Button>
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
              aria-valuetext={`${formatClock(
                activePoint.time - firstTime
              )} of ${formatClock(totalDuration)}`}
              className="h-2 min-w-40 flex-1 cursor-pointer accent-accent"
            />
            <span className="shrink-0 font-mono-num text-xs tabular-nums text-muted">
              {formatClock(activePoint.time - firstTime)} /{" "}
              {formatClock(totalDuration)}
            </span>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Playback speed"
            >
              {PLAYBACK_SPEEDS.map((option) => (
                <Chip
                  key={option}
                  selected={speed === option}
                  onClick={() => setSpeed(option)}
                >
                  {option}×
                </Chip>
              ))}
            </div>
          </div>

          {/* The cursor's readings — flat clusters, no cells (law 2).
              Hidden from assistive tech in favour of the throttled live
              region below, which carries the same values in one labelled
              sentence; without that, a scrub would fire five separate
              announcements per frame. */}
          <div className="flex flex-wrap gap-x-10 gap-y-5" aria-hidden="true">
            <StatCluster
              value={new Date(activePoint.time * 1000).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              label="Time"
            />
            <StatCluster
              value={formatDistance(activeDistance)}
              unit="mi"
              label="Distance"
            />
            {activeElevation ? (
              <StatCluster value={activeElevation} unit="ft" label="Elevation" />
            ) : null}
            {activeSpeed ? (
              <StatCluster value={activeSpeed} unit="mph" label="Speed" />
            ) : null}
            {activeHeartRate != null ? (
              <StatCluster
                value={String(activeHeartRate)}
                unit="bpm"
                label="Heart rate"
              />
            ) : null}
          </div>

          <PlaybackAnnouncer text={cursorReadout} silent={isPlaying} />

          {elevationPoints.length >= 2 ? (
            <div>
              <ElevationProfile
                points={elevationPoints}
                colors={colors}
                metric={chartMetricSeries}
                label={chartLabel}
                highlightIndex={
                  elevationHighlightIndex >= 0 ? elevationHighlightIndex : null
                }
              />
              {/* Toggles below the chart instead of a legend, with the
                  selected metric's average beside them (audit §5.2). */}
              {metricOptions.length > 1 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Chart metric"
                  >
                    {metricOptions.map((option) => (
                      <Chip
                        key={option.id}
                        selected={activeMetric === option.id}
                        onClick={() => setChartMetric(option.id)}
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </div>
                  {metricAverage ? (
                    <span className="font-mono-num text-xs tabular-nums text-muted">
                      {metricAverage}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** How often the scrubber may speak. The slider has 1,000 discrete steps and
 * playback advances every animation frame, so an unthrottled live region
 * would queue hundreds of polite announcements and leave a screen reader
 * minutes behind the cursor. Two seconds is slow enough to stay in step with
 * a dragging thumb and fast enough that letting go feels answered. */
const ANNOUNCE_INTERVAL_MS = 2000;

/** The scrubber's spoken readout: one polite live region, throttled, with a
 * trailing announcement so the value the reader actually stopped on is the
 * one they hear.
 *
 * Silent during playback. A 45-second run at 1x would otherwise fire twenty
 * or so announcements that queue behind each other; the reader would still
 * be hearing the second mile as the track finished. When playback stops the
 * effect runs again with the final position and announces it.
 */
function PlaybackAnnouncer({
  text,
  silent,
}: {
  text: string;
  silent: boolean;
}) {
  const [announced, setAnnounced] = useState("");
  const lastAnnouncedAt = useRef(0);

  useEffect(() => {
    if (silent) return;

    const elapsed = Date.now() - lastAnnouncedAt.current;
    if (elapsed >= ANNOUNCE_INTERVAL_MS) {
      lastAnnouncedAt.current = Date.now();
      setAnnounced(text);
      return;
    }

    const timer = window.setTimeout(() => {
      lastAnnouncedAt.current = Date.now();
      setAnnounced(text);
    }, ANNOUNCE_INTERVAL_MS - elapsed);
    return () => window.clearTimeout(timer);
  }, [text, silent]);

  // The first value lands before the region is live, so it is read in
  // ordinary browse mode rather than announced — which is what a reader
  // arriving at the section should get.
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {announced}
    </p>
  );
}
