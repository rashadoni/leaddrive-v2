import { describe, expect, it, vi } from "vitest"
import {
  MAX_WORKFORCE_HISTORICAL_TEAM_MEMBERSHIP_CANDIDATES,
  resolveWorkforceHistoricalTeamMemberships,
} from "@/lib/workforce/team-membership"

const STARTED_AT = new Date("2026-09-01T08:00:00.000Z")

describe("Workforce historical team membership batch resolver", () => {
  it("returns explicit nulls for missing history", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([
      { requestId: "request-historical", teamId: "team-at-submission" },
    ])

    const result = await resolveWorkforceHistoricalTeamMemberships(
      { $queryRaw } as never,
      {
        organizationId: "org-workforce",
        candidates: [
          { requestId: "request-historical", agentId: "employee-a", workdayStartedAt: STARTED_AT },
          { requestId: "request-without-history", agentId: "employee-b", workdayStartedAt: STARTED_AT },
        ],
      },
    )

    expect(result).toEqual(new Map([
      ["request-historical", "team-at-submission"],
      ["request-without-history", null],
    ]))
    expect($queryRaw).toHaveBeenCalledTimes(1)
  })

  it("refuses malformed or oversized batches before SQL", async () => {
    const $queryRaw = vi.fn()
    await expect(resolveWorkforceHistoricalTeamMemberships(
      { $queryRaw } as never,
      { organizationId: "org-workforce", candidates: [{ requestId: "", agentId: "employee-a", workdayStartedAt: STARTED_AT }] },
    )).rejects.toThrow("candidate is invalid")
    await expect(resolveWorkforceHistoricalTeamMemberships(
      { $queryRaw } as never,
      {
        organizationId: "org-workforce",
        candidates: Array.from({ length: MAX_WORKFORCE_HISTORICAL_TEAM_MEMBERSHIP_CANDIDATES + 1 }, (_, index) => ({
          requestId: `request-${index}`,
          agentId: "employee-a",
          workdayStartedAt: STARTED_AT,
        })),
      },
    )).rejects.toThrow("batch exceeds the safe limit")
    expect($queryRaw).not.toHaveBeenCalled()
  })
})
