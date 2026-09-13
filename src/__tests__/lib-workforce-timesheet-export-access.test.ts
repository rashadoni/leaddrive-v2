import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: vi.fn() } } }))
vi.mock("@/lib/workforce/access-grant-resolution", () => ({ decidePersistedWorkforceAccess: vi.fn() }))
vi.mock("@/lib/workforce/granular-access-rollout", () => ({ workforceGranularAccessEnabled: vi.fn() }))

import { prisma } from "@/lib/prisma"
import type { AuthResult } from "@/lib/api-auth"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { requireWorkforceTimesheetExportAccess } from "@/lib/workforce/timesheet-export-access"

const auth = {
  principalType: "session",
  role: "admin",
  userId: "user-1",
} satisfies Pick<AuthResult, "principalType" | "role" | "userId">

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
})

describe("Workforce approved-timesheet export access", () => {
  it("preserves legacy session-admin access before the explicit grant fence", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(false)
    await expect(requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth, approvalAgentId: "agent-1",
    })).resolves.toBeNull()
    expect(decidePersistedWorkforceAccess).not.toHaveBeenCalled()
  })

  it("denies a non-admin before cutover and every non-session caller", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(false)
    const legacyDenied = await requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth: { ...auth, role: "manager" }, approvalAgentId: "agent-1",
    })
    expect(legacyDenied?.status).toBe(403)
    expect(legacyDenied?.headers.get("cache-control")).toBe("private, no-store")
    const apiKeyDenied = await requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth: { ...auth, principalType: "api_key" }, approvalAgentId: "agent-1",
    })
    expect(apiKeyDenied?.status).toBe(403)
  })

  it("uses the immutable approval employee after cutover with no CRM-admin fallback", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(decidePersistedWorkforceAccess).mockResolvedValue({ allowed: true, source: "GRANT", grantId: "grant-1" })
    await expect(requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth, approvalAgentId: "agent-1",
    })).resolves.toBeNull()
    expect(decidePersistedWorkforceAccess).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      principalUserId: "user-1",
      permission: "TIMESHEET_EXPORT",
      resource: { organizationId: "org-1", agentId: "agent-1" },
    }))

    vi.mocked(decidePersistedWorkforceAccess).mockResolvedValue({
      allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE",
    })
    const denied = await requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth, approvalAgentId: "agent-1",
    })
    expect(denied?.status).toBe(403)
  })

  it("fails closed for a missing subject or authorization lookup failure", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    const missingSubject = await requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth, approvalAgentId: null,
    })
    expect(missingSubject?.status).toBe(403)
    expect(decidePersistedWorkforceAccess).not.toHaveBeenCalled()

    const privateFailure = new Error("private employee approval details")
    vi.mocked(prisma.organization.findUnique).mockRejectedValueOnce(privateFailure)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const unavailable = await requireWorkforceTimesheetExportAccess({
      organizationId: "org-1", auth, approvalAgentId: "agent-1",
    })
    expect(unavailable?.status).toBe(503)
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "review-timesheet-approval-export" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailure.message)
  })
})
