import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * Tests for SMS 2FA login flow end-to-end:
 *   1. GET /api/v1/auth/sms-2fa/status      → returns current state
 *   2. POST /api/v1/auth/sms-2fa/enable     → flips flag + saves phone
 *   3. POST /api/v1/auth/sms-2fa/disable    → clears flag
 *   4. POST /api/v1/auth/verify-sms-2fa     → post-password code check
 *   5. POST /api/v1/auth/resend-sms-2fa     → fresh code on demand
 */

const state = {
  session: { user: { id: "u1", email: "a@b.com" } } as any,
  user: null as any,
  verifyResult: { success: true, error: undefined } as any,
}

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.session) }))
vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(async () => state.session?.user ? {
    userId: state.session.user.id,
    orgId: "org_1",
    role: "admin",
    email: state.session.user.email,
    name: "Test",
  } : null),
  requireSessionAuth: vi.fn(async () => state.session?.user ? {
    userId: state.session.user.id,
    orgId: "org_1",
    role: "admin",
    email: state.session.user.email,
    name: "Test",
  } : NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: any) => {
        state.user = { ...state.user, ...data }
        return state.user
      }),
    },
  },
}))

vi.mock("@/lib/sms", () => ({
  verifyOtp: vi.fn(async () => state.verifyResult),
  sendOtp: vi.fn(async () => ({ success: true })),
}))

import { GET as statusGET } from "@/app/api/v1/auth/sms-2fa/status/route"
import { POST as enablePOST } from "@/app/api/v1/auth/sms-2fa/enable/route"
import { POST as disablePOST } from "@/app/api/v1/auth/sms-2fa/disable/route"
import { POST as verifySmsPOST } from "@/app/api/v1/auth/verify-sms-2fa/route"
import { POST as resendPOST } from "@/app/api/v1/auth/resend-sms-2fa/route"
import { verifyOtp, sendOtp } from "@/lib/sms"
import { prisma } from "@/lib/prisma"

function jsonReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/auth/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function emptyReq(): NextRequest {
  return new NextRequest("https://example.com/api/v1/auth/x", { method: "GET" })
}

beforeEach(() => {
  state.session = { user: { id: "u1", email: "a@b.com" } }
  state.user = {
    id: "u1",
    smsAuthEnabled: false,
    verifiedPhone: null,
    totpEnabled: false,
    totpSecret: null,
    backupCodes: [],
  }
  state.verifyResult = { success: true }
  vi.clearAllMocks()
})

describe("GET /api/v1/auth/sms-2fa/status", () => {
  it("returns disabled + null phone when flag is off", async () => {
    state.user.smsAuthEnabled = false
    state.user.verifiedPhone = null

    const res = await statusGET(emptyReq())
    const body = await res.json()

    expect(body.data.enabled).toBe(false)
    expect(body.data.phone).toBeNull()
  })

  it("returns enabled + masked phone when flag is on", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"

    const res = await statusGET(emptyReq())
    const body = await res.json()

    expect(body.data.enabled).toBe(true)
    // Masked: first 5 chars + ***** + last 3 chars
    expect(body.data.phone).toBe("+9945*****838")
  })

  it("suggests admin-set phone when disabled (pre-fill for Enable form)", async () => {
    state.user.smsAuthEnabled = false
    state.user.verifiedPhone = null
    state.user.phone = "+994501234567" // admin set this via /settings/users

    const res = await statusGET(emptyReq())
    const body = await res.json()

    expect(body.data.suggestedPhone).toBe("+994501234567")
  })

  it("does NOT leak suggestedPhone when already enabled", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"
    state.user.phone = "+994501234567"

    const res = await statusGET(emptyReq())
    const body = await res.json()

    expect(body.data.suggestedPhone).toBeNull()
  })

  it("401 when not logged in", async () => {
    state.session = null
    const res = await statusGET(emptyReq())
    expect(res.status).toBe(401)
  })
})

describe("POST /api/v1/auth/sms-2fa/enable", () => {
  it("verifies OTP and flips flag on success", async () => {
    const res = await enablePOST(jsonReq({ phone: "+994512060838", code: "123456" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(verifyOtp).toHaveBeenCalledWith("+994512060838", "123456", "2fa", "u1")
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { smsAuthEnabled: true, verifiedPhone: "+994512060838" },
      })
    )
  })

  it("strips separators from the phone before saving", async () => {
    await enablePOST(jsonReq({ phone: "+994 (51) 206-08-38", code: "123456" }))
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { smsAuthEnabled: true, verifiedPhone: "+994512060838" },
      })
    )
  })

  it("400 when OTP verification fails", async () => {
    state.verifyResult = { success: false, error: "Invalid code" }
    const res = await enablePOST(jsonReq({ phone: "+994512060838", code: "999999" }))
    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("429 when OTP is locked out for brute force", async () => {
    state.verifyResult = { success: false, error: "Too many attempts" }
    const res = await enablePOST(jsonReq({ phone: "+994512060838", code: "999999" }))
    expect(res.status).toBe(429)
  })

  it("400 on malformed body", async () => {
    const res = await enablePOST(jsonReq({ phone: "abc", code: "xyz" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/auth/sms-2fa/disable", () => {
  it("verifies a fresh SMS code, clears the flag, and revokes sessions", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"

    const res = await disablePOST(jsonReq({ code: "654321" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(verifyOtp).toHaveBeenCalledWith("+994512060838", "654321", "2fa", "u1")
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          smsAuthEnabled: false,
          twoFactorNonce: null,
          passwordChangedAt: expect.any(Date),
        }),
      })
    )
    expect(body.data.reauthenticate).toBe(true)
  })

  it("does not disable SMS 2FA without a verification code", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"

    const res = await disablePOST(emptyReq())

    expect(res.status).toBe(400)
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("keeps the factor enabled when verification fails", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"
    state.verifyResult = { success: false, error: "Invalid code" }

    const res = await disablePOST(jsonReq({ code: "000000" }))

    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("401 when not logged in", async () => {
    state.session = null
    const res = await disablePOST(jsonReq({ code: "654321" }))
    expect(res.status).toBe(401)
  })
})

describe("POST /api/v1/auth/verify-sms-2fa (login challenge)", () => {
  it("400 when user has no SMS 2FA enabled", async () => {
    state.user.smsAuthEnabled = false
    const res = await verifySmsPOST(jsonReq({ code: "123456" }))
    expect(res.status).toBe(400)
  })

  it("verifies code against verifiedPhone and returns nonce", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"

    const res = await verifySmsPOST(jsonReq({ code: "654321" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.verified).toBe(true)
    expect(body.data.twoFactorNonce).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyOtp).toHaveBeenCalledWith("+994512060838", "654321", "2fa", "u1")
    // Nonce saved to DB so the JWT callback can verify it on session.update()
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ twoFactorNonce: expect.any(String) }) })
    )
  })

  it("400 on wrong code", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"
    state.verifyResult = { success: false, error: "Invalid code" }

    const res = await verifySmsPOST(jsonReq({ code: "000000" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/auth/resend-sms-2fa", () => {
  it("sends a fresh code to the verified phone", async () => {
    state.user.smsAuthEnabled = true
    state.user.verifiedPhone = "+994512060838"

    const res = await resendPOST(emptyReq())
    expect(res.status).toBe(200)
    expect(sendOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+994512060838",
        purpose: "2fa",
        userId: "u1",
      })
    )
  })

  it("400 when SMS 2FA not enabled", async () => {
    state.user.smsAuthEnabled = false
    const res = await resendPOST(emptyReq())
    expect(res.status).toBe(400)
    expect(sendOtp).not.toHaveBeenCalled()
  })
})
