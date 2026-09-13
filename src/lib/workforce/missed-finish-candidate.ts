import type { PrismaClient } from "@prisma/client";
import {
  proposeWorkforceMissedFinishAction,
  type WorkforceMissedFinishProposal,
} from "@/lib/workforce/exception-intake";

/**
 * Deliberately read-only surface for a future missed-finish worker. It cannot
 * create a case, send a notification, close a workday, write an audit row or
 * inspect tenant capability state. The future operational worker must add
 * those concerns only after a reviewed policy, lease and lifecycle exist.
 */
export type WorkforceMissedFinishCandidateDb = Pick<
  PrismaClient,
  "mtmAgentWorkday" | "workforceShiftSnapshot"
>;

export type WorkforceMissedFinishCandidate =
  | {
      outcome: "NOT_READY";
      code:
        | "WORKFORCE_MISSED_FINISH_WORKDAY_UNAVAILABLE"
        | "WORKFORCE_MISSED_FINISH_WORKDAY_STATE_UNAVAILABLE"
        | "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE";
    }
  | {
      outcome: "DO_NOT_ACT";
      code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN";
    }
  | {
      outcome: "DO_NOT_ACT";
      proposal: Extract<WorkforceMissedFinishProposal, { outcome: "DO_NOT_ACT" }>;
    }
  | {
      outcome: "ACTION_CANDIDATE";
      workdayId: string;
      proposal: Extract<
        WorkforceMissedFinishProposal,
        { outcome: "PROPOSE_PRIVATE_REMINDER" | "PROPOSE_REVIEW_CASE" }
      >;
    };

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function openWorkdayStatus(value: string): "STARTED" | "PAUSED" | null {
  if (value === "STARTED" || value === "PAUSED") return value;
  return null;
}

/**
 * Reads one existing open workday and its immutable shift end without
 * scheduling, notifying or changing it. Timing remains an explicit internal
 * policy input: no global reminder/review threshold is invented here.
 */
export async function readWorkforceMissedFinishCandidate(
  db: WorkforceMissedFinishCandidateDb,
  input: {
    organizationId: string;
    agentId: string;
    workdayId: string;
    asOf: Date;
    timing: {
      privateReminderAfterSeconds: number;
      reviewAfterSeconds: number;
    };
  },
): Promise<WorkforceMissedFinishCandidate> {
  if (
    !validInstant(input.asOf)
    || !input.organizationId.trim()
    || !input.agentId.trim()
    || !input.workdayId.trim()
  ) {
    throw new RangeError("Workforce missed-finish candidate input is invalid");
  }

  const workday = await db.mtmAgentWorkday.findFirst({
    where: {
      id: input.workdayId,
      organizationId: input.organizationId,
      agentId: input.agentId,
    },
    select: {
      id: true,
      status: true,
    },
  });
  if (!workday) {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_MISSED_FINISH_WORKDAY_UNAVAILABLE",
    };
  }

  if (workday.status === "COMPLETED") {
    return {
      outcome: "DO_NOT_ACT",
      code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN",
    };
  }
  const status = openWorkdayStatus(workday.status);
  if (!status) {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_MISSED_FINISH_WORKDAY_STATE_UNAVAILABLE",
    };
  }

  const shiftSnapshot = await db.workforceShiftSnapshot.findFirst({
    where: {
      organizationId: input.organizationId,
      workdayId: workday.id,
      agentId: input.agentId,
    },
    select: {
      plannedEndAt: true,
    },
  });
  if (!shiftSnapshot || !validInstant(shiftSnapshot.plannedEndAt)) {
    return {
      outcome: "NOT_READY",
      code: "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE",
    };
  }

  const proposal = proposeWorkforceMissedFinishAction({
    asOf: input.asOf.toISOString(),
    workday: {
      status,
      scheduleSnapshot: "IMMUTABLE",
      expectedFinishAt: shiftSnapshot.plannedEndAt.toISOString(),
    },
    observation: "COMPLETE",
    timing: input.timing,
  });
  if (proposal.outcome === "DO_NOT_ACT") {
    return { outcome: "DO_NOT_ACT", proposal };
  }
  return {
    outcome: "ACTION_CANDIDATE",
    workdayId: workday.id,
    proposal,
  };
}
