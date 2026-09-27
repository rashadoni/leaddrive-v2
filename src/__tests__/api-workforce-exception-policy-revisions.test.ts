import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const transactionClient = vi.hoisted(() => ({
  marker: "tenant-rls-transaction",
}))
const transaction = vi.hoisted(() => vi.fn(async (
  work: (tx: typeof transactionClient) => Promise<unknown>,
) => work(transactionClient)))

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transaction },
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

const AUTH = {
  orgId: "org-policy",
  userId: "tenant-policy-admin",
  role: "admin",
}

type Handler = (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const post = route.POST as unknown as Handler

function request(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/v1/workforce/configuration/exception-policy/revisions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  transaction.mockReset()
  vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockReset()
  transaction.mockImplementation(async (
    work: (tx: typeof transactionClient) => Promise<unknown>,
  ) => work(transactionClient))
  vi.mocked(appendAuthorizedWorkforceExceptionPolicyRevision).mockResolvedValue({
    revisionId: "revision-secret-id",
    revision: 3,
    idempotent: false,
  })
})

describe("Workforce exception-policy revision API", () => {
  it("exports only a session-policy POST surface", () => {
    expect(withWorkforceSessionPolicyConfigurationAuth).toHaveBeenCalledTimes(1)
    expect(Object.keys(route).sort()).toEqual(["POST"])
  })

  it("derives tenant and actor from the session and appends inside the tenant transaction", async () => {
    const response = await post(request({ operationId: "policy-ack-001" }), AUTH)

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

    const response = await post(request({ operationId: "policy-ack-replay" }), AUTH)

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
      const response = await post(request(body), AUTH)
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

    const response = await post(request({ operationId: "policy-ack-conflict" }), AUTH)

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

    const response = await post(request({ operationId: "policy-ack-denied" }), AUTH)

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

    const response = await post(request({ operationId: "policy-ack-storage" }), AUTH)

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
    log.mockRestore()
  })
})
