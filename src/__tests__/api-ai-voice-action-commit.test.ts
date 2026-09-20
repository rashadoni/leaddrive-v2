import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"

type AuthContext = {
  orgId: string
  userId: string
  role: "manager"
  email: string
  name: string
  principalType: "session"
}
type RouteHandler<C = unknown> = (
  req: NextRequest,
  auth: AuthContext,
  ctx: C,
) => Promise<Response>
type RateLimitCheck = (
  key: string,
  config: { maxRequests: number; windowMs: number },
) => boolean

const deps = vi.hoisted(() => ({
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true as const })),
  checkRateLimit: vi.fn<RateLimitCheck>(() => true),
  claim: vi.fn(),
  recover: vi.fn(),
  fail: vi.fn(),
  execute: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: <C,>(handler: RouteHandler<C>) => (req: NextRequest, ctx: C) => handler(req, {
    orgId: "org-1",
    userId: "user-1",
    role: "manager",
    email: "manager@example.com",
    name: "Manager",
    principalType: "session",
  }, ctx),
}))

vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: deps.checkVoicePilotAccess,
  // Write routes run the write gate, which wraps the pilot gate.
  checkVoiceWriteAccess: deps.checkVoicePilotAccess,
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: deps.checkRateLimit,
}))

vi.mock("@/lib/ai/voice/action-execution-claim", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/action-execution-claim")>(
    "@/lib/ai/voice/action-execution-claim",
  )
  return {
    ...actual,
    claimAiVoiceActionExecution: deps.claim,
    recoverAiVoiceActionExecutionLease: deps.recover,
    failClaimedAiVoiceActionExecution: deps.fail,
  }
})

vi.mock("@/lib/ai/voice/action-execution", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/action-execution")>(
    "@/lib/ai/voice/action-execution",
  )
  return { ...actual, executeClaimedAiVoiceAction: deps.execute }
})

import { AiVoiceActionExecutionError } from "@/lib/ai/voice/action-execution"
import { POST } from "@/app/api/v1/ai/voice/actions/[id]/commit/route"

const confirmationToken = "a".repeat(43)
const payloadHash = "b".repeat(64)
const routeContext = { params: Promise.resolve({ id: "intent-1" }) }
const activeClaim = {
  intentId: "intent-1",
  state: "executing",
  revision: 2,
  payloadHash,
  errorCode: null,
  executionLeaseToken: "11111111-1111-4111-8111-111111111111",
  executionLeaseExpiresAt: "2099-09-20T12:01:00.000Z",
  replayed: false,
  recovered: false,
} as const
const result = {
  intentId: "intent-1",
  state: "succeeded",
  actionType: "create_task",
  revision: 2,
  payloadHash,
  result: { entityType: "task", entityId: "task-1" },
  replayed: false,
} as const

function commitRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/ai/voice/actions/intent-1/commit", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function commitBody() {
  return {
    confirmationEventId: "confirmation-event-1",
    confirmationToken,
    expectedRevision: 2,
    payloadHash,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.checkVoicePilotAccess.mockResolvedValue({ ok: true })
  deps.checkRateLimit.mockReturnValue(true)
  deps.claim.mockResolvedValue(activeClaim)
  deps.recover.mockResolvedValue({
    ...activeClaim,
    executionLeaseToken: "22222222-2222-4222-8222-222222222222",
    recovered: true,
  })
  deps.execute.mockResolvedValue(result)
  deps.fail.mockResolvedValue({
    intentId: "intent-1",
    state: "failed",
    errorCode: "VALIDATION_FAILED",
    replayed: false,
  })
})

describe("AI voice action commit route", () => {
  it("does not expose commit or canonical CRM writes as model tools", () => {
    const names = voiceTools().map((tool) => tool.name)
    expect(names).not.toEqual(expect.arrayContaining([
      "commit_action",
      "execute_action",
      "create_task",
      "create_lead",
      "update_lead",
      "create_deal",
      "convert_lead_to_deal",
    ]))
  })

  it("consumes a strict browser proof and returns only the stored CRM result", async () => {
    const response = await POST(commitRequest(commitBody()), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      { intentId: "intent-1", ...commitBody() },
    )
    expect(deps.execute).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      {
        intentId: "intent-1",
        executionLeaseToken: activeClaim.executionLeaseToken,
      },
    )
    expect(body).toEqual({ success: true, data: result })
    expect(JSON.stringify(body)).not.toContain(confirmationToken)
    expect(JSON.stringify(body)).not.toContain(activeClaim.executionLeaseToken)
  })

  it("rejects bearer, cross-origin and non-strict requests before claiming", async () => {
    const bearer = await POST(commitRequest(commitBody(), {
      authorization: "Bearer model-token",
    }), routeContext)
    expect(bearer.status).toBe(403)

    const crossOrigin = await POST(commitRequest(commitBody(), {
      "sec-fetch-site": "cross-site",
    }), routeContext)
    expect(crossOrigin.status).toBe(403)

    const extraAuthority = await POST(commitRequest({
      ...commitBody(),
      organizationId: "attacker-org",
    }), routeContext)
    expect(extraAuthority.status).toBe(400)
    expect(deps.claim).not.toHaveBeenCalled()
  })

  it("enforces user, tenant and individual-action rate-limit buckets", async () => {
    const response = await POST(commitRequest(commitBody()), routeContext)
    expect(response.status).toBe(200)
    expect(deps.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      "voice:action-commit:user:org-1:user-1",
      { maxRequests: 20, windowMs: 60_000 },
    )
    expect(deps.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      "voice:action-commit:tenant:org-1",
      { maxRequests: 200, windowMs: 60_000 },
    )
    expect(deps.checkRateLimit).toHaveBeenNthCalledWith(
      3,
      "voice:action-commit:action:org-1:user-1:intent-1",
      { maxRequests: 10, windowMs: 60_000 },
    )

    deps.checkRateLimit.mockImplementation((key: string) => !key.includes(":action:"))
    const limited = await POST(commitRequest(commitBody()), routeContext)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
    expect(limited.headers.get("cache-control")).toBe("private, no-store")
    expect(deps.claim).toHaveBeenCalledTimes(1)
  })

  it("recovers only an expired claim before executing", async () => {
    deps.claim.mockResolvedValueOnce({
      ...activeClaim,
      executionLeaseExpiresAt: "2020-01-01T00:00:00.000Z",
      replayed: true,
    })
    const recovered = {
      ...activeClaim,
      executionLeaseToken: "22222222-2222-4222-8222-222222222222",
      recovered: true,
    }
    deps.recover.mockResolvedValueOnce(recovered)

    const response = await POST(commitRequest(commitBody()), routeContext)
    expect(response.status).toBe(200)
    expect(deps.recover).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      {
        intentId: "intent-1",
        expectedRevision: 2,
        payloadHash,
        expiredLeaseToken: activeClaim.executionLeaseToken,
      },
    )
    expect(deps.execute).toHaveBeenCalledWith(expect.anything(), {
      intentId: "intent-1",
      executionLeaseToken: recovered.executionLeaseToken,
    })
  })

  it("replays a terminal failure without invoking the CRM command", async () => {
    deps.claim.mockResolvedValueOnce({
      ...activeClaim,
      state: "failed",
      errorCode: "STALE_WRITE",
      replayed: true,
    })

    const response = await POST(commitRequest(commitBody()), routeContext)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      success: false,
      code: "STALE_WRITE",
      data: { intentId: "intent-1", state: "failed", replayed: true },
    })
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it("settles canonical command failures as bounded terminal failures", async () => {
    deps.execute.mockRejectedValueOnce(new CrmCommandError(
      "VALIDATION_FAILED",
      "The task is no longer valid",
      400,
    ))

    const response = await POST(commitRequest(commitBody()), routeContext)
    expect(response.status).toBe(400)
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      {
        intentId: "intent-1",
        executionLeaseToken: activeClaim.executionLeaseToken,
        errorCode: "VALIDATION_FAILED",
        safeMessage: "The task is no longer valid",
      },
    )
    expect(await response.json()).toMatchObject({
      success: false,
      code: "VALIDATION_FAILED",
      data: { state: "failed" },
    })
  })

  it("settles corrupt stored actions but keeps infrastructure failures retryable", async () => {
    deps.execute.mockRejectedValueOnce(new AiVoiceActionExecutionError(
      "INVALID_STORED_PAYLOAD",
      "The stored action is invalid",
      409,
    ))
    const terminal = await POST(commitRequest(commitBody()), routeContext)
    expect(terminal.status).toBe(409)
    expect(deps.fail).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    deps.checkVoicePilotAccess.mockResolvedValue({ ok: true })
    deps.checkRateLimit.mockReturnValue(true)
    deps.claim.mockResolvedValue(activeClaim)
    deps.execute.mockRejectedValueOnce(new Error("database unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const retryable = await POST(commitRequest(commitBody()), routeContext)
    expect(retryable.status).toBe(503)
    expect(retryable.headers.get("cache-control")).toBe("private, no-store")
    expect(await retryable.json()).toEqual({
      error: "Commit temporarily unavailable",
      code: "COMMIT_RETRY_REQUIRED",
    })
    expect(deps.fail).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      "[voice action commit execution]",
      { name: "Error" },
    )
    consoleError.mockRestore()
  })
})
