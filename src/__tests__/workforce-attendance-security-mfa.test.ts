import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"

const AUTH = { userId: "admin_1", principalType: "session" as const }

describe("Workforce attendance security MFA gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("permits a current admin session only when mandatory MFA has an enrolled factor", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      require2fa: true,
      totpEnabled: true,
      smsAuthEnabled: false,
      verifiedPhone: null,
    } as never)

    await expect(requireWorkforceAttendanceSecurityMfa("org_1", AUTH)).resolves.toBeNull()
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "admin_1", organizationId: "org_1", isActive: true },
      select: {
        require2fa: true,
        totpEnabled: true,
        smsAuthEnabled: true,
        verifiedPhone: true,
      },
    })
  })

  it.each([
    ["MFA is optional", { require2fa: false, totpEnabled: true, smsAuthEnabled: false, verifiedPhone: null }],
    ["no factor is enrolled", { require2fa: true, totpEnabled: false, smsAuthEnabled: false, verifiedPhone: null }],
    ["SMS has no verified phone", { require2fa: true, totpEnabled: false, smsAuthEnabled: true, verifiedPhone: null }],
  ])("fails closed when %s", async (_reason, user) => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(user as never)

    const response = await requireWorkforceAttendanceSecurityMfa("org_1", AUTH)
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({ code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED" })
  })

  it("does not let non-session principals or a lookup failure bypass the MFA gate", async () => {
    const apiKeyResponse = await requireWorkforceAttendanceSecurityMfa("org_1", {
      userId: "key_1",
      principalType: "api_key",
    })
    expect(apiKeyResponse?.status).toBe(403)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()

    const privateFailure = new Error("database unavailable for employee-secret-42")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(prisma.user.findFirst).mockRejectedValue(privateFailure)
    const unavailableResponse = await requireWorkforceAttendanceSecurityMfa("org_1", AUTH)
    expect(unavailableResponse?.status).toBe(503)
    expect(unavailableResponse?.headers.get("cache-control")).toBe("private, no-store")
    await expect(unavailableResponse?.json()).resolves.toMatchObject({
      code: "WORKFORCE_ATTENDANCE_MFA_UNAVAILABLE",
    })
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "verify-attendance-mfa" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailure.message)
  })
})
