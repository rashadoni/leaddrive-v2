import {
  createWorkforceExceptionCaseDraft,
  createDraftPolicyWorkforceExceptionDecisionDraft,
  createWorkforceExceptionDecisionDraft,
  type WorkforceExceptionCaseDraft,
  type WorkforceExceptionDecisionDraft,
} from "@/lib/workforce/exception-case-ledger"

type WorkforceExceptionCaseWriteData = Omit<WorkforceExceptionCaseDraft, "links"> & WorkforceExceptionCaseDraft["links"]
type StoredCase = Omit<WorkforceExceptionCaseWriteData, "expectedWorkDate"> & { id: string; expectedWorkDate: string | Date | null }
type StoredDecision = WorkforceExceptionDecisionDraft & { id: string }

/** Smallest transaction facade needed to append an immutable case. Keeping it
 * separate from decisions lets a detector use an actual Prisma transaction
 * without pretending it owns the later case-lookup/decision delegates. */
export type WorkforceExceptionCasePersistenceDb = {
  $executeRaw: (query: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>
  workforceExceptionCase: {
    create: (args: { data: WorkforceExceptionCaseWriteData }) => Promise<StoredCase>
    findFirst: (args: {
      where: { organizationId: string; deduplicationKey: string }
      select: { id: true; organizationId: true; agentId: true; kind: true; detectorVersion: true; deduplicationKey: true; workdayId: true; workdayEventId: true; evidenceId: true; segmentId: true; expectedWorkDate: true }
    }) => Promise<StoredCase | null>
  }
  mtmAuditLog: {
    create: (args: {
      data: {
        organizationId: string
        agentId: null
        action: string
        entity: string
        entityId: string
        metadataKind: string
        newData: Record<string, unknown>
        ipAddress: null
        userAgent: null
      }
    }) => Promise<unknown>
  }
}

export type WorkforceExceptionCaseWriterDb = WorkforceExceptionCasePersistenceDb & {
  workforceExceptionDecision: {
    create: (args: { data: WorkforceExceptionDecisionDraft }) => Promise<StoredDecision>
    findFirst: (args: {
      where: { organizationId: string; operationId: string }
      select: { id: true; organizationId: true; caseId: true; operationId: true; decisionCode: true; reason: true; actorUserId: true }
    }) => Promise<StoredDecision | null>
    findMany: (args: {
      where: { organizationId: string; caseId: string }
      orderBy: readonly [{ createdAt: "asc" }, { id: "asc" }]
      select: { decisionCode: true }
    }) => Promise<readonly { decisionCode: string }[]>
  }
  workforceExceptionCaseLookup: {
    findFirst: (args: { where: { id: string; organizationId: string }; select: { id: true } }) => Promise<{ id: string } | null>
  }
}

export type WorkforceExceptionCaseAuthorization = (input:
  | {
    operation: "CASE_CREATE"
    organizationId: string
    agentId: string
  }
  | {
    operation: "DECISION_APPEND"
    organizationId: string
    caseId: string
    actorUserId: string
  },
) => boolean | Promise<boolean>

export class WorkforceExceptionCaseWriterError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED"
      | "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT"
      | "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT"
      | "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
    message: string = code,
  ) {
    super(message)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

async function requireAuthorization(
  authorize: WorkforceExceptionCaseAuthorization,
  input: Parameters<WorkforceExceptionCaseAuthorization>[0],
): Promise<void> {
  if (!await authorize(input)) {
    throw new WorkforceExceptionCaseWriterError("WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED")
  }
}

function caseLockKey(draft: WorkforceExceptionCaseDraft): string {
  return `workforce-exception-case:${draft.organizationId}:${draft.deduplicationKey}`
}

function decisionLockKey(draft: WorkforceExceptionDecisionDraft): string {
  return `workforce-exception-decision:${draft.organizationId}:${draft.caseId}`
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
    && left.links.expectedWorkDate === right.links.expectedWorkDate
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
      expectedWorkDate: record.expectedWorkDate instanceof Date
        ? record.expectedWorkDate.toISOString().slice(0, 10)
        : record.expectedWorkDate,
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
 * import, detector, endpoint or lifecycle transition: its caller supplies a
 * tenant-scoped transaction client and an explicit C6 authorization check.
 * The database migration is still the final tenant/link invariant and is not
 * applied by this source slice.
 */
export async function persistAuthorizedWorkforceExceptionCase(input: {
  db: WorkforceExceptionCasePersistenceDb
  draft: WorkforceExceptionCaseDraft
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<{ caseId: string; idempotent: boolean }> {
  const canonical = canonicalCaseDraft(input.draft)
  await requireAuthorization(input.authorize, {
    operation: "CASE_CREATE",
    organizationId: canonical.organizationId,
    agentId: canonical.agentId,
  })
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${caseLockKey(canonical)}))`
  // Resolve a retry while the transaction is still healthy. Catching P2002
  // and then querying is invalid in PostgreSQL: the unique violation aborts
  // the interactive transaction and every later statement fails with 25P02.
  const existing = await input.db.workforceExceptionCase.findFirst({
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
      expectedWorkDate: true,
    },
  })
  if (existing) {
    if (sameCase(caseDraftFromStored(existing), canonical)) return { caseId: existing.id, idempotent: true }
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_CASE_WRITE_CONFLICT",
      "The Workforce exception-case deduplication key conflicts with a different immutable subject",
    )
  }
  const created = await input.db.workforceExceptionCase.create({ data: caseWriteData(canonical) })
  await input.db.mtmAuditLog.create({
    data: {
      organizationId: canonical.organizationId,
      agentId: null,
      action: "WORKFORCE_EXCEPTION_CASE_RECORDED",
      entity: "workforce_exception_case",
      entityId: created.id,
      metadataKind: "workforce_exception_lifecycle",
      newData: {
        deduplicationKey: canonical.deduplicationKey,
        kind: canonical.kind,
        detectorVersion: canonical.detectorVersion,
      },
      ipAddress: null,
      userAgent: null,
    },
  })
  return { caseId: created.id, idempotent: false }
}

/**
 * Appends one raw-proof-free human decision envelope. A decision code does not
 * close, escalate, pay, discipline or mutate a case in this foundation; those
 * semantics remain unavailable until a tenant-approved C6 lifecycle is wired.
 */
export async function appendAuthorizedWorkforceExceptionDecision(input: {
  db: WorkforceExceptionCaseWriterDb
  draft: WorkforceExceptionDecisionDraft
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<{ decisionId: string; idempotent: boolean }> {
  const canonical = canonicalDecisionDraft(input.draft)
  await requireAuthorization(input.authorize, {
    operation: "DECISION_APPEND",
    organizationId: canonical.organizationId,
    caseId: canonical.caseId,
    actorUserId: canonical.actorUserId,
  })
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${decisionLockKey(canonical)}))`
  const exceptionCase = await input.db.workforceExceptionCaseLookup.findFirst({
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
    const created = await input.db.workforceExceptionDecision.create({ data: canonical })
    await input.db.mtmAuditLog.create({
      data: {
        organizationId: canonical.organizationId,
        agentId: null,
        action: "WORKFORCE_EXCEPTION_DECISION_RECORDED",
        entity: "workforce_exception_decision",
        entityId: created.id,
        metadataKind: "workforce_exception_lifecycle",
        newData: {
          caseId: canonical.caseId,
          operationId: canonical.operationId,
          decisionCode: canonical.decisionCode,
        },
        ipAddress: null,
        userAgent: null,
      },
    })
    return { decisionId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await input.db.workforceExceptionDecision.findFirst({
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

/**
 * Appends a reviewed C6 decision only after the per-case advisory lock has
 * made the full immutable prior stream stable. The generic writer above stays
 * available for inactive import/reconciliation foundations; human exception
 * resolution must use this policy-aware path so two concurrent reviewers
 * cannot both validate incompatible lifecycle transitions from a stale read.
 */
export async function appendAuthorizedPolicyWorkforceExceptionDecision(input: {
  db: WorkforceExceptionCaseWriterDb
  draft: WorkforceExceptionDecisionDraft
  authorize: WorkforceExceptionCaseAuthorization
}): Promise<{ decisionId: string; idempotent: boolean }> {
  const basic = canonicalDecisionDraft(input.draft)
  await requireAuthorization(input.authorize, {
    operation: "DECISION_APPEND",
    organizationId: basic.organizationId,
    caseId: basic.caseId,
    actorUserId: basic.actorUserId,
  })
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${decisionLockKey(basic)}))`
  const exceptionCase = await input.db.workforceExceptionCaseLookup.findFirst({
    where: { id: basic.caseId, organizationId: basic.organizationId },
    select: { id: true },
  })
  if (!exceptionCase) {
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_DECISION_CASE_NOT_FOUND",
      "The Workforce exception case is unavailable in this tenant",
    )
  }

  // Check a replay before deriving the next stage: a retried completed
  // resolution must be idempotent rather than being interpreted as a second
  // invalid post-resolution transition.
  const existing = await input.db.workforceExceptionDecision.findFirst({
    where: { organizationId: basic.organizationId, operationId: basic.operationId },
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
  if (existing) {
    if (sameDecision(existing, basic)) return { decisionId: existing.id, idempotent: true }
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT",
      "The Workforce exception decision operation conflicts with a different immutable action",
    )
  }

  const prior = await input.db.workforceExceptionDecision.findMany({
    where: { organizationId: basic.organizationId, caseId: basic.caseId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { decisionCode: true },
  })
  const canonical = createDraftPolicyWorkforceExceptionDecisionDraft({
    ...basic,
    priorDecisionCodes: prior.map((decision) => decision.decisionCode),
  })
  try {
    const created = await input.db.workforceExceptionDecision.create({ data: canonical })
    await input.db.mtmAuditLog.create({
      data: {
        organizationId: canonical.organizationId,
        agentId: null,
        action: "WORKFORCE_EXCEPTION_DECISION_RECORDED",
        entity: "workforce_exception_decision",
        entityId: created.id,
        metadataKind: "workforce_exception_lifecycle",
        newData: {
          caseId: canonical.caseId,
          operationId: canonical.operationId,
          decisionCode: canonical.decisionCode,
          policyMode: "REVIEWED_V1",
        },
        ipAddress: null,
        userAgent: null,
      },
    })
    return { decisionId: created.id, idempotent: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const replay = await input.db.workforceExceptionDecision.findFirst({
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
    if (replay && sameDecision(replay, canonical)) return { decisionId: replay.id, idempotent: true }
    throw new WorkforceExceptionCaseWriterError(
      "WORKFORCE_EXCEPTION_DECISION_WRITE_CONFLICT",
      "The Workforce exception decision operation conflicts with a different immutable action",
    )
  }
}
