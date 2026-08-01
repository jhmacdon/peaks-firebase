export const JOB_STATES = [
  "queued",
  "researching",
  "candidate_ready",
  "pending_review",
  "needs_revision",
  "approved",
  "published",
  "verified",
  "needs_geometry",
  "waiting_rights",
  "waiting_access",
  "needs_human",
] as const;

export type JobState = (typeof JOB_STATES)[number];
export type JobStage =
  | "next"
  | "research"
  | "import"
  | "review"
  | "publish"
  | "verify";

export type VerificationAction =
  | "verified"
  | "rebuild"
  | "retry"
  | "needs_human";

export function verificationAction(result: {
  verdict: "PASS" | "FAIL";
  gates: {
    owner: boolean;
    active: boolean;
    destination_order: boolean;
    segments: boolean;
    provenance: boolean;
    public_http: boolean;
  };
}): VerificationAction {
  if (result.verdict === "PASS" && Object.values(result.gates).every(Boolean)) {
    return "verified";
  }
  if (
    !result.gates.owner ||
    !result.gates.active ||
    !result.gates.destination_order
  ) {
    return "needs_human";
  }
  if (!result.gates.segments || !result.gates.provenance) {
    return "rebuild";
  }
  return "retry";
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const transitions: Record<JobState, readonly JobState[]> = {
  queued: ["researching", "needs_human"],
  researching: [
    "candidate_ready",
    "needs_geometry",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  candidate_ready: [
    "pending_review",
    "needs_revision",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  pending_review: [
    "approved",
    "needs_revision",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  needs_revision: [
    "researching",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  approved: [
    "published",
    "needs_revision",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  published: ["verified", "needs_revision", "needs_human"],
  verified: [],
  needs_geometry: [
    "researching",
    "waiting_rights",
    "waiting_access",
    "needs_human",
  ],
  waiting_rights: ["queued", "needs_human"],
  waiting_access: ["queued", "needs_human"],
  needs_human: ["queued"],
};

export const BLOCKED_STATES: ReadonlySet<JobState> = new Set([
  "needs_geometry",
  "waiting_rights",
  "waiting_access",
  "needs_human",
]);

export function isJobState(value: string): value is JobState {
  return JOB_STATES.includes(value as JobState);
}

export function humanRequeueTargetState(from: JobState): JobState | null {
  if (from === "needs_revision") return "pending_review";
  if (
    from === "waiting_rights" ||
    from === "waiting_access" ||
    from === "needs_human"
  ) {
    return "queued";
  }
  return null;
}

export function canTransition(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function statesForStage(stage: JobStage): readonly JobState[] {
  switch (stage) {
    case "research":
      return ["queued", "researching", "needs_revision", "needs_geometry"];
    case "review":
      return ["pending_review"];
    case "import":
      return ["candidate_ready"];
    case "publish":
      return ["approved"];
    case "verify":
      return ["published"];
    case "next":
      return [
        "published",
        "approved",
        "pending_review",
        "candidate_ready",
        "queued",
        "researching",
        "needs_revision",
        "needs_geometry",
      ];
  }
}

export function stageForState(state: JobState): Exclude<JobStage, "next"> | null {
  if (state === "published") return "verify";
  if (state === "approved") return "publish";
  if (state === "pending_review") return "review";
  if (state === "candidate_ready") return "import";
  if (
    state === "queued" ||
    state === "researching" ||
    state === "needs_revision" ||
    state === "needs_geometry"
  ) {
    return "research";
  }
  return null;
}

export function claimRankSql(): string {
  return `CASE state
    WHEN 'published' THEN 1
    WHEN 'approved' THEN 2
    WHEN 'pending_review' THEN 3
    WHEN 'candidate_ready' THEN 4
    WHEN 'needs_revision' THEN 5
    WHEN 'researching' THEN 5
    WHEN 'queued' THEN 6
    WHEN 'needs_geometry' THEN 7
    ELSE 99
  END`;
}
