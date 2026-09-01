import type { PrismaClient } from "@prisma/client";
import { isDateKey } from "@/lib/mtm/mobile-week";
import {
  createWorkforceNoShowExceptionCaseDraft,
  proposeWorkforceNoShowReviewFromResolvedConfiguration,
  type WorkforceNoShowProposal,
} from "@/lib/workforce/exception-intake";
import type { WorkforceExceptionCaseDraft } from "@/lib/workforce/exception-case-ledger";
import { resolveHistoricalPersistedWorkforceCalendarDay } from "@/lib/workforce/calendar";
import { resolveWorkforceHistoricalEmployment } from "@/lib/workforce/employment-history";
import { resolveCurrentWorkforcePolicy } from "@/lib/workforce/policy-resolution";
import { parseWorkforceShiftDefinition } from "@/lib/workforce/shift-definition";
import { resolveCurrentWorkforceShift } from "@/lib/workforce/shift-resolution";

/**
 * Narrow, read-only database surface for a future C6 no-show worker. It has
 * no exception-case writer, notification, queue, capability or audit method,
 * so completing this lookup can never make an absence operational by itself.
 */
export type WorkforceNoShowCandidateDb = Pick<
  PrismaClient,
  | "$queryRaw"
  | "mtmAgent"
  | "mtmAgentWorkday"
  | "mtmWorkCalendarDay"
  | "workforcePolicy"
  | "workforceShiftAssignment"
  | "workforceShiftDefaultAssignment"
  | "workforceShiftTeamDefaultAssignment"
  | "workforceShiftSegment"
  | "workforceShiftTemplate"
>;

export type WorkforceNoShowCandidate =
  | {
      outcome: "NOT_READY";
      code:
        | "WORKFORCE_NO_SHOW_EXPECTED_SHIFT_UNSCHEDULED"
        | "WORKFORCE_NO_SHOW_EMPLOYMENT_STATUS_UNAVAILABLE"
        | "WORKFORCE_NO_SHOW_NOT_EMPLOYED_AT_EXPECTATION"
        | "WORKFORCE_NO_SHOW_EXPECTATION_SUBJECT_UNAVAILABLE";
    }
  | {
      outcome: "DO_NOT_CREATE";
      proposal: WorkforceNoShowProposal;
    }
  | {
      outcome: "REVIEW_CANDIDATE";
      expectedStartAt: string;
      caseDraft: WorkforceExceptionCaseDraft;
    };

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function dateOnly(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

async function resolveShiftAtExpectedStart(
  db: WorkforceNoShowCandidateDb,
  input: {
    organizationId: string;
    agentId: string;
    workDate: string;
    asOf: Date;
  },
) {
  // First select a candidate using only the server clock. The later resolution
  // at its own planned start is the authoritative check: a template activated
  // after the expected start cannot be used to backdate a no-show expectation.
  const first = await resolveCurrentWorkforceShift(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workDate: input.workDate,
    workdayStartedAt: input.asOf,
    resolutionAt: input.asOf,
  });
  if (first.schedule == null) return null;

  let expectedStartAt = new Date(first.schedule.plannedStartAt);
  let resolved = await resolveCurrentWorkforceShift(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workDate: input.workDate,
    workdayStartedAt: expectedStartAt,
    resolutionAt: input.asOf,
  });
  if (resolved.schedule == null) return null;

  // A configuration lookup at `asOf` can point at a different historical
  // window. Resolve once more if its true planned start differs, rather than
  // using a potentially late template as the fact-time selector.
  const correctedStartAt = new Date(resolved.schedule.plannedStartAt);
  if (correctedStartAt.getTime() !== expectedStartAt.getTime()) {
    expectedStartAt = correctedStartAt;
    resolved = await resolveCurrentWorkforceShift(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workDate: input.workDate,
      workdayStartedAt: expectedStartAt,
      resolutionAt: input.asOf,
    });
    if (resolved.schedule == null) return null;
  }
  return { shift: resolved, expectedStartAt };
}

/**
 * Reads one prospective no-show subject without scheduling it or writing a
 * case. Every positive result is still only a C6 review candidate. Callers
 * must separately provide a worker lease/cursor, authorization, durable
 * writer and employee-visible lifecycle before any case can exist.
 */
export async function readWorkforceNoShowCandidate(
  db: WorkforceNoShowCandidateDb,
  input: {
    organizationId: string;
    agentId: string;
    workDate: string;
    asOf: Date;
  },
): Promise<WorkforceNoShowCandidate> {
  if (!isDateKey(input.workDate) || !validInstant(input.asOf)) {
    throw new RangeError("Workforce no-show candidate input is invalid");
  }

  const resolvedShift = await resolveShiftAtExpectedStart(db, input);
  if (resolvedShift == null) {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_EXPECTED_SHIFT_UNSCHEDULED",
    };
  }

  const { shift, expectedStartAt } = resolvedShift;
  const employment = await resolveWorkforceHistoricalEmployment(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    occurredAt: expectedStartAt,
  });
  if (!employment || employment.state === "UNKNOWN") {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_EMPLOYMENT_STATUS_UNAVAILABLE",
    };
  }
  if (employment.state !== "EMPLOYED") {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_NOT_EMPLOYED_AT_EXPECTATION",
    };
  }

  const policy = await resolveCurrentWorkforcePolicy(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workDate: input.workDate,
    workdayStartedAt: expectedStartAt,
    resolutionAt: input.asOf,
  });
  const [calendar, workday] = await Promise.all([
    resolveHistoricalPersistedWorkforceCalendarDay(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      date: input.workDate,
      workdayStartedAt: expectedStartAt,
    }),
    db.mtmAgentWorkday.findFirst({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workDate: dateOnly(input.workDate),
      },
      select: { id: true },
    }),
  ]);

  // The existing case ledger intentionally requires a concrete published
  // segment for a schedule-only subject. A legacy template with no segment,
  // or a multi-branch template whose first segment does not begin at the
  // published shift start, is incomplete rather than silently assigned a
  // fabricated generic segment.
  const shiftDefinition = parseWorkforceShiftDefinition(shift.definition);
  const firstSegment = await db.workforceShiftSegment.findFirst({
    where: {
      organizationId: input.organizationId,
      templateId: shift.id,
      sequence: 1,
      startTime: shiftDefinition.startTime,
    },
    select: { id: true },
  });
  if (!firstSegment) {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_EXPECTATION_SUBJECT_UNAVAILABLE",
    };
  }

  const proposal = proposeWorkforceNoShowReviewFromResolvedConfiguration({
    asOf: input.asOf.toISOString(),
    configuration: { workDate: input.workDate, policy, shift },
    calendar: {
      attendanceExpected: calendar.attendanceExpected,
      noShowEligible: calendar.noShowEligible,
      excused: calendar.excused,
    },
    workdayObservation: workday
      ? "WORKDAY_EXISTS"
      : "COMPLETE_SEARCH_NO_WORKDAY",
  });
  if (proposal.outcome !== "PROPOSE_REVIEW_CASE") {
    return { outcome: "DO_NOT_CREATE", proposal };
  }

  return {
    outcome: "REVIEW_CANDIDATE",
    expectedStartAt: shift.schedule!.plannedStartAt,
    caseDraft: createWorkforceNoShowExceptionCaseDraft({
      organizationId: input.organizationId,
      agentId: input.agentId,
      segmentId: firstSegment.id,
      expectedWorkDate: input.workDate,
      proposal,
    })!,
  };
}
