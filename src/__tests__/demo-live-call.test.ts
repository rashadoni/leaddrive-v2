/**
 * The one real AI call a prospect asked for in the demo.
 *
 * One test per rule in the header of src/lib/demo-center/demo-call.ts: the
 * admin who allowed it is the caller, only the proven phone is dialled, a
 * pre-existing lead's phone is never rewritten, one call per grant ever, and
 * the prospect learns a phase and an outcome — nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockDispatch = vi.hoisted(() => vi.fn())
const mockRunWithTenant = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoPhoneVerification: { findFirst: vi.fn() },
    demoRequest: { findUnique: vi.fn() },
    organization: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn(), updateMany: vi.fn() },
    voiceCallSession: { findUnique: vi.fn() },
    callEvent: { findFirst: vi.fn() },
    callLog: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: mockRunWithTenant,
}))
vi.mock("@/lib/voice-agent/dispatch-manual-lead-call", () => ({ dispatchManualLeadAiCall: mockDispatch }))

import { prisma } from "@/lib/prisma"
import {
  demoCallAgentReady,
  demoCallIdempotencyKey,
  demoCallOutcome,
  demoCallStatus,
  requestDemoCall,
} from "@/lib/demo-center/demo-call"
import { demoSessionCookieName, issueBrowserCredential } from "@/lib/demo-center/security"

const SALES_ORG = "org-leaddrive-inc"
const grant = { id: "grant-1", status: "ACTIVE", liveCallEnabled: true, createdBy: "admin-1", requestId: "request-1" }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VOICE_AGENT_ORGANIZATION_ID = SALES_ORG
  delete process.env.DEMO_LEAD_ORGANIZATION_ID
  mockRunWithTenant.mockImplementation((_org: string, fn: () => unknown) => Promise.resolve().then(fn))
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: SALES_ORG } as never)
  vi.mocked(prisma.demoPhoneVerification.findFirst).mockResolvedValue({
    phoneE164: "+994501234567",
    verifiedAt: new Date("2026-09-21T12:00:00Z"),
    consentVersion: "demo-call-consent-v1",
  } as never)
  vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue({
    internalLeadId: "lead-1",
    internalLeadOrganizationId: SALES_ORG,
    leadLinkStatus: "LINKED",
    phone: "050 123 45 67",
  } as never)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "admin-1", role: "superadmin" } as never)
  vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1", phone: "+994501234567", source: "demo" } as never)
  vi.mocked(prisma.lead.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.voiceCallSession.findUnique).mockResolvedValue({
    status: "dispatching",
    outcome: null,
    callLog: { status: "dispatching" },
  } as never)
  mockDispatch.mockResolvedValue({ kind: "dispatched", sessionId: "session-1", callLogId: "call-log-1" })
  // No demo call has been answered yet: nothing says the script fails to reach one.
  vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.callEvent.findFirst).mockResolvedValue(null)
})

describe("whether a demo call will hear the demo's script", () => {
  // Owner decision 2026-09-22: on by default; the connect-burst match gives
  // the demo call its script (call-prompt-match.ts). Only evidence of failure
  // stops it.
  it("is ready by default, before any demo call was answered", async () => {
    await expect(demoCallAgentReady()).resolves.toBe(true)
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: SALES_ORG, consentAudit: { path: ["via"], equals: "demo_center" }, duration: { gt: 0 } }),
    }))
  })

  it("stays ready when the last answered demo call was given the script", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({ id: "call-log-7" } as never)
    vi.mocked(prisma.callEvent.findFirst).mockResolvedValue({ id: "served-7" } as never)
    await expect(demoCallAgentReady()).resolves.toBe(true)
    expect(prisma.callEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: SALES_ORG, callLogId: "call-log-7", eventType: "voice_runtime_prompt_served" },
    }))
  })

  it("stops placing demo calls once an answered one went without it", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({ id: "call-log-7" } as never)
    vi.mocked(prisma.callEvent.findFirst).mockResolvedValue(null)

    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "agent_not_ready" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})

describe("one call per demo", () => {
  it("tells the prospect when the call was already placed, instead of placing another", async () => {
    mockDispatch.mockResolvedValue({ kind: "replay", sessionId: "session-1", callLogId: "call-log-1" })
    const result = await requestDemoCall({ grant })
    expect(result).toMatchObject({ ok: true, alreadyCalled: true })
  })

  it("says nothing of the kind on the first call", async () => {
    const result = await requestDemoCall({ grant })
    expect(result.ok).toBe(true)
    expect(result).not.toHaveProperty("alreadyCalled")
  })
})

describe("the idempotency key", () => {
  it("is one per grant, forever, and shaped like a UUID", () => {
    const key = demoCallIdempotencyKey("grant-1")
    expect(key).toBe(demoCallIdempotencyKey("grant-1"))
    expect(key).not.toBe(demoCallIdempotencyKey("grant-2"))
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe("what an ended call means for the story", () => {
  it.each([
    [{ status: "completed", outcome: "connected" }, "CALL_RESULT_RECORDED"],
    [{ status: "completed", outcome: "no_answer" }, "CALL_NO_ANSWER"],
    [{ status: "completed", outcome: "busy" }, "CALL_BUSY"],
    [{ status: "completed", outcome: "failed" }, "CALL_FAILED"],
    [{ status: "failed", outcome: null }, "CALL_FAILED"],
    [{ status: "blocked", outcome: null }, "CALL_BLOCKED"],
    [{ status: "dispatch_uncertain", outcome: null }, "CALL_ATTENTION_REQUIRED"],
    [{ status: "completed", outcome: "operator_closed_unknown_no_redial" }, "CALL_ATTENTION_REQUIRED"],
    [{ status: "dispatching", outcome: null }, null],
  ] as const)("%o → %s", (session, expected) => {
    expect(demoCallOutcome(session)).toBe(expected)
  })

  it("never guesses an answered call from an ending nobody reported", () => {
    expect(demoCallOutcome({ status: "something_new", outcome: null })).toBe("CALL_ATTENTION_REQUIRED")
  })
})

describe("requesting the call", () => {
  it("does nothing unless the admin allowed a live call", async () => {
    await expect(requestDemoCall({ grant: { ...grant, liveCallEnabled: false } })).resolves.toEqual({ ok: false, code: "not_enabled" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("waits for a proven phone and a recorded consent", async () => {
    vi.mocked(prisma.demoPhoneVerification.findFirst).mockResolvedValue(null)
    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "phone_not_verified" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("waits for the prospect's lead", async () => {
    vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue({ internalLeadId: null, internalLeadOrganizationId: null, leadLinkStatus: "PENDING" } as never)
    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "lead_not_ready" })
  })

  it("calls on behalf of the admin who allowed it, in the sales organisation, once per grant", async () => {
    const result = await requestDemoCall({ grant })

    expect(result).toEqual({ ok: true, status: { phase: "queued", outcome: null } })
    expect(mockRunWithTenant.mock.calls.every(([org]) => org === SALES_ORG)).toBe(true)
    expect(mockDispatch).toHaveBeenCalledWith({
      auth: { orgId: SALES_ORG, userId: "admin-1", role: "superadmin" },
      leadId: "lead-1",
      idempotencyKey: demoCallIdempotencyKey("grant-1"),
      consentAuditExtra: expect.objectContaining({
        via: "demo_center",
        demoGrantId: "grant-1",
        consentVersion: "demo-call-consent-v1",
      }),
    })
  })

  it("refuses when the admin who allowed it can no longer place calls", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "admin-1", role: "sales" } as never)
    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "no_caller" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("gives a demo-created lead the phone the prospect proved", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1", phone: "+994551111111", source: "demo" } as never)

    await requestDemoCall({ grant })

    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", organizationId: SALES_ORG },
      data: { phone: "+994501234567" },
    })
    expect(mockDispatch).toHaveBeenCalled()
  })

  it("calls only the phone on the prospect's own request", async () => {
    // A verification of another number cannot be made any more, but a row
    // from before that rule, or a request edited since, must not be called.
    vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue({
      internalLeadId: "lead-1",
      internalLeadOrganizationId: SALES_ORG,
      leadLinkStatus: "LINKED",
      phone: "+994 55 111 22 33",
    } as never)

    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "phone_mismatch" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("never rewrites the phone of a lead that existed before the demo", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1", phone: "+994551111111", source: "instagram" } as never)

    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "phone_mismatch" })
    expect(prisma.lead.updateMany).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("does not call from an organisation the voice agent does not serve", async () => {
    process.env.DEMO_LEAD_ORGANIZATION_ID = "some-other-org"
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "some-other-org" } as never)

    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "unconfigured" })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("lets the prospect wait out calling hours, but not an opt-out", async () => {
    mockDispatch.mockResolvedValueOnce({ kind: "blocked", blockers: ["outside_calling_hours"], status: 409 })
    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "blocked", reason: "outside_calling_hours", retryable: true })

    mockDispatch.mockResolvedValueOnce({ kind: "blocked", blockers: ["voice_opt_out"], status: 409 })
    await expect(requestDemoCall({ grant })).resolves.toEqual({ ok: false, code: "blocked", reason: "voice_opt_out", retryable: false })
  })
})

describe("the call's status", () => {
  it("is on the line once the provider accepted it", async () => {
    vi.mocked(prisma.voiceCallSession.findUnique).mockResolvedValue({ status: "dispatching", outcome: null, callLog: { status: "initiated" } } as never)
    await expect(demoCallStatus(grant)).resolves.toEqual({ phase: "calling", outcome: null })
  })

  it("reports the ending, and only the ending", async () => {
    vi.mocked(prisma.voiceCallSession.findUnique).mockResolvedValue({ status: "completed", outcome: "no_answer", callLog: { status: "completed" } } as never)
    await expect(demoCallStatus(grant)).resolves.toEqual({ phase: "ended", outcome: "CALL_NO_ANSWER" })
  })

  it("is nothing before the call was asked for", async () => {
    vi.mocked(prisma.voiceCallSession.findUnique).mockResolvedValue(null)
    await expect(demoCallStatus(grant)).resolves.toEqual({ phase: "none", outcome: null })
  })
})

describe("the public call route", () => {
  const TOKEN = "d".repeat(64)

  async function call(method: "GET" | "POST", cookie?: string) {
    const route = await import("@/app/api/v1/public/demo-access/[token]/call/route")
    const handler = method === "GET" ? route.GET : route.POST
    return handler(
      new NextRequest(new URL(`/api/v1/public/demo-access/${TOKEN}/call`, "http://localhost:3000"), {
        method,
        headers: cookie ? { Cookie: cookie } : {},
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
  }

  function activeGrant(sessionHash: string) {
    return {
      ...grant,
      sessionHash,
      linkExpiresAt: new Date("2099-01-01T00:00:00Z"),
      sessionStartedAt: new Date(),
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: new Date("2099-01-01T00:00:00Z"),
      inactivityMinutes: 30,
    }
  }

  it("requires the prospect's own live session", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant("someone-else") as never)
    const response = await call("POST")
    expect(response.status).toBe(401)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("answers with a phase and an outcome, never an id or a number", async () => {
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)

    const response = await call("POST", `${demoSessionCookieName(TOKEN)}=${credential.credential}`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, phase: "queued", outcome: null })
    expect(JSON.stringify(body)).not.toMatch(/session-1|call-log-1|lead-1|994/)
  })
})
