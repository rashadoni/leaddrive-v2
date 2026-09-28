import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import type {
  WorkforceTimesheetImmutableScheduleContext,
} from "@/lib/workforce/timesheet-calculation"
import { workforceWorkdayScheduleSnapshotHash } from "@/lib/workforce/snapshot-writer"

const Identifier = z.string().min(1).max(191).refine(
  (value) => value === value.trim(),
  "identifier must not contain surrounding whitespace",
)
const Hash = z.string().regex(/^[a-f0-9]{64}$/i)
const LocalTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const SafeSeconds = z.number().int().min(0).refine(Number.isSafeInteger)
const SegmentMode = z.enum(["SITE", "REMOTE", "FIELD", "TRAVEL", "ON_CALL", "EXCEPTION"])

const CalendarSnapshot = z.object({
  date: z.string().refine(isDateKey),
  state: z.literal("SCHEDULED"),
  calendarKind: z.enum(["WORKING_DAY", "EXCEPTION_WORKDAY", "MOVED_WORKDAY"]),
  attendanceExpected: z.literal(true),
  noShowEligible: z.literal(true),
  excused: z.literal(false),
  source: z.string().max(1000).nullable(),
  overrideId: Identifier.nullable(),
  teamMembership: z.object({
    id: Identifier.nullable(),
    teamId: Identifier.nullable(),
  }).strict().refine(
    (value) => (value.id === null) === (value.teamId === null),
    "team membership id and team id must either both exist or both be null",
  ),
}).strict()

const Segment = z.object({
  id: Identifier,
  sequence: z.number().int().min(1).refine(Number.isSafeInteger),
  mode: SegmentMode,
  siteId: Identifier.nullable(),
  startTime: LocalTime,
  endTime: LocalTime,
  lateGraceSeconds: SafeSeconds,
  proofPolicyReference: z.string().min(1).max(64).refine(
    (value) => value === value.trim(),
    "proof policy reference must not contain surrounding whitespace",
  ).nullable(),
}).strict().superRefine((value, context) => {
  if (value.endTime <= value.startTime) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "segment end must be after start" })
  }
  if ((value.mode === "SITE") !== (value.siteId !== null)) {
    context.addIssue({ code: "custom", path: ["siteId"], message: "site is required exactly for SITE segments" })
  }
})

const Site = z.object({ id: Identifier }).passthrough()

export type WorkforceWorkdayScheduleSnapshotForCalculation = {
  id: string
  workdayId: string
  agentId: string
  workDate: Date
  policySnapshotId: string
  shiftSnapshotId: string
  schemaVersion: number
  calendarState: string
  calendarSnapshot: unknown
  segments: unknown
  sites: unknown
  snapshotHash: string
}

export class WorkforceTimesheetScheduleSnapshotError extends Error {
  readonly code = "WORKFORCE_TIMESHEET_SCHEDULE_SNAPSHOT_INVALID"
}

function fail(message: string): never {
  throw new WorkforceTimesheetScheduleSnapshotError(message)
}

function intersects(
  left: { startTime: string; endTime: string },
  right: { startTime: string; endTime: string },
): boolean {
  return left.startTime < right.endTime && right.startTime < left.endTime
}

/**
 * Verifies and minimizes the complete schedule snapshot before it can affect
 * a timesheet approval. Raw sites, addresses and geometry are hash-bound but
 * deliberately excluded from the returned calculation context.
 */
export function verifyWorkforceTimesheetScheduleSnapshot(input: {
  snapshot: WorkforceWorkdayScheduleSnapshotForCalculation
  workDate: string
  policySnapshotId: string
  policyDefinitionHash: string
  shiftSnapshotId: string
  shiftDefinitionHash: string
  shiftDefinition: {
    startTime: string
    endTime: string
    plannedBreaks?: ReadonlyArray<{ startTime: string; endTime: string }>
  }
}): WorkforceTimesheetImmutableScheduleContext {
  const { snapshot } = input
  if (
    !Identifier.safeParse(snapshot.id).success
    || snapshot.schemaVersion !== 2
    || snapshot.calendarState !== "SCHEDULED"
  ) {
    fail("Schedule snapshot must use the supported scheduled-workday schema")
  }
  if (snapshot.policySnapshotId !== input.policySnapshotId || snapshot.shiftSnapshotId !== input.shiftSnapshotId) {
    fail("Schedule snapshot does not link the supplied policy and shift snapshots")
  }

  const calendar = CalendarSnapshot.safeParse(snapshot.calendarSnapshot)
  const segments = z.array(Segment).max(64).safeParse(snapshot.segments)
  const sites = z.array(Site).max(64).safeParse(snapshot.sites)
  if (!calendar.success || !segments.success || !sites.success) {
    fail("Schedule snapshot contains malformed calendar, segment or site history")
  }
  if (calendar.data.date !== input.workDate || calendar.data.state !== snapshot.calendarState) {
    fail("Schedule calendar does not belong to the workday")
  }

  const segmentIds = new Set<string>()
  const scheduledSiteIds = new Set<string>()
  for (const [index, segment] of segments.data.entries()) {
    if (segment.sequence !== index + 1 || segmentIds.has(segment.id)) {
      fail("Schedule segments must have unique contiguous immutable order")
    }
    segmentIds.add(segment.id)
    if (segment.startTime < input.shiftDefinition.startTime || segment.endTime > input.shiftDefinition.endTime) {
      fail("Schedule segment is outside its immutable shift window")
    }
    const previous = segments.data[index - 1]
    if (previous && segment.startTime < previous.endTime) {
      fail("Schedule segments must be chronological and non-overlapping")
    }
    if ((input.shiftDefinition.plannedBreaks ?? []).some((plannedBreak) => intersects(segment, plannedBreak))) {
      fail("Schedule segment overlaps immutable planned-break metadata")
    }
    if (segment.siteId) scheduledSiteIds.add(segment.siteId)
  }

  const siteIds = sites.data.map((site) => site.id)
  if (
    new Set(siteIds).size !== siteIds.length
    || siteIds.length !== scheduledSiteIds.size
    || siteIds.some((siteId) => !scheduledSiteIds.has(siteId))
  ) {
    fail("Schedule sites must exactly cover the immutable SITE segments")
  }

  if (!Hash.safeParse(snapshot.snapshotHash).success) {
    fail("Schedule snapshot hash is malformed")
  }
  const payload = {
    schemaVersion: snapshot.schemaVersion,
    calendar: snapshot.calendarSnapshot,
    segments: snapshot.segments,
    sites: snapshot.sites,
    policySnapshotId: snapshot.policySnapshotId,
    shiftSnapshotId: snapshot.shiftSnapshotId,
  }
  if (workforceWorkdayScheduleSnapshotHash(payload) !== snapshot.snapshotHash.toLowerCase()) {
    fail("Schedule snapshot does not match its immutable hash")
  }

  return {
    scheduleSnapshotId: snapshot.id,
    scheduleSnapshotHash: snapshot.snapshotHash.toLowerCase(),
    policyDefinitionHash: input.policyDefinitionHash.toLowerCase(),
    shiftDefinitionHash: input.shiftDefinitionHash.toLowerCase(),
    calendarState: "SCHEDULED",
    segmentCount: segments.data.length,
    segmentModes: segments.data.map((segment) => segment.mode),
    plannedBreakCount: input.shiftDefinition.plannedBreaks?.length ?? 0,
    breakTreatment: "ACTUAL_PAUSE_EVENTS_ONLY",
    travelTreatment: "NON_PAYROLL_NO_AUTOMATIC_ADJUSTMENT",
    calendarTreatment: "PINNED_EXPECTED_WORKDAY",
    exceptionTreatment: "RESOLUTION_REQUIRED_BEFORE_APPROVAL",
    correctionTreatment: "IMMUTABLE_LEDGER_REPLAY",
  }
}
