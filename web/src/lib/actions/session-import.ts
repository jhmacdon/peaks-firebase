"use server";

import { randomBytes } from "node:crypto";
import { verifyToken } from "../auth-actions";
import { peaksAPI as requestPeaksAPI } from "../peaks-api";
import {
  parseSessionGPX,
  type GPXSessionPoint,
} from "../session-import";
import type { SessionActivityType } from "./sessions";

const POINT_UPLOAD_CHUNK_SIZE = 2_000;
const ACTIVITY_TYPES = new Set<SessionActivityType>([
  "outdoor-trek",
  "outdoor-moto",
  "ski",
]);

export interface ImportGPXSessionInput {
  gpxContent: string;
  fileName: string;
  name: string;
  activityType: SessionActivityType;
  isPublic: boolean;
}

export interface ImportGPXSessionResult {
  id: string;
  duplicate: boolean;
  processingState: string | null;
  warning?: string;
}

async function peaksAPI<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return requestPeaksAPI<T>(
    token,
    path,
    init,
    "The Peaks service rejected the import"
  );
}

async function deleteIncompleteSession(
  token: string,
  sessionId: string
): Promise<void> {
  try {
    await peaksAPI(token, `/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    console.error("Failed to remove incomplete GPX import", sessionId, error);
  }
}

function apiPoints(points: GPXSessionPoint[]) {
  return points.map((point) => ({
    time: point.time,
    segment_number: point.segment_number,
    lat: point.lat,
    lng: point.lng,
    elevation: point.elevation,
  }));
}

function metadataBody(
  parsed: ReturnType<typeof parseSessionGPX>,
  name: string,
  activityType: SessionActivityType,
  isPublic: boolean
) {
  const startDate = new Date(parsed.startTime * 1000).toISOString();
  const endDate = new Date(parsed.endTime * 1000).toISOString();
  const importedAt = new Date().toISOString();

  return {
    name,
    start_date: startDate,
    end_date: endDate,
    distance: parsed.stats.distance,
    total_time: parsed.stats.totalTime,
    pace: parsed.stats.pace,
    gain: parsed.stats.gain,
    high_point: parsed.stats.highestPoint,
    ascent_time: parsed.stats.ascentTime,
    descent_time: parsed.stats.descentTime,
    still_time: parsed.stats.stillTime,
    activity_type: activityType,
    source: parsed.source,
    external_id: parsed.externalId,
    source_contributions: [
      {
        source: parsed.source,
        external_id: parsed.externalId,
        source_activity_name: name,
        source_activity_type: "GPX Import",
        original_start_date: startDate,
        original_end_date: endDate,
        fragment_start_date: startDate,
        fragment_end_date: endDate,
        imported_at: importedAt,
        contribution_types: ["gps_gap", "stats"],
        summary: {
          distance: parsed.stats.distance,
          elevation_gain: parsed.stats.gain,
          elapsed_time: parsed.stats.totalTime,
          moving_time: parsed.stats.totalTime,
        },
      },
    ],
    is_public: isPublic,
  };
}

async function currentSessionState(
  token: string,
  sessionId: string
): Promise<{ ended: boolean; processing_state?: string } | null> {
  try {
    return await peaksAPI(
      token,
      `/api/sessions/${encodeURIComponent(sessionId)}`
    );
  } catch {
    return null;
  }
}

export async function importGPXSession(
  token: string,
  input: ImportGPXSessionInput
): Promise<ImportGPXSessionResult> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  if (
    !input ||
    typeof input.gpxContent !== "string" ||
    typeof input.fileName !== "string" ||
    typeof input.name !== "string"
  ) {
    throw new Error("GPX import data is incomplete");
  }
  if (!ACTIVITY_TYPES.has(input.activityType)) {
    throw new Error("Choose a supported activity type");
  }

  const parsed = parseSessionGPX(input.gpxContent, input.fileName);
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new Error("Activity name is required");

  const dedupParams = new URLSearchParams({
    source: parsed.source,
    externalId: parsed.externalId,
  });
  const duplicate = await peaksAPI<{
    exists: boolean;
    sessionId: string | null;
  }>(token, `/api/sessions/dedup?${dedupParams.toString()}`);

  if (duplicate.exists) {
    if (!duplicate.sessionId) {
      throw new Error("This GPX file was imported before");
    }
    return {
      id: duplicate.sessionId,
      duplicate: true,
      processingState: null,
    };
  }

  const sessionId = randomBytes(10).toString("hex");
  const metadata = metadataBody(
    parsed,
    name,
    input.activityType,
    input.isPublic === true
  );

  try {
    await peaksAPI(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        id: sessionId,
        ...metadata,
        ended: false,
      }),
    });

    for (
      let offset = 0;
      offset < parsed.points.length;
      offset += POINT_UPLOAD_CHUNK_SIZE
    ) {
      const chunk = parsed.points.slice(
        offset,
        offset + POINT_UPLOAD_CHUNK_SIZE
      );
      await peaksAPI(
        token,
        `/api/sessions/${encodeURIComponent(sessionId)}/points`,
        {
          method: "POST",
          body: JSON.stringify({ points: apiPoints(chunk) }),
        }
      );
    }
  } catch (error) {
    // The create response may have been lost after the server committed, so
    // clean up by the known id even when the local request did not confirm it.
    await deleteIncompleteSession(token, sessionId);
    throw error;
  }

  let finalizeError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const finalized = await peaksAPI<{ processing_state?: string | null }>(
        token,
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PUT",
          body: JSON.stringify({ ...metadata, ended: true }),
        }
      );
      const processingState = finalized.processing_state ?? null;
      return {
        id: sessionId,
        duplicate: false,
        processingState,
        ...(processingState === "failed"
          ? {
              warning:
                "The activity is saved, but place and route matching has not finished.",
            }
          : {}),
      };
    } catch (error) {
      finalizeError = error;
      const current = await currentSessionState(token, sessionId);
      if (current?.ended) {
        return {
          id: sessionId,
          duplicate: false,
          processingState: current.processing_state ?? null,
          warning:
            "The activity is saved. Automatic matching may still be finishing.",
        };
      }
    }
  }

  const current = await currentSessionState(token, sessionId);
  if (current && !current.ended) {
    await deleteIncompleteSession(token, sessionId);
    throw finalizeError instanceof Error
      ? finalizeError
      : new Error("The GPX import could not be finished");
  }

  return {
    id: sessionId,
    duplicate: false,
    processingState: current?.processing_state ?? null,
    warning:
      "The track was uploaded, but Peaks could not confirm that matching finished.",
  };
}
