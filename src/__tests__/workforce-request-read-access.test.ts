import { describe, expect, it } from "vitest"
import { authorizeWorkforceRequestReadCandidates } from "@/lib/workforce/request-read-access"
import type { WorkforceAccessGrant } from "@/lib/workforce/access-control"

const NOW = new Date("2026-09-01T09:00:00.000Z")

function grant(overrides: Partial<WorkforceAccessGrant> = {}): WorkforceAccessGrant {
  return {
    id: "grant-team-request-read",
    organizationId: "org-workforce",
    principalUserId: "manager-user",
    role: "TEAM_MANAGER",
    scope: { kind: "TEAM", teamId: "team-historical" },
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    revokedAt: null,
    ...overrides,
  }
}

describe("Workforce request historical read authorization", () => {
  it("uses historical team scope and never permits self-decision", () => {
    const access = authorizeWorkforceRequestReadCandidates({
      organizationId: "org-workforce",
      principalUserId: "manager-user",
      selfAgentId: "manager-agent",
      candidates: [
        { id: "leave-team", agentId: "employee-team", type: "LEAVE" },
        { id: "leave-self", agentId: "manager-agent", type: "LEAVE" },
      ],
      historicalTeamByRequestId: new Map([
        ["leave-team", "team-historical"],
        ["leave-self", "team-historical"],
      ]),
      grants: [grant()],
      now: NOW,
    })

    expect(access.get("leave-team")).toEqual({ readable: true, decidable: true })
    expect(access.get("leave-self")).toEqual({ readable: true, decidable: false })
  })

  it("does not substitute current team or generic request authority for a correction", () => {
    const access = authorizeWorkforceRequestReadCandidates({
      organizationId: "org-workforce",
      principalUserId: "manager-user",
      selfAgentId: null,
      candidates: [
        { id: "wrong-team", agentId: "employee-a", type: "ABSENCE" },
        { id: "time-correction", agentId: "employee-b", type: "TIME_CORRECTION" },
        { id: "future-type", agentId: "employee-c", type: "FUTURE_REQUEST_TYPE" },
      ],
      historicalTeamByRequestId: new Map([
        ["wrong-team", "team-current-not-historical"],
        ["time-correction", "team-historical"],
        ["future-type", "team-historical"],
      ]),
      grants: [grant()],
      now: NOW,
    })

    expect(access.get("wrong-team")).toEqual({ readable: false, decidable: false })
    expect(access.get("time-correction")).toEqual({ readable: false, decidable: false })
    expect(access.get("future-type")).toEqual({ readable: false, decidable: false })
  })

  it("keeps correction review with the separate time-approver grant", () => {
    const access = authorizeWorkforceRequestReadCandidates({
      organizationId: "org-workforce",
      principalUserId: "manager-user",
      selfAgentId: null,
      candidates: [{ id: "time-correction", agentId: "employee-a", type: "TIME_CORRECTION" }],
      historicalTeamByRequestId: new Map([["time-correction", "team-historical"]]),
      grants: [grant({
        id: "grant-time-approver",
        role: "TIME_APPROVER",
        scope: { kind: "TEAM", teamId: "team-historical" },
      })],
      now: NOW,
    })

    expect(access.get("time-correction")).toEqual({ readable: true, decidable: true })
  })
})
