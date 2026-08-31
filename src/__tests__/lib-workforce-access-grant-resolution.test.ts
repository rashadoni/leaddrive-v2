import { describe, expect, it, vi } from "vitest"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"

const NOW = new Date("2026-08-31T21:00:00.000Z")
const resource = { organizationId: "org_1", agentId: "agent_1", teamId: "team_1", siteId: "site_1" }

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    organizationId: "org_1",
    principalUserId: "user_1",
    role: "TEAM_MANAGER",
    scopeKind: "TEAM",
    scopeTeamId: "team_1",
    scopeSiteId: null,
    scopeAgentId: null,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    revocation: null,
    ...overrides,
  }
}

function reader(rows: readonly ReturnType<typeof row>[]) {
  return { workforceAccessGrant: { findMany: vi.fn().mockResolvedValue(rows) } }
}

describe("persisted Workforce access-grant resolution", () => {
  it("allows only the scoped manager exception decision and asks for current grants", async () => {
    const db = reader([row()])
    await expect(decidePersistedWorkforceAccess({
      db,
      organizationId: "org_1",
      principalUserId: "user_1",
      selfAgentId: null,
      permission: "TEAM_EXCEPTION_DECIDE",
      resource,
      now: NOW,
    })).resolves.toEqual({ allowed: true, source: "GRANT", grantId: "grant_1" })
    expect(db.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org_1",
        principalUserId: "user_1",
        effectiveFrom: { lte: NOW },
      }),
      take: 201,
    }))
  })

  it("fails closed for a revoked, malformed or scope-widened stored grant", async () => {
    for (const invalid of [
      row({ revocation: { revokedAt: new Date("2026-08-31T20:59:00.000Z") } }),
      row({ scopeKind: "TEAM", scopeTeamId: "team_1", scopeSiteId: "site_1" }),
      row({ scopeKind: "ORGANIZATION", scopeTeamId: "team_1" }),
    ]) {
      await expect(decidePersistedWorkforceAccess({
        db: reader([invalid]),
        organizationId: "org_1",
        principalUserId: "user_1",
        selfAgentId: null,
        permission: "TEAM_EXCEPTION_DECIDE",
        resource,
        now: NOW,
      })).resolves.toEqual({ allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" })
    }
  })

  it("does not turn a large authority set into an arbitrary allow", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => row({ id: `grant_${index}` }))
    await expect(decidePersistedWorkforceAccess({
      db: reader(rows),
      organizationId: "org_1",
      principalUserId: "user_1",
      selfAgentId: null,
      permission: "TEAM_EXCEPTION_DECIDE",
      resource,
      now: NOW,
    })).resolves.toEqual({ allowed: false, code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE" })
  })
})
