import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/workforce/access-grant-resolution", () => ({
  readPersistedWorkforceAccessGrants: vi.fn(),
}))
vi.mock("@/lib/workforce/granular-access-rollout", () => ({
  workforceGranularAccessEnabled: vi.fn(),
}))

import { readPersistedWorkforceAccessGrants } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { requireWorkforceTodayReadAccess } from "@/lib/workforce/today-read-access"

const candidates = [
  { id: "employee-a", teamId: "team-a" },
  { id: "employee-b", teamId: "team-b" },
]
const input = {
  db: {} as never,
  organizationId: "org-workforce",
  organizationFeatures: ["workforce-hrm"],
  principalUserId: "manager-user",
  selfAgentId: null,
  candidates,
}

const teamGrant = {
  id: "grant-team-a",
  organizationId: "org-workforce",
  principalUserId: "manager-user",
  role: "TEAM_MANAGER",
  scope: { kind: "TEAM" as const, teamId: "team-a" },
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveUntil: null,
  revokedAt: null,
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce Today granular read access", () => {
  it("preserves the established route roster before the explicit granular cutover", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(false)

    await expect(requireWorkforceTodayReadAccess(input)).resolves.toEqual({
      agentIds: ["employee-a", "employee-b"],
    })
    expect(readPersistedWorkforceAccessGrants).not.toHaveBeenCalled()
  })

  it("allows a mapped employee only their own current day without a team grant", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(readPersistedWorkforceAccessGrants).mockResolvedValue([])

    await expect(requireWorkforceTodayReadAccess({
      ...input,
      selfAgentId: "employee-a",
    })).resolves.toEqual({ agentIds: ["employee-a"] })
  })

  it("filters the current-day roster with one persisted team-grant snapshot", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(readPersistedWorkforceAccessGrants).mockResolvedValue([teamGrant])

    await expect(requireWorkforceTodayReadAccess(input)).resolves.toEqual({ agentIds: ["employee-a"] })
    expect(readPersistedWorkforceAccessGrants).toHaveBeenCalledTimes(1)
    expect(readPersistedWorkforceAccessGrants).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-workforce",
      principalUserId: "manager-user",
    }))
  })

  it("does not infer a site or current CRM team when no matching persisted grant exists", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(readPersistedWorkforceAccessGrants).mockResolvedValue([{
      ...teamGrant,
      id: "grant-site-a",
      role: "HR_ADMIN",
      scope: { kind: "SITE" as const, siteId: "site-a" },
    }])

    const denied = await requireWorkforceTodayReadAccess(input)
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(403)
    await expect((denied as Response).json()).resolves.toMatchObject({
      code: "WORKFORCE_TODAY_READ_ACCESS_REQUIRED",
    })
  })

  it("returns a generic unavailable result when the persisted-grant lookup is unsafe", async () => {
    vi.mocked(workforceGranularAccessEnabled).mockReturnValue(true)
    vi.mocked(readPersistedWorkforceAccessGrants).mockResolvedValue(null)

    const unavailable = await requireWorkforceTodayReadAccess(input)
    expect(unavailable).toBeInstanceOf(Response)
    expect((unavailable as Response).status).toBe(503)
    await expect((unavailable as Response).json()).resolves.toMatchObject({
      code: "WORKFORCE_TODAY_READ_ACCESS_UNAVAILABLE",
    })
  })
})
