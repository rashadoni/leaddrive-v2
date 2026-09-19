import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const sendDemoOtpEmail = vi.hoisted(() => vi.fn())

vi.mock("@/lib/demo-center/email", () => ({ sendDemoOtpEmail }))
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
  },
}))

import { POST as startDemo } from "@/app/api/v1/public/demo-access/[token]/start/route"
import { POST as recordDemoEvent } from "@/app/api/v1/public/demo-access/[token]/events/route"
import { GET as getDemoAccess } from "@/app/api/v1/public/demo-access/[token]/route"
import { POST as sendDemoOtp } from "@/app/api/v1/public/demo-access/[token]/otp/route"
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
  sendDemoOtpEmail.mockResolvedValue({ success: true, messageId: "otp-message-1" })
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
    return await run(prisma) as never
  })
})

describe("Demo Center OTP lifetime limit", () => {
  it("does not renew guessing attempts by sending another code", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "SENT",
      otpAttempts: 3,
      otpSentAt: new Date(0),
      request: { email: "buyer@example.az", name: "Prospect" },
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-otp" } as never)

    const response = await sendDemoOtp(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/otp`, { method: "POST" }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(200)
    const update = vi.mocked(prisma.demoGrant.updateMany).mock.calls[0]?.[0]
    expect(update?.data).not.toHaveProperty("otpAttempts")
    expect(update?.where).toMatchObject({ otpAttempts: { lt: 5 } })
    expect(update?.where).toMatchObject({ otpSendCount: { lt: 5 } })
    expect(update?.data).toMatchObject({ otpSendCount: { increment: 1 } })
  })

  it("locks the invitation after five total failed codes even after cooldown", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "OTP_SENT",
      otpAttempts: 5,
      otpSentAt: new Date(0),
      request: { email: "buyer@example.az", name: "Prospect" },
    }) as never)

    const response = await sendDemoOtp(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/otp`, { method: "POST" }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(429)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
    expect(sendDemoOtpEmail).not.toHaveBeenCalled()
  })

  it("stops sending after five OTP emails even when no code was guessed", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "SENT",
      otpSendCount: 5,
      otpSentAt: new Date(0),
      request: { email: "buyer@example.az", name: "Prospect" },
    }) as never)

    const response = await sendDemoOtp(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/otp`, { method: "POST" }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(429)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
    expect(sendDemoOtpEmail).not.toHaveBeenCalled()
  })

  it("keeps the resend cooldown and send count after provider failure", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({
      status: "SENT",
      otpSentAt: new Date(0),
      request: { email: "buyer@example.az", name: "Prospect" },
    }) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    sendDemoOtpEmail.mockResolvedValue({ success: false, error: "provider unavailable" })

    const response = await sendDemoOtp(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${TOKEN}/otp`, { method: "POST" }),
      { params: Promise.resolve({ token: TOKEN }) },
    )

    expect(response.status).toBe(502)
    const failureUpdate = vi.mocked(prisma.demoGrant.updateMany).mock.calls[1]?.[0]
    expect(failureUpdate?.data).not.toHaveProperty("otpSentAt")
    expect(failureUpdate?.data).not.toHaveProperty("otpSendCount")
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
  })
})
