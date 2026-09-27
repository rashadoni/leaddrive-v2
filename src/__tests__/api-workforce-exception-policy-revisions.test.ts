import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const transactionClient = vi.hoisted(() => ({
  marker: "tenant-rls-transaction",
}))
const transaction = vi.hoisted(() => vi.fn(async (
  work: (tx: typeof transactionClient) => Promise<unknown>,
) => work(transactionClient)))
const findMany = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    workforceExceptionPolicyRevision: { findMany },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionPolicyConfigurationAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/exception-policy-revision-writer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/exception-policy-revision-writer")>(
    "@/lib/workforce/exception-policy-revision-writer",
  )
  return {
    ...actual,
    appendAuthorizedWorkforceExceptionPolicyRevision: vi.fn(),
  }
})

import * as route from "@/app/api/v1/workforce/configuration/exception-policy/revisions/route"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  appendAuthorizedWorkforceExceptionPolicyRevision,
  WorkforceExceptionPolicyRevisionWriterError,
} from "@/lib/workforce/exception-policy-revision-writer"
import {
  MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS,
  WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
} from "@/lib/workforce/exception-policy-revision"
import {
  WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
} from "@/lib/workforce/exception-policy-draft"

const AUTH = {
  orgId: "org-policy",
  userId: "tenant-policy-admin",
  role: "admin",
}

type Handler = (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const get = route.GET as unknown as Handler
const post = route.POST as unknown as Handler

function getRequest(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/workforce/configuration/exception-policy/revisions${query}`,
  )
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/v1/workforce/configuration/exception-policy/revisions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

function storedRevision(revision: number) {
  return {
    id: `revision-secret-${revision}`,
    organizationId: AUTH.orgId,
    revision,
    operationId: `policy-ack-${revision}`,
    policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
    definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
    definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
    recordedByUserId: AUTH.userId,
    recordReasonCode: WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
    createdAt: new Date(`2026-09-27T00:${String(revision % 60).padStart(2, "0")}:00.000Z`),
  }
}

beforeEach(() => {
  transaction.mockReset()
  findMany.mockReset()
  vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockReset()
  transaction.mockImplementation(async (
    work: (tx: typeof transactionClient) => Promise<unknown>,
  ) => work(transactionClient))
  vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockResolvedValue({
    revisionId: "revision-secret-id",
    revision: 3,
    idempotent: false,
  })
  findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Workforce exception-policy revision API", () => {
  it("exports only session-policy GET and POST surfaces", () => {
    expect(withWorkforceSessionPolicyConfigurationAuth).toHaveBeenCalledTimes(2)
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"])
  })

  it("returns a tenant-scoped empty draft receipt without a transaction or write", async () => {
    const response = await get(getRequest(), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const payload = await response.json()
    expect(payload).toEqual({
      state: "NOT_RECORDED",
    })
    expect(Object.keys(payload)).toEqual(["state"])
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: AUTH.orgId },
      orderBy: { revision: "asc" },
      take: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1,
      select: {
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
      },
    })
    expect(transaction).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionPolicyRevision).not.toHaveBeenCalled()
  })

  it("returns only a draft receipt and latest revision for a valid complete stream", async () => {
    findMany.mockResolvedValue([storedRevision(1), storedRevision(2)])

    const response = await get(getRequest(), AUTH)

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      state: "RECORDED_DRAFT",
      revision: 2,
    })
    expect(Object.keys(payload).sort()).toEqual(["revision", "state"])
    expect(JSON.stringify(payload)).not.toMatch(
      /revision-secret|policy-ack|org-policy|tenant-policy-admin|recommended-v1|definition|hash|reason|created|active|current|effective/iu,
    )
    expect(transaction).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionPolicyRevision).not.toHaveBeenCalled()
  })

  it("ignores caller selectors and always reads the authenticated tenant stream", async () => {
    findMany.mockResolvedValue([storedRevision(1)])

    const response = await get(getRequest(
      "?organizationId=other-org&revision=99&active=true",
    ), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: "RECORDED_DRAFT",
      revision: 1,
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
    }))
  })

  it("maps every malformed or overbound stream to the same generic conflict", async () => {
    const invalidHistories = [
      [storedRevision(1), storedRevision(3)],
      [storedRevision(2), storedRevision(1)],
      [storedRevision(1), { ...storedRevision(2), organizationId: "other-org" }],
      [{ ...storedRevision(1), policyVersion: "future-policy" }],
      [{ ...storedRevision(1), definitionHash: "0".repeat(64) }],
      [{ ...storedRevision(1), definition: {} }],
      Array.from(
        { length: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1 },
        (_, index) => storedRevision(index + 1),
      ),
    ]

    for (const history of invalidHistories) {
      findMany.mockResolvedValueOnce(history)
      const response = await get(getRequest(), AUTH)

      expect(response.status).toBe(409)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      await expect(response.json()).resolves.toEqual({
        error: "The Workforce exception-policy draft receipt is unavailable.",
        code: "WORKFORCE_EXCEPTION_POLICY_REVISION_RECEIPT_UNAVAILABLE",
      })
    }
    expect(transaction).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionPolicyRevision).not.toHaveBeenCalled()
  })

  it("returns a generic read failure without leaking storage details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    findMany.mockRejectedValue(new Error("secret tenant query detail"))

    const response = await get(getRequest(), AUTH)

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const payload = await response.json()
    expect(payload).toEqual({
      error: "Failed to read Workforce exception-policy draft receipt.",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_RECEIPT_READ_UNAVAILABLE",
    })
    expect(JSON.stringify(payload)).not.toContain("secret")
    expect(log).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "configuration-exception-policy-revision-read" },
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret")
  })

  it("derives tenant and actor from the session and appends inside the tenant transaction", async () => {
    const response = await post(postRequest({ operationId: "policy-ack-001" }), AUTH)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({
      success: true,
      idempotent: false,
      data: { revision: 3 },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(appendAuthorizedWorkforceExceptionPolicyRevision).toHaveBeenCalledWith({
      db: transactionClient,
      command: {
        organizationId: AUTH.orgId,
        operationId: "policy-ack-001",
        recordedByUserId: AUTH.userId,
      },
      authorize: expect.any(Function),
    })

    const [{ authorize }] = vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mock.calls[0]!
    expect(await authorize({
      operation: "POLICY_REVISION_APPEND",
      organizationId: AUTH.orgId,
      actorUserId: AUTH.userId,
    })).toBe(true)
    expect(await authorize({
      operation: "POLICY_REVISION_APPEND",
      organizationId: "other-org",
      actorUserId: AUTH.userId,
    })).toBe(false)
    expect(await authorize({
      operation: "POLICY_REVISION_APPEND",
      organizationId: AUTH.orgId,
      actorUserId: "other-user",
    })).toBe(false)
  })

  it("returns the original public receipt with 200 for an exact replay", async () => {
    vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockResolvedValue({
      revisionId: "revision-secret-id",
      revision: 2,
      idempotent: true,
    })

    const response = await post(postRequest({ operationId: "policy-ack-replay" }), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      idempotent: true,
      data: { revision: 2 },
    })
  })

  it("rejects malformed and caller-owned policy fields before opening a transaction", async () => {
    for (const body of [
      {},
      { operationId: " contains-spaces " },
      { operationId: "policy-ack-001", organizationId: "other-org" },
      { operationId: "policy-ack-001", recordedByUserId: "other-user" },
      { operationId: "policy-ack-001", policyVersion: "recommended-v1" },
      { operationId: "policy-ack-001", definition: {} },
      { operationId: "policy-ack-001", definitionHash: "a".repeat(64) },
      { operationId: "policy-ack-001", recordReasonCode: "OTHER" },
      { operationId: "policy-ack-001", revision: 99 },
      { operationId: "policy-ack-001", effectiveFrom: "2026-10-01" },
    ]) {
      const response = await post(postRequest(body), AUTH)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      await expect(response.json()).resolves.toEqual({
        error: "Invalid Workforce exception-policy revision request.",
        code: "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID",
      })
    }
    expect(transaction).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionPolicyRevision).not.toHaveBeenCalled()
  })

  it.each([
    "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_INVALID",
    "WORKFORCE_EXCEPTION_POLICY_REVISION_HISTORY_LIMIT_EXCEEDED",
    "WORKFORCE_EXCEPTION_POLICY_REVISION_WRITE_CONFLICT",
  ] as const)("maps %s to one controlled conflict", async (code) => {
    vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockRejectedValue(
      new WorkforceExceptionPolicyRevisionWriterError(code),
    )

    const response = await post(postRequest({ operationId: "policy-ack-conflict" }), AUTH)

    expect(response.status).toBe(409)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      error: "The Workforce exception-policy revision cannot be recorded in the current stream.",
      code,
    })
  })

  it("fails closed when the writer rejects its transaction authorization", async () => {
    vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockRejectedValue(
      new WorkforceExceptionPolicyRevisionWriterError(
        "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED",
      ),
    )

    const response = await post(postRequest({ operationId: "policy-ack-denied" }), AUTH)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Workforce policy configuration access is required.",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED",
    })
  })

  it("returns a generic no-store failure without leaking storage details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockRejectedValue(
      new Error("secret RLS/FK detail"),
    )

    const response = await post(postRequest({ operationId: "policy-ack-storage" }), AUTH)

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const payload = await response.json()
    expect(payload).toEqual({
      error: "Failed to record Workforce exception-policy revision.",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_UNAVAILABLE",
    })
    expect(JSON.stringify(payload)).not.toContain("secret")
    expect(log).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "configuration-exception-policy-revision-write" },
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret")
  })
})
