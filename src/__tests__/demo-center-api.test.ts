import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const confirmDemoRequestEmail = vi.hoisted(() => vi.fn())
const ensureDemoProspectLead = vi.hoisted(() => vi.fn())

vi.mock("@/lib/demo-center/email-confirmation", () => ({ confirmDemoRequestEmail }))
vi.mock("@/lib/demo-center/prospect-lead", () => ({ ensureDemoProspectLead }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    demoGrant: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    demoAccessEvent: {
      create: vi.fn(),
    },
    demoSocialConnection: {
      updateMany: vi.fn(),
    },
  },
}))

import { POST as startDemo } from "@/app/api/v1/public/demo-access/[token]/start/route"
import { POST as recordDemoEvent } from "@/app/api/v1/public/demo-access/[token]/events/route"
import { GET as getDemoAccess } from "@/app/api/v1/public/demo-access/[token]/route"
import { POST as confirmDemoEmail } from "@/app/api/v1/public/demo-access/[token]/confirm/route"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded } from "@/lib/demo-center/access"
import {
  demoSessionCookieName,
  demoVerificationCookieName,
  issueBrowserCredential,
} from "@/lib/demo-center/security"

const TOKEN = "a".repeat(64)
const FUTURE = new Date("2099-09-19T14:00:00.000Z")
const PAST = new Date("2026-09-19T10:00:00.000Z")

function request(path: string, cookieName: string, cookieValue: string, body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: {
      Cookie: `${cookieName}=${cookieValue}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    requestId: "request-1",
    status: "OTP_VERIFIED",
    linkExpiresAt: FUTURE,
    verificationExpiresAt: FUTURE,
    sessionStartedAt: null,
    sessionLastSeenAt: null,
    sessionExpiresAt: null,
    inactivityMinutes: 30,
    otpAttempts: 0,
    otpSendCount: 0,
    sessionDurationMinutes: 120,
    verificationHash: null,
    sessionHash: null,
    moduleIds: ["crm"],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmDemoRequestEmail.mockResolvedValue("confirmed")
  ensureDemoProspectLead.mockResolvedValue({ status: "LINKED", leadId: "lead-1", mode: "already" })
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
    return await run(prisma) as never
  })
})

describe("Demo Center email confirmation", () => {
  // Owner, 2026-10-18: one email, the prospect opens its link and presses the
  // button, and the demo opens. The press is what proves the address.
  function confirm(cookie = "") {
    return confirmDemoEmail(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/confirm`, {
        method: "POST",
        headers: cookie ? { Cookie: cookie } : {},
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
  }

  it("confirms the address from the emailed link and gives this browser the verification cookie", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ status: "SENT", verifiedAt: null, verificationExpiresAt: null }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-confirmed" } as never)

    const response = await confirm()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, state: "verified" })
    const update = vi.mocked(prisma.demoGrant.updateMany).mock.calls[0]?.[0]
    expect(update?.where).toMatchObject({ id: "grant-1", sessionStartedAt: null, status: { in: ["SENT", "OTP_SENT", "OTP_VERIFIED"] } })
    expect(update?.data).toMatchObject({ status: "OTP_VERIFIED", otpHash: null, verifiedAt: expect.any(Date), verificationHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const cookie = response.cookies.get(demoVerificationCookieName(TOKEN))?.value
    expect(cookie).toBeTruthy()
    expect(vi.mocked(prisma.demoAccessEvent.create).mock.calls[0]?.[0]).toMatchObject({ data: { grantId: "grant-1", eventType: "EMAIL_CONFIRMED" } })
    // The owner hears about the request now, and the prospect becomes a lead.
    expect(confirmDemoRequestEmail).toHaveBeenCalledWith("request-1", expect.any(Date))
    expect(ensureDemoProspectLead).toHaveBeenCalledWith("request-1", expect.any(Date))
  })

  it("confirms a grant that was waiting for a code from before the code was dropped", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ status: "OTP_SENT", otpHash: "x", verifiedAt: null, verificationExpiresAt: null }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-confirmed" } as never)

    expect((await confirm()).status).toBe(200)
  })

  it("keeps the moment the address was first proven when the button is pressed again", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ status: "OTP_VERIFIED", verifiedAt: PAST }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-confirmed" } as never)

    expect((await confirm()).status).toBe(200)
    expect(vi.mocked(prisma.demoGrant.updateMany).mock.calls[0]?.[0]?.data).toMatchObject({ verifiedAt: PAST })
  })

  it("refuses once the session has started, and tells nobody", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      sessionHash: "f".repeat(64),
      sessionStartedAt: new Date(),
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
    }) as never)

    const response = await confirm()

    expect(response.status).toBe(409)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
    expect(confirmDemoRequestEmail).not.toHaveBeenCalled()
    expect(ensureDemoProspectLead).not.toHaveBeenCalled()
  })

  it("does not confirm when the button lost a race to a session start", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ status: "SENT", verifiedAt: null }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 0 })

    const response = await confirm()

    expect(response.status).toBe(409)
    expect(response.cookies.get(demoVerificationCookieName(TOKEN))).toBeUndefined()
    expect(confirmDemoRequestEmail).not.toHaveBeenCalled()
  })

  it("opening the link confirms nothing: only the button does", async () => {
    // Mail scanners open links to inspect them. A GET that confirmed would
    // tell the owner about a request nobody read, and bind the one session
    // to the scanner.
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "SENT",
      verifiedAt: null,
      verificationExpiresAt: null,
      openedAt: null,
      scenarioId: null,
      request: { company: "Xəzər Logistika MMC", email: "buyer@example.az", name: "Prospect", jobTitle: null, phone: null, source: "website" },
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-opened" } as never)

    const response = await getDemoAccess(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}`),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    await expect(response.json()).resolves.toMatchObject({ state: "ready" })
    for (const [call] of vi.mocked(prisma.demoGrant.updateMany).mock.calls) {
      expect(Object.keys(call.data ?? {})).toEqual(["openedAt"])
    }
    expect(confirmDemoRequestEmail).not.toHaveBeenCalled()
  })

  it("will not start a session for a browser that never pressed the button", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ status: "SENT", verificationHash: null }) as never)

    const response = await startDemo(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/start`, { method: "POST" }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(401)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("Demo Center expiry races", () => {
  it("does not expire a session refreshed after the caller snapshot", async () => {
    const stale = grant({
      status: "ACTIVE",
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date("2026-09-19T10:00:00.000Z"),
      sessionExpiresAt: FUTURE,
    })
    const freshLastSeen = new Date("2026-09-19T11:59:30.000Z")
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      sessionStartedAt: PAST,
      sessionLastSeenAt: freshLastSeen,
      sessionExpiresAt: FUTURE,
    }) as never)

    const expired = await expireDemoGrantIfNeeded(stale as never, new Date("2026-09-19T12:00:00.000Z"))

    expect(expired).toBe(false)
    expect(stale.sessionLastSeenAt).toEqual(freshLastSeen)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })
})

describe("Demo Center one-session API", () => {
  it("returns the nearest inactivity deadline for an active browser", async () => {
    const session = issueBrowserCredential()
    const lastSeenAt = new Date(Date.now() - 10_000)
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: lastSeenAt,
      sessionExpiresAt: FUTURE,
      sessionHash: session.credentialHash,
      request: { company: "Acme", email: "buyer@example.az", name: "Prospect" },
    }) as never)

    const response = await getDemoAccess(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}?probe=1`, {
        headers: { Cookie: `${demoSessionCookieName(TOKEN)}=${session.credential}` },
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      state: "active",
      serverNow: expect.any(String),
      idleExpiresAt: new Date(lastSeenAt.getTime() + 30 * 60_000).toISOString(),
    })
  })

  it("atomically binds the first explicit start to one browser cookie", async () => {
    const verification = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      verificationHash: verification.credentialHash,
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)

    const response = await startDemo(
      request(`/api/v1/public/demo-access/${TOKEN}/start`, demoVerificationCookieName(TOKEN), verification.credential),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, state: "active" })
    expect(response.cookies.get(demoSessionCookieName(TOKEN))?.value).toBe(verification.credential)
    expect(prisma.demoGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "OTP_VERIFIED", sessionStartedAt: null }),
      data: expect.objectContaining({ status: "ACTIVE", verificationHash: null }),
    }))
    // Second chance for the lead, in case the attempt at verification failed.
    expect(ensureDemoProspectLead).toHaveBeenCalledWith("request-1", expect.any(Date))
  })

  it("rejects a losing concurrent start instead of creating a second session", async () => {
    const verification = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      verificationHash: verification.credentialHash,
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 0 })

    const response = await startDemo(
      request(`/api/v1/public/demo-access/${TOKEN}/start`, demoVerificationCookieName(TOKEN), verification.credential),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(409)
    expect(response.cookies.get(demoSessionCookieName(TOKEN))).toBeUndefined()
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("recovers the same session when the first start response was lost", async () => {
    const verification = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      sessionHash: verification.credentialHash,
    }) as never)

    const response = await startDemo(
      request(
        `/api/v1/public/demo-access/${TOKEN}/start`,
        demoVerificationCookieName(TOKEN),
        verification.credential,
      ),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, state: "active", resumed: true })
    expect(response.cookies.get(demoSessionCookieName(TOKEN))?.value).toBe(verification.credential)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
  })

  it("does not let another browser resume an already active grant", async () => {
    const boundSession = issueBrowserCredential()
    const otherSession = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      sessionHash: boundSession.credentialHash,
    }) as never)

    const response = await startDemo(
      request(`/api/v1/public/demo-access/${TOKEN}/start`, demoSessionCookieName(TOKEN), otherSession.credential),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(409)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
  })

  it("denies events for modules outside the server-issued playlist", async () => {
    const session = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      sessionHash: session.credentialHash,
      moduleIds: ["crm"],
    }) as never)
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-denied" } as never)

    const response = await recordDemoEvent(
      request(`/api/v1/public/demo-access/${TOKEN}/events`, demoSessionCookieName(TOKEN), session.credential, {
        eventType: "MODULE_OPENED",
        moduleId: "sales",
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(403)
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "DENIED", moduleId: "sales" }),
    })
  })

  it("refreshes idle time for a real interaction without polluting access history", async () => {
    const session = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      sessionHash: session.credentialHash,
      moduleIds: ["crm"],
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })

    const response = await recordDemoEvent(
      request(`/api/v1/public/demo-access/${TOKEN}/events`, demoSessionCookieName(TOKEN), session.credential, {
        eventType: "STEP_VIEWED",
        moduleId: "crm",
        stepId: "customer-overview",
        metadata: { activityOnly: true },
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      serverNow: expect.any(String),
      sessionExpiresAt: FUTURE.toISOString(),
    })
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("closes and clears the bound session on completion", async () => {
    const session = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "ACTIVE",
      verificationExpiresAt: null,
      sessionStartedAt: PAST,
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      sessionHash: session.credentialHash,
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-complete" } as never)

    const response = await recordDemoEvent(
      request(`/api/v1/public/demo-access/${TOKEN}/events`, demoSessionCookieName(TOKEN), session.credential, {
        eventType: "COMPLETED",
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, state: "completed" })
    expect(response.cookies.get(demoSessionCookieName(TOKEN))?.value).toBe("")
    expect(prisma.demoGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ACTIVE" }),
      data: expect.objectContaining({ status: "COMPLETED", sessionHash: null }),
    }))
    // «Bitir» asks for the release of the prospect's own Facebook Page in the same transaction.
    expect(prisma.demoSocialConnection.updateMany).toHaveBeenCalledWith({
      where: { grantId: "grant-1", scrubbedAt: null, releaseRequestedAt: null },
      data: { releaseRequestedAt: expect.any(Date), releaseReason: "finished" },
    })
  })
})
