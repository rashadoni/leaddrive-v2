import {
  MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS,
  WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
  createWorkforceExceptionPolicyRevisionDraft,
  resolveWorkforceExceptionPolicyDraftRevision,
  type WorkforceExceptionPolicyRevisionDraft,
  type WorkforceExceptionPolicyRevisionRecord,
} from "@/lib/workforce/exception-policy-revision"

type WorkforceExceptionPolicyRevisionWriteData =
  WorkforceExceptionPolicyRevisionDraft & { revision: number }

export type WorkforceExceptionPolicyRevisionWriterDb = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => PromiseLike<unknown>
  workforceExceptionPolicyRevision: {
    findMany: (args: {
      where: { organizationId: string }
      orderBy: { revision: "asc" }
      take: number
      select: Record<keyof WorkforceExceptionPolicyRevisionRecord, true>
    }) => Promise<readonly WorkforceExceptionPolicyRevisionRecord[]>
    create: (args: {
      data: WorkforceExceptionPolicyRevisionWriteData
    }) => Promise<WorkforceExceptionPolicyRevisionRecord>
  }
}

export type WorkforceExceptionPolicyRevisionAuthorization = (input: {
  operation: "POLICY_REVISION_APPEND"
  organizationId: string
  actorUserId: string
}) => boolean | Promise<boolean>

export class WorkforceExceptionPolicyRevisionWriterError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED"
      | "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_INVALID"
      | "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED"
      | "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
    message: string = code,
  ) {
    super(message)
  }
}

const REVISION_SELECT: Record<keyof WorkforceExceptionPolicyRevisionRecord, true> = {
  id: true,
  organizationId: true,
  revision: true,
  operationId: true,
  policyVersion: true,
  definition: true,
  definitionHash: true,
  recordedByUserId: true,
  recordReasonCode: true,
  createdAt: true,
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

function revisionLockKey(organizationId: string): string {
  return `workforce-exception-policy-revision:${organizationId}`
}

function isExactReplay(
  record: WorkforceExceptionPolicyRevisionRecord,
  draft: WorkforceExceptionPolicyRevisionDraft,
): boolean {
  return record.organizationId === draft.organizationId
    && record.operationId === draft.operationId
    && record.policyVersion === draft.policyVersion
    && record.definitionHash === draft.definitionHash
    && record.recordedByUserId === draft.recordedByUserId
    && record.recordReasonCode
      === WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE
}

/**
 * Appends one acknowledgement of the exact owner-approved exception-policy
 * draft. This is a transaction-scoped, dormant persistence primitive: the
 * caller supplies an already tenant-scoped transaction and an explicit
 * organization-level authorization check. It does not activate policy,
 * update decisions, publish an endpoint or provision a tenant.
 */
export async function appendAuthorizedWorkforceExceptionPolicyRevision(input: {
  db: WorkforceExceptionPolicyRevisionWriterDb
  command: {
    organizationId: unknown
    operationId: unknown
    recordedByUserId: unknown
  }
  authorize: WorkforceExceptionPolicyRevisionAuthorization
}): Promise<{ revisionId: string; revision: number; idempotent: boolean }> {
  const draft = createWorkforceExceptionPolicyRevisionDraft(input.command)
  if (!await input.authorize({
    operation: "POLICY_REVISION_APPEND",
    organizationId: draft.organizationId,
    actorUserId: draft.recordedByUserId,
  })) {
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED",
    )
  }

  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${revisionLockKey(
    draft.organizationId,
  )}))`
  const history = await input.db.workforceExceptionPolicyRevision.findMany({
    where: { organizationId: draft.organizationId },
    orderBy: { revision: "asc" },
    take: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1,
    select: REVISION_SELECT,
  })
  const resolution = resolveWorkforceExceptionPolicyDraftRevision(history)
  if (resolution.status === "INVALID") {
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_INVALID",
      `The Workforce exception policy revision stream is invalid (${resolution.code})`,
    )
  }
  if (history.length > MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS) {
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED",
      "The Workforce exception policy revision history exceeds the reviewed bound",
    )
  }

  const existing = history.find((record) => record.operationId === draft.operationId)
  if (existing) {
    if (isExactReplay(existing, draft)) {
      return {
        revisionId: existing.id,
        revision: existing.revision,
        idempotent: true,
      }
    }
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
      "The Workforce exception policy revision operation conflicts with another actor or payload",
    )
  }
  if (history.length >= MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS) {
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED",
      "The Workforce exception policy revision history has reached the reviewed bound",
    )
  }

  const revision = history.length + 1
  let created: WorkforceExceptionPolicyRevisionRecord
  try {
    created = await input.db.workforceExceptionPolicyRevision.create({
      data: { ...draft, revision },
    })
  } catch (error) {
    // PostgreSQL aborts the transaction after a unique violation. Never query
    // again here; replay was already resolved while the transaction was sound.
    if (!isUniqueViolation(error)) throw error
    throw new WorkforceExceptionPolicyRevisionWriterError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
      "The Workforce exception policy revision stream changed outside its writer lock",
    )
  }
  return { revisionId: created.id, revision: created.revision, idempotent: false }
}
