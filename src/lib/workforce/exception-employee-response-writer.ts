import {
  createWorkforceExceptionEmployeeResponseDraft,
  type WorkforceExceptionEmployeeResponseDraft,
} from "@/lib/workforce/exception-employee-response"

type StoredResponse = WorkforceExceptionEmployeeResponseDraft & { id: string }

export type WorkforceExceptionEmployeeResponseWriterDb = {
  $executeRaw: (query: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>
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
    | "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
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

  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(draft)}))`
  try {
    const created = await input.db.workforceExceptionEmployeeResponse.create({ data: draft })
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
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
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
    if (!existing || !sameResponse(draft, existing)) {
      throw new WorkforceExceptionEmployeeResponseWriterError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT")
    }
    return { responseId: existing.id, idempotent: true }
  }
}
