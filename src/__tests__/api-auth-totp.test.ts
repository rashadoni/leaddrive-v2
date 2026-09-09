import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    account: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
}))

vi.mock("otplib", () => ({
  generateSecret: vi.fn().mockReturnValue("MOCK_SECRET_BASE32"),
  generateURI: vi.fn().mockReturnValue("otpauth://totp/LeadDrive%20CRM:test@test.com?secret=MOCK_SECRET_BASE32&issuer=LeadDrive%20CRM"),
  verifySync: vi.fn(),
}))

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,MOCK_QR") },
}))

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}))

vi.mock("crypto", () => ({
  default: {
    randomBytes: vi.fn().mockReturnValue({
      toString: () => "abcd1234",
    }),
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"
import { verifySync } from "otplib"
import bcrypt from "bcryptjs"

import { GET as twoFaGET, POST as twoFaPOST } from "@/app/api/v1/auth/2fa/route"
import { POST as totpSetupPOST } from "@/app/api/v1/auth/totp/setup/route"
import { POST as totpVerifyPOST } from "@/app/api/v1/auth/totp/verify/route"
import { POST as totpDisablePOST } from "@/app/api/v1/auth/totp/disable/route"
import { GET as totpStatusGET } from "@/app/api/v1/auth/totp/status/route"
import { POST as verify2faPOST } from "@/app/api/v1/auth/verify-2fa/route"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(url: string, method = "GET", body?: Record<string, unknown>) {
  const init: ConstructorParameters<typeof NextRequest>[1] = { method, headers: { "Content-Type": "application/json" } }
  if (body) init.body = JSON.stringify(body)
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

const mockSession = {
  user: { id: "user-1", email: "test@test.com", name: "Test", organizationId: "org-1", role: "admin" },
}

const mockUser = {
  id: "user-1",
  email: "test@test.com",
  totpSecret: "EXISTING_SECRET",
  totpEnabled: true,
  passwordHash: "$2a$10$hashedpassword",
  backupCodes: JSON.stringify(["ABCD-1234", "EFGH-5678"]),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as any)
})

// ===========================================================================
// GET /api/v1/auth/2fa — get 2FA status
// ===========================================================================
describe("GET /api/v1/auth/2fa", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await twoFaGET(makeRequest("/api/v1/auth/2fa"))
    expect(res.status).toBe(401)
  })

  it("returns 2FA enabled status", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ totpEnabled: true, email: "test@test.com" } as any)
    const res = await twoFaGET(makeRequest("/api/v1/auth/2fa"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.enabled).toBe(true)
  })

  it("returns false when TOTP not enabled", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ totpEnabled: false, email: "test@test.com" } as any)
    const res = await twoFaGET(makeRequest("/api/v1/auth/2fa"))
    const json = await res.json()
    expect(json.data.enabled).toBe(false)
  })
})

// ===========================================================================
// POST /api/v1/auth/2fa — setup / verify / disable / validate
// ===========================================================================
describe("POST /api/v1/auth/2fa", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "setup" }))
    expect(res.status).toBe(401)
  })

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "setup" }))
    expect(res.status).toBe(404)
  })

  // setup
  it("setup: generates secret, QR code, and backup codes", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needsSetup2fa: true },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "setup" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.secret).toBe("MOCK_SECRET_BASE32")
    expect(json.data.qrCode).toContain("data:image")
    expect(json.data.backupCodes).toHaveLength(8)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", totpEnabled: false },
      data: { totpSecret: "MOCK_SECRET_BASE32" },
    })
  })

  it("setup: blocks a password-only session with an outstanding 2FA challenge", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true, twoFactorMethod: "totp" },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "setup" }))

    expect(res.status).toBe(403)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("setup: never replaces an enabled TOTP factor", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "setup" }))

    expect(res.status).toBe(409)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  // verify
  it("verify: returns 400 when code is missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "verify" }))
    expect(res.status).toBe(400)
  })

  it("verify: returns 400 when totp secret not set", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false, totpSecret: null } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "verify", code: "123456" }))
    expect(res.status).toBe(400)
  })

  it("verify: returns 400 for invalid code", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    vi.mocked(verifySync).mockReturnValue({ valid: false } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "verify", code: "000000" }))
    expect(res.status).toBe(400)
  })

  it("verify: enables 2FA and returns nonce on valid code", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needsSetup2fa: true },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    vi.mocked(verifySync).mockReturnValue({ valid: true } as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "verify", code: "123456" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.twoFactorNonce).toBeDefined()
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totpEnabled: true }) })
    )
    const updateData = vi.mocked(prisma.user.updateMany).mock.calls[0][0].data as any
    expect(updateData.passwordChangedAt).toBeUndefined()
  })

  it("verify: cannot turn enrollment into a bypass while login 2FA is pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true, twoFactorMethod: "sms" },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "verify", code: "123456" }))

    expect(res.status).toBe(403)
    expect(verifySync).not.toHaveBeenCalled()
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  // disable
  it("disable: returns 400 when code is missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "disable" }))
    expect(res.status).toBe(400)
  })

  it("disable: returns 400 when 2FA not enabled", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false, totpSecret: null } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "disable", code: "123456" }))
    expect(res.status).toBe(400)
  })

  it("disable: returns 400 for invalid code", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(verifySync).mockReturnValue({ valid: false } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "disable", code: "999999" }))
    expect(res.status).toBe(400)
  })

  it("disable: disables 2FA on valid code", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(verifySync).mockReturnValue({ valid: true } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "disable", code: "123456" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totpEnabled: false,
          totpSecret: null,
          twoFactorNonce: null,
          passwordChangedAt: expect.any(Date),
        }),
      })
    )
    expect(json.data.reauthenticate).toBe(true)
  })

  it("disable: rejects a session that has not completed its login challenge", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "disable", code: "123456" }))

    expect(res.status).toBe(403)
    expect(verifySync).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  // validate
  it("validate: returns valid true when 2FA not enabled", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false, totpSecret: null } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "validate", code: "123456" }))
    const json = await res.json()
    expect(json.data.valid).toBe(true)
  })

  it("validate: returns valid status based on code check", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(verifySync).mockReturnValue({ valid: true } as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "validate", code: "123456" }))
    const json = await res.json()
    expect(json.data.valid).toBe(true)
  })

  // invalid action
  it("returns 400 for unknown action", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    const res = await twoFaPOST(makeRequest("/api/v1/auth/2fa", "POST", { action: "unknown" }))
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// POST /api/v1/auth/totp/setup
// ===========================================================================
describe("POST /api/v1/auth/totp/setup", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await totpSetupPOST(makeRequest("/api/v1/auth/totp/setup", "POST"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    const res = await totpSetupPOST(makeRequest("/api/v1/auth/totp/setup", "POST"))
    expect(res.status).toBe(404)
  })

  it("returns 400 when 2FA is already enabled", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: true } as any)
    const res = await totpSetupPOST(makeRequest("/api/v1/auth/totp/setup", "POST"))
    expect(res.status).toBe(400)
  })

  it("generates secret and QR code for new setup", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needsSetup2fa: true },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)

    const res = await totpSetupPOST(makeRequest("/api/v1/auth/totp/setup", "POST"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.secret).toBe("MOCK_SECRET_BASE32")
    expect(json.data.qrCode).toContain("data:image")
    expect(json.data.otpauth).toContain("otpauth://totp")
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", totpEnabled: false },
      data: { totpSecret: "MOCK_SECRET_BASE32" },
    })
  })

  it("rejects setup while an existing login factor is still unverified", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true },
    } as any)

    const res = await totpSetupPOST(makeRequest("/api/v1/auth/totp/setup", "POST"))

    expect(res.status).toBe(403)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /api/v1/auth/totp/verify
// ===========================================================================
describe("POST /api/v1/auth/totp/verify", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", { token: "123456" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when token is missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", {}))
    expect(res.status).toBe(400)
  })

  it("returns 400 when TOTP setup not started", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpSecret: null } as any)
    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", { token: "123456" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid token", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    vi.mocked(verifySync).mockReturnValue({ valid: false } as any)
    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", { token: "000000" }))
    expect(res.status).toBe(400)
  })

  it("enables 2FA and returns backup codes and nonce on valid token", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needsSetup2fa: true },
    } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    vi.mocked(verifySync).mockReturnValue({ valid: true } as any)

    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", { token: "123456" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.backupCodes).toBeDefined()
    expect(json.data.twoFactorNonce).toBeDefined()
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totpEnabled: true }) })
    )
    const updateData = vi.mocked(prisma.user.updateMany).mock.calls[0][0].data as any
    // Enrollment must preserve the pending session so its one-time nonce can
    // clear needsSetup2fa; bumping the epoch here would log it out mid-flow.
    expect(updateData.passwordChangedAt).toBeUndefined()
  })

  it("rejects enrollment verification while login 2FA is still pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true },
    } as any)

    const res = await totpVerifyPOST(makeRequest("/api/v1/auth/totp/verify", "POST", { token: "123456" }))

    expect(res.status).toBe(403)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /api/v1/auth/totp/disable
// ===========================================================================
describe("POST /api/v1/auth/totp/disable", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "pass" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when password is missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", {}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "pass" }))
    expect(res.status).toBe(404)
  })

  it("returns 400 when 2FA is not enabled", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false } as any)
    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "pass" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid password", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)
    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "wrong" }))
    expect(res.status).toBe(400)
  })

  it("disables 2FA on valid password", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "correct" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totpEnabled: false, totpSecret: null, backupCodes: [] }),
      })
    )
    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0].data as any
    expect(updateData.twoFactorNonce).toBeNull()
    expect(updateData.passwordChangedAt).toBeInstanceOf(Date)
    expect(json.data.reauthenticate).toBe(true)
  })

  it("does not accept password-only factor disable during a pending challenge", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...mockSession,
      user: { ...mockSession.user, needs2fa: true },
    } as any)

    const res = await totpDisablePOST(makeRequest("/api/v1/auth/totp/disable", "POST", { password: "correct" }))

    expect(res.status).toBe(403)
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// GET /api/v1/auth/totp/status
// ===========================================================================
describe("GET /api/v1/auth/totp/status", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await totpStatusGET()
    expect(res.status).toBe(401)
  })

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    const res = await totpStatusGET()
    expect(res.status).toBe(404)
  })

  it("returns totpEnabled and hasBackupCodes", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpEnabled: true,
      backupCodes: JSON.stringify(["ABCD-1234"]),
    } as any)

    const res = await totpStatusGET()
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.totpEnabled).toBe(true)
    expect(json.data.hasBackupCodes).toBe(true)
  })

  it("returns hasBackupCodes false when backup codes empty", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpEnabled: true,
      backupCodes: [],
    } as any)

    const res = await totpStatusGET()
    const json = await res.json()
    expect(json.data.hasBackupCodes).toBe(false)
  })
})

// ===========================================================================
// POST /api/v1/auth/verify-2fa
// ===========================================================================
describe("POST /api/v1/auth/verify-2fa", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", { code: "123456" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when code is missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", {}))
    expect(res.status).toBe(400)
  })

  it("returns 400 when 2FA not enabled on user", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...mockUser, totpEnabled: false, totpSecret: null } as any)
    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", { code: "123456" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid TOTP code", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(verifySync).mockReturnValue({ valid: false } as any)
    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", { code: "000000" }))
    expect(res.status).toBe(400)
  })

  it("verifies valid TOTP code and returns nonce", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(verifySync).mockReturnValue({ valid: true } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", { code: "123456" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.verified).toBe(true)
    expect(json.data.twoFactorNonce).toBeDefined()
  })

  it("verifies valid backup code and removes it", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser,
      backupCodes: ["ABCD-1234", "EFGH-5678"],
    } as any)
    vi.mocked(verifySync).mockReturnValue({ valid: false } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await verify2faPOST(makeRequest("/api/v1/auth/verify-2fa", "POST", { code: "ABCD1234" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.verified).toBe(true)

    // Should have been called twice: once to remove backup code, once to set nonce
    expect(prisma.user.update).toHaveBeenCalledTimes(2)
  })
})
