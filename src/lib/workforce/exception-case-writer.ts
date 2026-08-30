import {
  createWorkforceExceptionCaseDraft,
  createWorkforceExceptionDecisionDraft,
  type WorkforceExceptionCaseDraft,
  type WorkforceExceptionDecisionDraft,
} from "@/lib/workforce/exception-case-ledger"

type WorkforceExceptionCaseWriteData = Omit<WorkforceExceptionCaseDraft, "links"> & WorkforceExceptionCaseDraft["links"]
type StoredCase = WorkforceExceptionCaseWriteData & { id: string }
type StoredDecision = WorkforceExceptionDecisionDraft & { id: string }

type WorkforceExceptionCaseWriterDb = {
  workforceExceptionCase: {
    create: (args: { data: WorkforceExceptionCaseWriteData }) => Promise<StoredCase>
    findFirst: (args: {
      where: { organizationId: string; deduplicationKey: string }
      select: { id: true; organizationId: true; agentId: true; kind: true; detectorVersion: true; deduplicationKey: true; workdayId: true; workdayEventId: true; evidenceId: true; segmentId: true }
    }) => Promise<StoredCase | null>
  }
  workforceExceptionDecision: {
    create: (args: { data: WorkforceExceptionDecisionDraft }) => Promise<StoredDecision>
    findFirst: (args: {
      where: { organizationId: string; operationId: string }
      select: { id: true; organizationId: true; caseId: true; operationId: true; decisionCode: true; reason: true; actorUserId: true }
    }) => Promise<StoredDecision | null>
  }
  workforceExceptionCaseLookup: {
    findFirst: (args: { where: { id: string; organizationId: string }; select: { id: true } }) => Promise<{ id: string } | null>
  }
}

export class WorkforceExceptionCaseWriterError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT"
      | "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT"
      | "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
    message = code,
  ) {
    super(message)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

function sameCase(left: WorkforceExceptionCaseDraft, right: WorkforceExceptionCaseDraft): boolean {
  return left.organizationId === right.organizationId
    && left.agentId === right.agentId
    && left.kind === right.kind
    && left.detectorVersion === right.detectorVersion
    && left.deduplicationKey === right.deduplicationKey
    && left.links.workdayId === right.links.workdayId
    && left.links.workdayEventId === right.links.workdayEventId
    && left.links.evidenceId === right.links.evidenceId
    && left.links.segmentId === right.links.segmentId
}

function caseWriteData(draft: WorkforceExceptionCaseDraft): WorkforceExceptionCaseWriteData {
  return {
    organizationId: draft.organizationId,
    agentId: draft.agentId,
    kind: draft.kind,
    detectorVersion: draft.detectorVersion,
    deduplicationKey: draft.deduplicationKey,
    ...draft.links,
  }
}

function caseDraftFromStored(record: StoredCase): WorkforceExceptionCaseDraft {
  return {
    organizationId: record.organizationId,
    agentId: record.agentId,
    kind: record.kind,
    detectorVersion: record.detectorVersion,
    deduplicationKey: record.deduplicationKey,
    links: {
      workdayId: record.workdayId,
      workdayEventId: record.workdayEventId,
      evidenceId: record.evidenceId,
      segmentId: record.segmentId,
    },
  }
}

function sameDecision(left: WorkforceExceptionDecisionDraft, right: WorkforceExceptionDecisionDraft): boolean {
  return left.organizationId === right.organizationId
    && left.caseId === right.caseId
    && left.operationId === right.operationId
    && left.decisionCode === right.decisionCode
    && left.reason === right.reason
    && left.actorUserId === right.actorUserId
}

function canonicalCaseDraft(draft: WorkforceExceptionCaseDraft): WorkforceExceptionCaseDraft {
  return createWorkforceExceptionCaseDraft({
    organizationId: draft.organizationId,
    agentId: draft.agentId,
    kind: draft.kind,
    detectorVersion: draft.detectorVersion,
    links: draft.links,
  })
}

function canonicalDecisionDraft(draft: WorkforceExceptionDecisionDraft): WorkforceExceptionDecisionDraft {
  return createWorkforceExceptionDecisionDraft({
    organizationId: draft.organizationId,
    caseId: draft.caseId,
    operationId: draft.operationId,
    decisionCode: draft.decisionCode,
    reason: draft.reason,
    actorUserId: draft.actorUserId,
  })
}

/**
 * A transaction-scoped persistence primitive. It deliberately has no Prisma
 * import, permission check, detector, endpoint or lifecycle transition: its
 * caller must be an already-authorized C6 service. The database migration is
 * still the final tenant/link invariant and is not applied by this source
 * slice.
 */
export async function persistWorkforceExceptionCase(
  db: WorkforceExceptionCaseWriterDb,
  draft: WorkforceExceptionCaseDraft,
): Promise<{ caseId: string; idempotent: boolean }> {
  const canonical = canonicalCaseDraft(draft)
  try {
    const created = await db.workforceExceptionCase.create({ data: caseWriteData(canonical) })
    return { caseId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await db.workforceExceptionCase.findFirst({
      where: { organizationId: canonical.organizationId, deduplicationKey: canonical.deduplicationKey },
      select: {
        id: true,
        organizationId: true,
        agentId: true,
        kind: true,
        detectorVersion: true,
        deduplicationKey: true,
        workdayId: true,
        workdayEventId: true,
        evidenceId: true,
        segmentId: true,
      },
    })
    if (existing && sameCase(caseDraftFromStored(existing), canonical)) return { caseId: existing.id, idempotent: true }
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT",
      "The Workforce exception-case deduplication key conflicts with a different immutable subject",
    )
  }
}

/**
 * Appends one raw-proof-free human decision envelope. A decision code does not
 * close, escalate, pay, discipline or mutate a case in this foundation; those
 * semantics remain unavailable until C6 taxonomy and C7 authorization exist.
 */
export async function appendWorkforceExceptionDecision(
  db: WorkforceExceptionCaseWriterDb,
  draft: WorkforceExceptionDecisionDraft,
): Promise<{ decisionId: string; idempotent: boolean }> {
  const canonical = canonicalDecisionDraft(draft)
  const exceptionCase = await db.workforceExceptionCaseLookup.findFirst({
    where: { id: canonical.caseId, organizationId: canonical.organizationId },
    select: { id: true },
  })
  if (!exceptionCase) {
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
      "The Workforce exception case is unavailable in this tenant",
    )
  }
  try {
    const created = await db.workforceExceptionDecision.create({ data: canonical })
    return { decisionId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await db.workforceExceptionDecision.findFirst({
      where: { organizationId: canonical.organizationId, operationId: canonical.operationId },
      select: {
        id: true,
        organizationId: true,
        caseId: true,
        operationId: true,
        decisionCode: true,
        reason: true,
        actorUserId: true,
      },
    })
    if (existing && sameDecision(existing, canonical)) return { decisionId: existing.id, idempotent: true }
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT",
      "The Workforce exception decision operation conflicts with a different immutable action",
    )
  }
}
