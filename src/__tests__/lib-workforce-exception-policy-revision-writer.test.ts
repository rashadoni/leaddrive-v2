import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS,
  WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
  createWorkforceExceptionPolicyRevisionDraft,
  type WorkforceExceptionPolicyRevisionRecord,
} from "@/lib/workforce/exception-policy-revision"
import {
  appendAuthorizedWorkforceExceptionPolicyRevision,
  WorkforceExceptionPolicyRevisionWriterError,
} from "@/lib/workforce/exception-policy-revision-writer"
import {
  WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
} from "@/lib/workforce/exception-policy-draft"

const command = {
  organizationId: "org-policy-proof",
  operationId: "policy-revision-operation-1",
  recordedByUserId: "user-policy-owner",
}

function storedRevision(
  revision: number,
  overrides: Partial<WorkforceExceptionPolicyRevisionRecord> = {},
): WorkforceExceptionPolicyRevisionRecord {
  return {
    id: `policy-revision-${revision}`,
    organizationId: command.organizationId,
    revision,
    operationId: `policy-revision-operation-${revision}`,
    policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
    definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
    definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
    recordedByUserId: command.recordedByUserId,
    recordReasonCode: WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
    createdAt: new Date(Date.UTC(2026, 8, 27, 5, 0, revision)),
    ...overrides,
  }
}

const db = {
  $executeRaw: vi.fn(),
  workforceExceptionPolicyRevision: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}
const allow = vi.fn().mockResolvedValue(true)

beforeEach(() => {
  vi.clearAllMocks()
  db.$executeRaw.mockResolvedValue(undefined)
  db.workforceExceptionPolicyRevision.findMany.mockResolvedValue([])
})

describe("Workforce exception policy revision writer", () => {
  it("pins every server-owned field and rejects malformed caller identifiers", () => {
    expect(createWorkforceExceptionPolicyRevisionDraft(command)).toEqual({
      ...command,
      policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
      definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
      definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
      recordReasonCode: WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
    })

    for (const malformed of [
      { ...command, organizationId: " " },
      { ...command, operationId: "contains whitespace" },
      { ...command, operationId: `x${"y".repeat(100)}` },
      { ...command, recordedByUserId: "user\nother" },
    ]) {
      expect(() => createWorkforceExceptionPolicyRevisionDraft(malformed))
        .toThrowError(expect.objectContaining({
          code: "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID",
        }))
    }
  })

  it("authorizes before the first lock or database call", async () => {
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED",
    })

    expect(db.$executeRaw).not.toHaveBeenCalled()
    expect(db.workforceExceptionPolicyRevision.findMany).not.toHaveBeenCalled()
    expect(db.workforceExceptionPolicyRevision.create).not.toHaveBeenCalled()
  })

  it("appends the first pinned draft under the organization stream lock", async () => {
    db.workforceExceptionPolicyRevision.create.mockResolvedValueOnce(storedRevision(1))

    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: allow,
    })).resolves.toEqual({
      revisionId: "policy-revision-1",
      revision: 1,
      idempotent: false,
    })

    expect(allow).toHaveBeenCalledWith({
      operation: "POLICY_REVISION_APPEND",
      organizationId: command.organizationId,
      actorUserId: command.recordedByUserId,
    })
    expect(db.$executeRaw.mock.calls[0]?.[1]).toBe(
      `workforce-exception-policy-revision:${command.organizationId}`,
    )
    expect(db.workforceExceptionPolicyRevision.findMany).toHaveBeenCalledWith({
      where: { organizationId: command.organizationId },
      orderBy: { revision: "asc" },
      take: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1,
      select: expect.objectContaining({
        definition: true,
        definitionHash: true,
        recordedByUserId: true,
      }),
    })
    expect(db.workforceExceptionPolicyRevision.create).toHaveBeenCalledWith({
      data: {
        ...createWorkforceExceptionPolicyRevisionDraft(command),
        revision: 1,
      },
    })
  })

  it("allocates a contiguous revision and returns only an exact replay", async () => {
    const first = storedRevision(1)
    const secondCommand = { ...command, operationId: "policy-revision-operation-2" }
    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce([first])
    db.workforceExceptionPolicyRevision.create.mockResolvedValueOnce(storedRevision(2))

    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command: secondCommand,
      authorize: allow,
    })).resolves.toEqual({
      revisionId: "policy-revision-2",
      revision: 2,
      idempotent: false,
    })
    expect(db.workforceExceptionPolicyRevision.create).toHaveBeenLastCalledWith({
      data: {
        ...createWorkforceExceptionPolicyRevisionDraft(secondCommand),
        revision: 2,
      },
    })

    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce([first])
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: allow,
    })).resolves.toEqual({
      revisionId: first.id,
      revision: 1,
      idempotent: true,
    })
    expect(db.workforceExceptionPolicyRevision.create).toHaveBeenCalledTimes(1)

    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce([first])
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command: { ...command, recordedByUserId: "user-policy-other" },
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
    })
    expect(db.workforceExceptionPolicyRevision.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["gapped", [storedRevision(2)]],
    ["unsupported", [storedRevision(1, { definitionHash: "0".repeat(64) })]],
  ])("fails closed for a %s existing stream", async (_label, history) => {
    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce(history)

    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command: { ...command, operationId: "policy-revision-new" },
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_INVALID",
    })
    expect(db.workforceExceptionPolicyRevision.create).not.toHaveBeenCalled()
  })

  it("permits replay at the 64-row bound but refuses a new revision or overflow", async () => {
    const fullHistory = Array.from(
      { length: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS },
      (_, index) => storedRevision(index + 1),
    )
    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce(fullHistory)
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: allow,
    })).resolves.toMatchObject({ revision: 1, idempotent: true })

    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce(fullHistory)
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command: { ...command, operationId: "policy-revision-over-capacity" },
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED",
    })

    db.workforceExceptionPolicyRevision.findMany.mockResolvedValueOnce([
      ...fullHistory,
      storedRevision(MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1),
    ])
    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED",
    })
    expect(db.workforceExceptionPolicyRevision.create).not.toHaveBeenCalled()
  })

  it("maps a residual unique race without querying the aborted transaction", async () => {
    db.workforceExceptionPolicyRevision.create.mockRejectedValueOnce({ code: "P2002" })

    await expect(appendAuthorizedWorkforceExceptionPolicyRevision({
      db,
      command,
      authorize: allow,
    })).rejects.toMatchObject<Partial<WorkforceExceptionPolicyRevisionWriterError>>({
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
    })
    expect(db.workforceExceptionPolicyRevision.findMany).toHaveBeenCalledTimes(1)
    expect(db.workforceExceptionPolicyRevision.create).toHaveBeenCalledTimes(1)
  })
})
