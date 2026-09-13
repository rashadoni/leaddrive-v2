import {
  readWorkforceMissedFinishCandidate,
  type WorkforceMissedFinishCandidate,
  type WorkforceMissedFinishCandidateDb,
} from "@/lib/workforce/missed-finish-candidate";

export const WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX = 50;

export type WorkforceMissedFinishCandidateBatchDb =
  WorkforceMissedFinishCandidateDb;

export type WorkforceMissedFinishCandidateBatch = {
  asOf: string;
  candidates: Array<{
    workdayId: string;
    agentId: string;
    result: WorkforceMissedFinishCandidate;
  }>;
  nextCursorWorkdayId: string | null;
  morePending: boolean;
};

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function boundedLimit(value: number | undefined): number {
  if (value == null) return WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX;
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX
  ) {
    throw new RangeError(
      `Workforce missed-finish candidate limit must be from 1 to ${WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX}`,
    );
  }
  return value;
}

/**
 * Reads a bounded, stable slice of existing open workdays for a future
 * missed-finish service. This is neither a reminder job nor an auto-close:
 * no durable cursor, lease, case, audit, notification, correction, capability
 * or workday writer is available from this database surface.
 */
export async function readWorkforceMissedFinishCandidateBatch(
  db: WorkforceMissedFinishCandidateBatchDb,
  input: {
    organizationId: string;
    asOf: Date;
    timing: {
      privateReminderAfterSeconds: number;
      reviewAfterSeconds: number;
    };
    afterWorkdayId?: string | null;
    limit?: number;
  },
): Promise<WorkforceMissedFinishCandidateBatch> {
  if (!input.organizationId.trim() || !validInstant(input.asOf)) {
    throw new RangeError("Workforce missed-finish candidate batch input is invalid");
  }
  const limit = boundedLimit(input.limit);
  const afterWorkdayId = input.afterWorkdayId?.trim() || null;
  const workdayRows = await db.mtmAgentWorkday.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ["STARTED", "PAUSED"] },
      ...(afterWorkdayId ? { id: { gt: afterWorkdayId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    select: { id: true, agentId: true },
  });
  const morePending = workdayRows.length > limit;
  const selected = workdayRows.slice(0, limit);
  const candidates: WorkforceMissedFinishCandidateBatch["candidates"] = [];

  for (const workday of selected) {
    candidates.push({
      workdayId: workday.id,
      agentId: workday.agentId,
      result: await readWorkforceMissedFinishCandidate(db, {
        organizationId: input.organizationId,
        agentId: workday.agentId,
        workdayId: workday.id,
        asOf: input.asOf,
        timing: input.timing,
      }),
    });
  }

  return {
    asOf: input.asOf.toISOString(),
    candidates,
    nextCursorWorkdayId: morePending ? selected.at(-1)?.id ?? null : null,
    morePending,
  };
}
