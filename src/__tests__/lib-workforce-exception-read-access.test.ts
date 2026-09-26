import { describe, expect, it } from "vitest"
import { authorizeWorkforceExceptionReadCandidates } from "@/lib/workforce/exception-read-access"
import type { WorkforceAccessGrant } from "@/lib/workforce/access-control"

const NOW = new Date("2026-09-26T12:00:00.000Z")

function grant(overrides: Partial<WorkforceAccessGrant>): WorkforceAccessGrant {
  return {
    id: "grant_1",
    organizationId: "org_1",
    principalUserId: "user_1",
    role: "TEAM_MANAGER",
    scope: { kind: "TEAM", teamId: "team_1" },
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    revokedAt: null,
    ...overrides,
  }
}

describe("Workforce exception metadata authorization", () => {
  it("uses historical team scope and never a mutable current-team fallback", () => {
    const result = authorizeWorkforceExceptionReadCandidates({
      organizationId: "org_1",
      principalUserId: "user_1",
      candidates: [
        { id: "case_allowed", agentId: "agent_1", siteId: null },
        { id: "case_denied", agentId: "agent_2", siteId: null },
      ],
      historicalTeamByCaseId: new Map([["case_allowed", "team_1"]]),
      grants: [grant({})],
      now: NOW,
    })

    expect(result.get("case_allowed")).toEqual({ readable: true, decidable: true })
    expect(result.get("case_denied")).toEqual({ readable: false, decidable: false })
  })

  it("allows a persisted site grant for a schedule-only case without inventing team history", () => {
    const result = authorizeWorkforceExceptionReadCandidates({
      organizationId: "org_1",
      principalUserId: "user_1",
      candidates: [{ id: "case_no_show", agentId: "agent_1", siteId: "site_1" }],
      historicalTeamByCaseId: new Map(),
      grants: [grant({ scope: { kind: "SITE", siteId: "site_1" } })],
      now: NOW,
    })

    expect(result.get("case_no_show")).toEqual({ readable: true, decidable: true })
  })

  it("never grants decision authority from read-only roles", () => {
    const result = authorizeWorkforceExceptionReadCandidates({
      organizationId: "org_1",
      principalUserId: "user_1",
      candidates: [{ id: "case_1", agentId: "agent_1", siteId: null }],
      historicalTeamByCaseId: new Map([["case_1", "team_1"]]),
      grants: [grant({ role: "EXPORT_CUSTODIAN", scope: { kind: "TEAM", teamId: "team_1" } })],
      now: NOW,
    })

    expect(result.get("case_1")).toEqual({ readable: false, decidable: false })
  })
})
