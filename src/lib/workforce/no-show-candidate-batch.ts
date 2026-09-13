import { isDateKey } from "@/lib/mtm/mobile-week";
import {
  readWorkforceNoShowCandidate,
  type WorkforceNoShowCandidate,
  type WorkforceNoShowCandidateDb,
} from "@/lib/workforce/no-show-candidate";

export const WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX = 50;

export type WorkforceNoShowCandidateBatchDb = WorkforceNoShowCandidateDb;

export type WorkforceNoShowCandidateBatch = {
  workDate: string;
  asOf: string;
  candidates: Array<{
    agentId: string;
    result: WorkforceNoShowCandidate;
  }>;
  nextCursorAgentId: string | null;
  morePending: boolean;
};

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function boundedLimit(value: number | undefined): number {
  if (value == null) return WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX;
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX
  ) {
    throw new RangeError(
      `Workforce no-show candidate limit must be from 1 to ${WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX}`,
    );
  }
  return value;
}

/**
 * Reads at most one bounded organization slice for a future no-show worker.
 * It never creates or changes a workday, exception, audit, lease, cursor,
 * notification or tenant capability. The returned cursor is only in-memory
 * continuation metadata; an operational scheduler needs its own durable,
 * leased and observed cursor contract before it can act on any result.
 */
export async function readWorkforceNoShowCandidateBatch(
  db: WorkforceNoShowCandidateBatchDb,
  input: {
    organizationId: string;
    workDate: string;
    asOf: Date;
    afterAgentId?: string | null;
    limit?: number;
  },
): Promise<WorkforceNoShowCandidateBatch> {
  if (
    !input.organizationId.trim()
    || !isDateKey(input.workDate)
    || !validInstant(input.asOf)
  ) {
    throw new RangeError("Workforce no-show candidate batch input is invalid");
  }
  const limit = boundedLimit(input.limit);
  const afterAgentId = input.afterAgentId?.trim() || null;
  const agentRows = await db.mtmAgent.findMany({
    where: {
      organizationId: input.organizationId,
      ...(afterAgentId ? { id: { gt: afterAgentId } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    select: { id: true },
  });
  const morePending = agentRows.length > limit;
  const selected = agentRows.slice(0, limit);
  const candidates: WorkforceNoShowCandidateBatch["candidates"] = [];

  // Keep reads sequential and small on the Contabo host. More importantly,
  // one candidate's historical configuration must never be shared with a
  // different employee through an accidental promise/result reuse.
  for (const agent of selected) {
    candidates.push({
      agentId: agent.id,
      result: await readWorkforceNoShowCandidate(db, {
        organizationId: input.organizationId,
        agentId: agent.id,
        workDate: input.workDate,
        asOf: input.asOf,
      }),
    });
  }

  return {
    workDate: input.workDate,
    asOf: input.asOf.toISOString(),
    candidates,
    nextCursorAgentId: morePending ? selected.at(-1)?.id ?? null : null,
    morePending,
  };
}
