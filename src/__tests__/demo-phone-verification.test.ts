/**
 * A prospect proves a phone and agrees to exactly one AI call.
 *
 * One test per rule in the header of src/lib/demo-center/phone-verification.ts:
 * live call must be allowed for the grant, only Azerbaijani numbers, the email
 * code's limits, consent only together with a proven phone and never lifting a
 * block, and the SMS sent only from the configured sales organisation.
 */
import bcrypt from "bcryptjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockSendSms = vi.hoisted(() => vi.fn())
const mockRunWithTenant = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoPhoneVerification: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    demoAccessEvent: { create: vi.fn() },
    organization: { findFirst: vi.fn() },
    voiceConsent: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: mockRunWithTenant,
}))
vi.mock("@/lib/sms", () => ({ sendSms: mockSendSms }))

import { prisma } from "@/lib/prisma"
import {
  DEMO_CALL_CONSENT_TTL_MS,
  DEMO_CALL_CONSENT_VERSION,
  demoLiveCallState,
  normalizeDemoPhone,
  sendDemoPhoneCode,
  verifyDemoPhoneCode,
} from "@/lib/demo-center/phone-verification"
import { demoSessionCookieName, issueBrowserCredential } from "@/lib/demo-center/security"

const SALES_ORG = "org-leaddrive-inc"
const NOW = new Date("2026-09-21T12:00:00.000Z")
const grant = { id: "grant-1", status: "ACTIVE", liveCallEnabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VOICE_AGENT_ORGANIZATION_ID = SALES_ORG
  delete process.env.DEMO_LEAD_ORGANIZATION_ID
  mockRunWithTenant.mockImplementation((_org: string, fn: () => unknown) => Promise.resolve().then(fn))
  mockSendSms.mockResolvedValue({ success: true })
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: SALES_ORG } as never)
  vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([])
  vi.mocked(prisma.demoPhoneVerification.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.demoPhoneVerification.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.voiceConsent.findUnique).mockResolvedValue(null)
})

describe("normalizeDemoPhone", () => {
  it.each(["+994 50 123 45 67", "0501234567", "994501234567", "(050) 123-45-67"])("accepts %s", (raw) => {
    expect(normalizeDemoPhone(raw)?.e164).toBe("+994501234567")
  })

  it.each(["+7 912 345 67 89", "+1 202 555 0143", "12345", ""])("refuses %s — only Azerbaijani numbers", (raw) => {
    expect(normalizeDemoPhone(raw)).toBeNull()
  })
})

describe("sending the code", () => {
  it("does nothing unless the admin allowed a live call for this grant", async () => {
    await expect(sendDemoPhoneCode({ grant: { ...grant, liveCallEnabled: false }, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: false, code: "not_enabled" })
    await expect(sendDemoPhoneCode({ grant: { ...grant, status: "OTP_VERIFIED" }, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: false, code: "not_enabled" })
    expect(mockSendSms).not.toHaveBeenCalled()
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("texts nobody abroad", async () => {
    await expect(sendDemoPhoneCode({ grant, phone: "+7 912 345 67 89", now: NOW }))
      .resolves.toEqual({ ok: false, code: "invalid_phone" })
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it("sends the code from the sales organisation and records it", async () => {
    await expect(sendDemoPhoneCode({ grant, phone: "050 123 45 67", now: NOW }))
      .resolves.toEqual({ ok: true, state: "code_sent" })

    expect(mockRunWithTenant).toHaveBeenCalledTimes(1)
    expect(mockRunWithTenant.mock.calls[0][0]).toBe(SALES_ORG)
    const sms = mockSendSms.mock.calls[0][0]
    expect(sms).toMatchObject({ to: "+994501234567", organizationId: SALES_ORG })
    expect(sms.message).toMatch(/^LeadDrive demo kodu: \d{6}\./)
    expect(prisma.demoPhoneVerification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { grantId_phoneE164: { grantId: "grant-1", phoneE164: "+994501234567" } },
    }))
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "PHONE_CODE_SENT", metadata: { delivered: true, phoneTail: "67" } }),
    })
  })

  it("keeps a cooldown between codes to the same phone", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([
      { phoneE164: "+994501234567", otpSendCount: 1, otpSentAt: new Date(NOW.getTime() - 20_000), verifiedAt: null },
    ] as never)

    await expect(sendDemoPhoneCode({ grant, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: false, code: "cooldown", retryAfterSeconds: 40 })
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it("caps sends per grant across every phone tried", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([
      { phoneE164: "+994501111111", otpSendCount: 2, otpSentAt: new Date("2026-09-21T11:00:00Z"), verifiedAt: null },
      { phoneE164: "+994502222222", otpSendCount: 1, otpSentAt: new Date("2026-09-21T11:10:00Z"), verifiedAt: null },
    ] as never)

    await expect(sendDemoPhoneCode({ grant, phone: "0503333333", now: NOW }))
      .resolves.toEqual({ ok: false, code: "too_many" })
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it("counts a send the provider refused", async () => {
    mockSendSms.mockResolvedValue({ success: false, error: "provider down" })

    await expect(sendDemoPhoneCode({ grant, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: false, code: "sms_failed" })
    expect(prisma.demoPhoneVerification.upsert).toHaveBeenCalledTimes(1)
  })

  it("does not text a phone that is already proven", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([
      { phoneE164: "+994501234567", otpSendCount: 1, otpSentAt: new Date("2026-09-21T11:00:00Z"), verifiedAt: new Date("2026-09-21T11:01:00Z") },
    ] as never)

    await expect(sendDemoPhoneCode({ grant, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: true, state: "already_verified" })
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it("does nothing when no sales organisation is configured", async () => {
    delete process.env.VOICE_AGENT_ORGANIZATION_ID
    await expect(sendDemoPhoneCode({ grant, phone: "0501234567", now: NOW }))
      .resolves.toEqual({ ok: false, code: "unconfigured" })
    expect(mockSendSms).not.toHaveBeenCalled()
  })
})

describe("proving the phone and agreeing to the call", () => {
  function pending(overrides: Record<string, unknown> = {}) {
    return {
      id: "verification-1",
      grantId: "grant-1",
      phoneE164: "+994501234567",
      otpHash: bcrypt.hashSync("123456", 4),
      otpExpiresAt: new Date(NOW.getTime() + 60_000),
      otpAttempts: 0,
      verifiedAt: null,
      ...overrides,
    }
  }

  function withPending(row: Record<string, unknown> | null) {
    vi.mocked(prisma.demoPhoneVerification.findFirst)
      .mockResolvedValueOnce(null) // no phone proven yet
      .mockResolvedValueOnce(row as never)
  }

  it("is checked like any code and records that the phone was proven through Telegram", async () => {
    withPending({ ...pending(), telegramProofMessage: "777001:120" })
    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW })).resolves.toEqual({ ok: true, state: "verified" })
    expect(prisma.demoPhoneVerification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verifiedAt: NOW, verifiedVia: "telegram", consentVersion: DEMO_CALL_CONSENT_VERSION }),
    }))
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "PHONE_VERIFIED", metadata: expect.objectContaining({ method: "telegram" }) }),
    })
  })

  it("refuses without the checkbox, before looking at the code", async () => {
    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: false, now: NOW }))
      .resolves.toEqual({ ok: false, code: "consent_required" })
    expect(prisma.demoPhoneVerification.findFirst).not.toHaveBeenCalled()
  })

  it("counts a wrong code against the limit", async () => {
    withPending(pending({ otpAttempts: 2 }))

    await expect(verifyDemoPhoneCode({ grant, code: "654321", consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "wrong_code", attemptsRemaining: 2 })
    expect(prisma.demoPhoneVerification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { otpAttempts: { increment: 1 } },
    }))
  })

  it("stops after five wrong codes, even with the right one", async () => {
    withPending(pending({ otpAttempts: 5 }))
    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "too_many_attempts" })
  })

  it("refuses an expired code", async () => {
    withPending(pending({ otpExpiresAt: new Date(NOW.getTime() - 1) }))
    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "expired" })
  })

  it("records the proof and the exact consent wording together, once", async () => {
    withPending(pending())

    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW }))
      .resolves.toEqual({ ok: true, state: "verified" })

    expect(prisma.demoPhoneVerification.updateMany).toHaveBeenCalledWith({
      where: { id: "verification-1", otpHash: expect.any(String), verifiedAt: null },
      data: expect.objectContaining({
        otpHash: null,
        verifiedAt: NOW,
        verifiedVia: "sms",
        consentAt: NOW,
        consentVersion: DEMO_CALL_CONSENT_VERSION,
      }),
    })
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "PHONE_VERIFIED", metadata: expect.objectContaining({ method: "sms" }) }),
    })
  })

  it("lets the sales organisation's call policy see the permission, for a day", async () => {
    withPending(pending())

    await verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW })

    expect(mockRunWithTenant.mock.calls[0][0]).toBe(SALES_ORG)
    expect(prisma.voiceConsent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: SALES_ORG,
        phoneE164: "+994501234567",
        scope: "sales",
        status: "allowed",
        source: "demo_center_self_consent",
        reason: DEMO_CALL_CONSENT_VERSION,
        expiresAt: new Date(NOW.getTime() + DEMO_CALL_CONSENT_TTL_MS),
      }),
    })
  })

  it("never lifts an existing block", async () => {
    withPending(pending())
    vi.mocked(prisma.voiceConsent.findUnique).mockResolvedValue({ status: "blocked", expiresAt: null } as never)

    await verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW })

    expect(prisma.voiceConsent.update).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
  })

  it("never shortens an open-ended permission a manager gave", async () => {
    withPending(pending())
    vi.mocked(prisma.voiceConsent.findUnique).mockResolvedValue({ status: "allowed", expiresAt: null } as never)

    await verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW })

    expect(prisma.voiceConsent.update).not.toHaveBeenCalled()
  })

  it("loses a race for the same code instead of proving twice", async () => {
    withPending(pending())
    vi.mocked(prisma.demoPhoneVerification.updateMany).mockResolvedValue({ count: 0 })

    await expect(verifyDemoPhoneCode({ grant, code: "123456", consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "already_used" })
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
  })
})

describe("what the player learns", () => {
  it("is booleans only", async () => {
    vi.mocked(prisma.demoPhoneVerification.findFirst).mockResolvedValue({ id: "verification-1" } as never)
    await expect(demoLiveCallState({ id: "grant-1", liveCallEnabled: true }, "+994501234567")).resolves.toEqual({
      enabled: true,
      requestPhoneUsable: true,
      phoneVerified: true,
      // A proven phone needs no second proof, so the bot is not even asked about.
      telegramAvailable: false,
    })
    await expect(demoLiveCallState({ id: "grant-1", liveCallEnabled: false }, "+994501234567")).resolves.toEqual({
      enabled: false,
      requestPhoneUsable: false,
      phoneVerified: false,
      telegramAvailable: false,
    })
  })
})

describe("the public phone route", () => {
  const TOKEN = "c".repeat(64)

  async function post(body: unknown, cookie?: string) {
    const { POST } = await import("@/app/api/v1/public/demo-access/[token]/phone/route")
    return POST(
      new NextRequest(new URL(`/api/v1/public/demo-access/${TOKEN}/phone`, "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
  }

  function activeGrant(sessionHash: string | null) {
    return {
      id: "grant-1",
      status: "ACTIVE",
      liveCallEnabled: true,
      sessionHash,
      linkExpiresAt: new Date("2099-01-01T00:00:00Z"),
      sessionStartedAt: new Date(),
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: new Date("2099-01-01T00:00:00Z"),
      inactivityMinutes: 30,
      request: { phone: "+994501234567" },
    }
  }

  it("sends no SMS in the demo: the code comes through Telegram only", async () => {
    // Owner, 2026-09-22: the SMS quota is limited and the demo is free —
    // «заставим их, чтоб в телеграм приходило».
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)

    const response = await post({ useRequestPhone: true }, `${demoSessionCookieName(TOKEN)}=${credential.credential}`)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toMatchObject({ success: false, code: "sms_disabled" })
    expect(body.error).toContain("Telegram")
    expect(mockSendSms).not.toHaveBeenCalled()
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("still refuses any number the browser names", async () => {
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)
    const response = await post({ phone: "+994551112233" }, `${demoSessionCookieName(TOKEN)}=${credential.credential}`)
    expect(response.status).toBe(400)
    expect(mockSendSms).not.toHaveBeenCalled()
  })
})
