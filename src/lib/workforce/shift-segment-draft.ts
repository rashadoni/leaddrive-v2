export const WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES = [
  "SITE",
  "REMOTE",
  "FIELD",
  "TRAVEL",
  "EXCEPTION",
] as const

export type WorkforceShiftSegmentEditorMode = typeof WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES[number]
export type WorkforceShiftSegmentStoredMode = WorkforceShiftSegmentEditorMode | "ON_CALL"

export type WorkforceShiftSegmentDraft = {
  editorKey: string
  mode: WorkforceShiftSegmentStoredMode
  siteId: string | null
  startTime: string
  endTime: string
  lateGraceSeconds: string
  proofPolicyReference: string | null
}

export type WorkforceShiftSegmentPayload = {
  mode: WorkforceShiftSegmentStoredMode
  siteId: string | null
  startTime: string
  endTime: string
  lateGraceSeconds: number
  proofPolicyReference: string | null
}

export type WorkforceShiftSegmentValidationIssue =
  | "TOO_MANY"
  | "UNRELEASED_MODE"
  | "INCOMPLETE"
  | "TIME_ORDER"
  | "SITE_REQUIRED"
  | "SITE_UNAVAILABLE"
  | "NON_SITE_SITE"
  | "GRACE_INVALID"
  | "OUTSIDE_SHIFT"
  | "OVERLAP"
  | "BREAK_OVERLAP"

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function createWorkforceShiftSegmentDraft(input: {
  editorKey: string
  startTime: string
  endTime: string
}): WorkforceShiftSegmentDraft {
  return {
    editorKey: input.editorKey,
    mode: "REMOTE",
    siteId: null,
    startTime: input.startTime,
    endTime: input.endTime,
    lateGraceSeconds: "0",
    proofPolicyReference: null,
  }
}

export function nextWorkforceShiftSegmentWindow(input: {
  segments: readonly WorkforceShiftSegmentDraft[]
  shiftStartTime: string
  shiftEndTime: string
  plannedBreaks: ReadonlyArray<{ startTime: string; endTime: string }>
}): { startTime: string; endTime: string } {
  let startTime = input.segments[input.segments.length - 1]?.endTime || input.shiftStartTime
  const plannedBreaks = input.plannedBreaks
    .filter((plannedBreak) => (
      LOCAL_TIME.test(plannedBreak.startTime)
      && LOCAL_TIME.test(plannedBreak.endTime)
      && plannedBreak.endTime > plannedBreak.startTime
    ))
    .sort((left, right) => left.startTime.localeCompare(right.startTime))

  for (const plannedBreak of plannedBreaks) {
    if (startTime >= plannedBreak.startTime && startTime < plannedBreak.endTime) {
      startTime = plannedBreak.endTime
    }
  }
  const nextBreak = plannedBreaks.find((plannedBreak) => plannedBreak.startTime > startTime)
  const endTime = nextBreak?.startTime && nextBreak.startTime < input.shiftEndTime
    ? nextBreak.startTime
    : input.shiftEndTime

  if (!LOCAL_TIME.test(startTime) || !LOCAL_TIME.test(endTime) || startTime >= endTime) {
    return { startTime: "", endTime: "" }
  }
  return { startTime, endTime }
}

export function workforceShiftSegmentPayload(
  segments: readonly WorkforceShiftSegmentDraft[],
): WorkforceShiftSegmentPayload[] {
  return segments.map((segment) => ({
    mode: segment.mode,
    siteId: segment.siteId,
    startTime: segment.startTime,
    endTime: segment.endTime,
    lateGraceSeconds: Number(segment.lateGraceSeconds),
    // Proof-policy administration is a separate permission surface. Existing
    // references still round-trip exactly when another draft field changes.
    proofPolicyReference: segment.proofPolicyReference,
  }))
}

export function validateWorkforceShiftSegmentDraft(input: {
  segments: readonly WorkforceShiftSegmentDraft[]
  shiftStartTime: string
  shiftEndTime: string
  plannedBreaks: ReadonlyArray<{ startTime: string; endTime: string }>
  activeSiteIds: ReadonlySet<string>
}): WorkforceShiftSegmentValidationIssue | null {
  if (input.segments.length === 0) return null
  if (input.segments.length > 24) return "TOO_MANY"

  let previous: WorkforceShiftSegmentDraft | null = null
  for (const segment of input.segments) {
    if (!WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES.some((mode) => mode === segment.mode)) {
      return "UNRELEASED_MODE"
    }
    if (!LOCAL_TIME.test(segment.startTime) || !LOCAL_TIME.test(segment.endTime)) {
      return "INCOMPLETE"
    }
    if (segment.endTime <= segment.startTime) return "TIME_ORDER"
    if (segment.mode === "SITE") {
      if (!segment.siteId) return "SITE_REQUIRED"
      if (!input.activeSiteIds.has(segment.siteId)) return "SITE_UNAVAILABLE"
    } else if (segment.siteId != null) {
      return "NON_SITE_SITE"
    }

    if (!segment.lateGraceSeconds.trim()) return "GRACE_INVALID"
    const lateGraceSeconds = Number(segment.lateGraceSeconds)
    if (
      !Number.isSafeInteger(lateGraceSeconds)
      || lateGraceSeconds < 0
      || lateGraceSeconds > 2 * 60 * 60
    ) {
      return "GRACE_INVALID"
    }
    if (segment.startTime < input.shiftStartTime || segment.endTime > input.shiftEndTime) {
      return "OUTSIDE_SHIFT"
    }
    if (previous && segment.startTime < previous.endTime) return "OVERLAP"
    if (input.plannedBreaks.some((plannedBreak) => (
      segment.startTime < plannedBreak.endTime && plannedBreak.startTime < segment.endTime
    ))) {
      return "BREAK_OVERLAP"
    }
    previous = segment
  }

  return null
}
