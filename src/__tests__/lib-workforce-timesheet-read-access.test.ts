import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/workforce/access-grant-resolution", () => ({
  decidePersistedWorkforceAccess: vi.fn(),
}))
vi.mock("@/lib/workforce/granular-access-rollout", () => ({
  workforceGranularAccessEnabled: vi.fn(),
}))

import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { requireWorkforceTimesheetReadAccess } from "@/lib/workforce/timesheet-read-access"

const input = {
  db: {} as never,
  organizationId: "org-workforce",
  organizationFeatures: ["workforce-hrm"],
  principalUserId: "manager-user",
  selfAgentId: "manager-agent",
  selectedAgentId: "employee-1",
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce timesheet granular read access", () => {
  it("preserves the established actor boundary before the explicit granular cutover", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(false)

    await expect(requireWorkforceTimesheetReadAccess(input)).resolves.toBeNull()
    expect(decidePersistedWorkforceAccess).not.toHaveBeenCalled()
  })

  it("allows an employee only their exact selected timesheet without a grant", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)

    await expect(requireWorkforceTimesheetReadAccess({
      ...input,
      selfAgentId: "employee-1",
    })).resolves.toBeNull()
    expect(decidePersistedWorkforceAccess).not.toHaveBeenCalled()
  })

  it("requires TEAM_ATTENDANCE_READ for another selected employee and never infers a current team/site", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(decidePersistedWorkforceAccess).mockResolvedValue({ allowed: true, source: "GRANT", grantId: "grant-1" })

    await expect(requireWorkforceTimesheetReadAccess(input)).resolves.toBeNull()
    expect(decidePersistedWorkforceAccess).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-workforce",
      principalUserId: "manager-user",
      selfAgentId: null,
      permission: "TEAM_ATTENDANCE_READ",
      resource: { organizationId: "org-workforce", agentId: "employee-1" },
    }))
  })

  it("requires an organization grant for the all-personnel grid and fails closed otherwise", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(decidePersistedWorkforceAccess).mockResolvedValue({
      allowed: false,
      code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE",
    })

    const denied = await requireWorkforceTimesheetReadAccess({ ...input, selectedAgentId: null })
    expect(denied?.status).toBe(403)
    expect(decidePersistedWorkforceAccess).toHaveBeenCalledWith(expect.objectContaining({
      resource: { organizationId: "org-workforce" },
    }))
  })

  it("returns a generic unavailable result when persisted grant resolution fails", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(decidePersistedWorkforceAccess).mockRejectedValue(new Error("database unavailable"))

    const unavailable = await requireWorkforceTimesheetReadAccess(input)
    expect(unavailable?.status).toBe(503)
    await expect(unavailable?.json()).resolves.toMatchObject({
      code: "WORKFORCE_TIMESHEET_READ_ACCESS_UNAVAILABLE",
    })
  })
})
