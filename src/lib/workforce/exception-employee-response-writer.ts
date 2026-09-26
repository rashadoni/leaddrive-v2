import {
  createWorkforceExceptionEmployeeResponseDraft,
  type WorkforceExceptionEmployeeResponseDraft,
} from "@/lib/workforce/exception-employee-response"
import { lockWorkforceExceptionDecisionStream } from "@/lib/workforce/exception-case-writer"
import {
  requireWorkforceExceptionLinkedMutationAfterLock,
  WorkforceExceptionLinkedMutationError,
  type WorkforceExceptionLinkedMutationDb,
} from "@/lib/workforce/exception-linked-mutation"

type StoredResponse = WorkforceExceptionEmployeeResponseDraft & { id: string }

export type WorkforceExceptionEmployeeResponseWriterDb = WorkforceExceptionLinkedMutationDb & {
  workforceExceptionEmployeeResponse: {
    create: (args: { data: WorkforceExceptionEmployeeResponseDraft }) => Promise<StoredResponse>
    findFirst: (args: {
      where: { organizationId: string; agentId: string; clientResponseId: string }
      select: { id: true; organizationId: true; caseId: true; agentId: true; workdayId: true; segmentId: true; correctionRequestId: true; responseCode: true; clientResponseId: true; actorUserId: true }
    }) => Promise<StoredResponse | null>
  }
  mtmAuditLog: {
    create: (args: {
      data: {
        organizationId: string
        agentId: string
        action: string
        entity: string
        entityId: string
        metadataKind: string
        newData: Record<string, unknown>
      }
    }) => Promise<unknown>
  }
}

export type WorkforceExceptionEmployeeResponseAuthorization = (input: {
  operation: "EMPLOYEE_RESPONSE_APPEND"
  organizationId: string
  caseId: string
  agentId: string
  actorUserId: string
}) => boolean | Promise<boolean>

export class WorkforceExceptionEmployeeResponseWriterError extends Error {
  constructor(readonly code:
    | "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_NOT_AUTHORIZED"
    | "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT"
    | "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
  ) {
    super(code)
  }
}

function lockKey(draft: WorkforceExceptionEmployeeResponseDraft): string {
  return `workforce-exception-employee-response:${draft.organizationId}:${draft.agentId}:${draft.clientResponseId}`
}

function sameResponse(left: WorkforceExceptionEmployeeResponseDraft, right: WorkforceExceptionEmployeeResponseDraft): boolean {
  return left.organizationId === right.organizationId
    && left.caseId === right.caseId
    && left.agentId === right.agentId
    && left.workdayId === right.workdayId
    && left.segmentId === right.segmentId
    && left.correctionRequestId === right.correctionRequestId
    && left.responseCode === right.responseCode
    && left.clientResponseId === right.clientResponseId
    && left.actorUserId === right.actorUserId
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
}

/**
 * Persists an exact employee-owned response only after authorization. The
 * migration trigger verifies case/workday/segment/request topology at the
 * transaction boundary; this writer preserves retry safety and metadata-only
 * audit without reading raw proof or correction text.
 */
export async function appendAuthorizedWorkforceExceptionEmployeeResponse(input: {
  db: WorkforceExceptionEmployeeResponseWriterDb
  draft: WorkforceExceptionEmployeeResponseDraft
  authorize: WorkforceExceptionEmployeeResponseAuthorization
}): Promise<{ responseId: string; idempotent: boolean }> {
  const draft = createWorkforceExceptionEmployeeResponseDraft(input.draft)
  const authorized = await input.authorize({
    operation: "EMPLOYEE_RESPONSE_APPEND",
    organizationId: draft.organizationId,
    caseId: draft.caseId,
    agentId: draft.agentId,
    actorUserId: draft.actorUserId,
  })
  if (!authorized) {
    throw new WorkforceExceptionEmployeeResponseWriterError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_NOT_AUTHORIZED")
  }

  // Resolution/reopen and every linked writer share this lock. Resolve an
  // exact completed retry before the lifecycle guard so a later resolution
  // cannot turn an acknowledged response replay into a false conflict. The
  // client response id is global across the employee's cases, so its fence
  // must also be held before this read; different case locks are insufficient.
  await lockWorkforceExceptionDecisionStream(input.db, draft)
  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(draft)}))`
  const existing = await input.db.workforceExceptionEmployeeResponse.findFirst({
    where: {
      organizationId: draft.organizationId,
      agentId: draft.agentId,
      clientResponseId: draft.clientResponseId,
    },
    select: {
      id: true,
      organizationId: true,
      caseId: true,
      agentId: true,
      workdayId: true,
      segmentId: true,
      correctionRequestId: true,
      responseCode: true,
      clientResponseId: true,
      actorUserId: true,
    },
  })
  if (existing) {
    if (sameResponse(draft, existing)) return { responseId: existing.id, idempotent: true }
    throw new WorkforceExceptionEmployeeResponseWriterError(
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
    )
  }
  try {
    await requireWorkforceExceptionLinkedMutationAfterLock({
      db: input.db,
      organizationId: draft.organizationId,
      caseId: draft.caseId,
    })
  } catch (error) {
    if (error instanceof WorkforceExceptionLinkedMutationError) {
      throw new WorkforceExceptionEmployeeResponseWriterError(
        "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
      )
    }
    throw error
  }

  let created: StoredResponse
  try {
    created = await input.db.workforceExceptionEmployeeResponse.create({ data: draft })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // PostgreSQL aborts the transaction on a unique violation. Never try a
    // replay query here (it would fail with 25P02); every cooperating writer
    // already serialized and re-read above, so this is an out-of-contract
    // collision and must roll back as a controlled conflict.
    throw new WorkforceExceptionEmployeeResponseWriterError(
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
    )
  }
  await input.db.mtmAuditLog.create({
    data: {
      organizationId: draft.organizationId,
      agentId: draft.agentId,
      action: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RECORDED",
      entity: "workforce_exception_employee_response",
      entityId: created.id,
      metadataKind: "workforce_exception_employee_response",
      newData: {
        caseId: draft.caseId,
        workdayId: draft.workdayId,
        segmentLinked: draft.segmentId !== null,
        correctionRequested: draft.responseCode === "CORRECTION_REQUESTED",
      },
    },
  })
  return { responseId: created.id, idempotent: false }
}
