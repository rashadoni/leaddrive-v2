/**
 * M4-5 — Unit tests for resolveAgentScope pure function.
 *
 * Hierarchy: Region → Team → Agent
 * Spec acceptance criteria:
 *   - ADMIN: sees all agents in org (agentIds: null = no filter)
 *   - MANAGER: sees all agents across all teams in their region
 *   - SUPERVISOR: sees all agents in their team
 *   - AGENT: sees only themselves (agentIds: [agentId])
 *   - MANAGER additionally sees their reporting-line subtree (managerId,
 *     transitively, depth-limited, cycle-safe) — owner decision 2026-09-14
 *   - MANAGER without a teamId sees their reporting-line subtree plus themselves
 *   - SUPERVISOR without a teamId falls back to self-only visibility
 */
import { describe, it, expect, vi } from "vitest"
import {
  MTM_MANAGER_SUBTREE_MAX_DEPTH,
  resolveAgentScope,
  resolveManagerSubtreeAgentIds,
  resolveTerritoryTeamIds,
} from "@/lib/mtm/territory-scope"

/**
 * In-memory reporting line for subtree tests: `findMany({ where: { managerId: { in } } })`
 * answers from this map, team queries from `teams`.
 */
function orgChart(input: {
  agents: Array<{ id: string; teamId: string | null; managerId: string | null }>
  teams?: Array<{ id: string; regionId: string | null }>
}) {
  const teams = input.teams ?? []
  return {
    mtmAgent: {
      findUnique: vi.fn(async ({ where }: any) => {
        const agent = input.agents.find((row) => row.id === where.id)
        return agent ? { id: agent.id, teamId: agent.teamId } : null
      }),
      findMany: vi.fn(async ({ where }: any) => {
        expect(where.organizationId).toBe("org-1")
        if (where.managerId?.in) {
          return input.agents.filter((row) => row.managerId && where.managerId.in.includes(row.managerId)).map(({ id }) => ({ id }))
        }
        if (where.teamId?.in) return input.agents.filter((row) => row.teamId && where.teamId.in.includes(row.teamId)).map(({ id }) => ({ id }))
        if (typeof where.teamId === "string") return input.agents.filter((row) => row.teamId === where.teamId).map(({ id }) => ({ id }))
        throw new Error(`unexpected agent query ${JSON.stringify(where)}`)
      }),
    },
    mtmTeam: {
      findFirst: vi.fn(async ({ where }: any) => teams.find((team) => team.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => teams.filter((team) => team.regionId === where.regionId).map(({ id }) => ({ id }))),
    },
  }
}

describe("resolveAgentScope (M4-5)", () => {
  // ─── ADMIN ───────────────────────────────────────────────────────────────

  it("ADMIN → agentIds: null (no filter, sees entire org)", async () => {
    const mockPrisma = {
      mtmAgent: { findUnique: vi.fn(), findMany: vi.fn() },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "agent-admin",
      organizationId: "org-1",
      role: "ADMIN",
    })
    expect(result.agentIds).toBeNull()
    // ADMIN resolves immediately — no DB queries needed
    expect(mockPrisma.mtmAgent.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.mtmTeam.findMany).not.toHaveBeenCalled()
  })

  // ─── AGENT ───────────────────────────────────────────────────────────────

  it("AGENT → agentIds: [agentId] (sees only themselves)", async () => {
    const mockPrisma = {
      mtmAgent: { findUnique: vi.fn(), findMany: vi.fn() },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "agent-7",
      organizationId: "org-1",
      role: "AGENT",
    })
    expect(result.agentIds).toEqual(["agent-7"])
    expect(mockPrisma.mtmAgent.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  // ─── SUPERVISOR ──────────────────────────────────────────────────────────

  it("SUPERVISOR with teamId → all agents in that team (including self)", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "super-1", teamId: "team-A", organizationId: "org-1" }),
        findMany: vi.fn().mockResolvedValue([
          { id: "agent-1" },
          { id: "agent-2" },
          { id: "super-1" },
        ]),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "super-1",
      organizationId: "org-1",
      role: "SUPERVISOR",
    })
    expect(result.agentIds).toEqual(["agent-1", "agent-2", "super-1"])

    // Verifies the DB query is org-scoped (multi-tenant safety)
    const callArgs = mockPrisma.mtmAgent.findMany.mock.calls[0][0]
    expect(callArgs.where).toMatchObject({ teamId: "team-A", organizationId: "org-1" })
    expect(mockPrisma.mtmTeam.findMany).not.toHaveBeenCalled()
  })

  it("SUPERVISOR without teamId → agentIds: [agentId] (graceful fallback)", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "super-1", teamId: null, organizationId: "org-1" }),
        findMany: vi.fn(),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "super-1",
      organizationId: "org-1",
      role: "SUPERVISOR",
    })
    expect(result.agentIds).toEqual(["super-1"])
    expect(mockPrisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("SUPERVISOR with teamId but empty team → agentIds: [] (empty team is valid)", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "super-1", teamId: "team-empty", organizationId: "org-1" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "super-1",
      organizationId: "org-1",
      role: "SUPERVISOR",
    })
    // Edge case: team exists but has no agents loaded — include self at minimum
    expect(result.agentIds).toEqual(["super-1"])
  })

  // ─── MANAGER ─────────────────────────────────────────────────────────────

  it("MANAGER → all agents across all teams in same region", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "mgr-1", teamId: "team-A", organizationId: "org-1" }),
        findMany: vi.fn().mockResolvedValue([
          { id: "agent-1" },
          { id: "agent-2" },
          { id: "agent-3" },
          { id: "mgr-1" },
        ]),
      },
      mtmTeam: {
        // Step 1: findFirst to get manager's team + regionId
        findFirst: vi.fn().mockResolvedValue({ id: "team-A", regionId: "region-North" }),
        // Step 2: findMany to get all teams in that region
        findMany: vi.fn().mockResolvedValue([{ id: "team-A" }, { id: "team-B" }]),
      },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "mgr-1",
      organizationId: "org-1",
      role: "MANAGER",
    })
    expect(result.agentIds).toEqual(["agent-1", "agent-2", "agent-3", "mgr-1"])

    // Verify agent query is scoped to both teams (multi-team region)
    const agentFindArgs = mockPrisma.mtmAgent.findMany.mock.calls[0][0]
    expect(agentFindArgs.where.teamId.in).toContain("team-A")
    expect(agentFindArgs.where.teamId.in).toContain("team-B")
    expect(agentFindArgs.where.organizationId).toBe("org-1")
  })

  it("MANAGER without teamId → direct reports plus manager", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "mgr-1", teamId: null, organizationId: "org-1" }),
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "agent-1" }, { id: "agent-2" }])
          .mockResolvedValue([]),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "mgr-1",
      organizationId: "org-1",
      role: "MANAGER",
    })
    expect(result.agentIds).toEqual(["agent-1", "agent-2", "mgr-1"])
    expect(mockPrisma.mtmTeam.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: { managerId: { in: ["mgr-1"] }, organizationId: "org-1" },
      select: { id: true },
    })
  })

  it("MANAGER direct-report fallback never crosses tenant boundaries", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "mgr-1", teamId: null, organizationId: "org-1" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      mtmTeam: { findMany: vi.fn() },
    }

    await resolveAgentScope(mockPrisma as any, {
      agentId: "mgr-1",
      organizationId: "org-1",
      role: "MANAGER",
    })

    expect(mockPrisma.mtmAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { managerId: { in: ["mgr-1"] }, organizationId: "org-1" },
      }),
    )
  })

  it("MANAGER whose team has no region → falls back to team scope", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "mgr-1", teamId: "team-A", organizationId: "org-1" }),
        findMany: vi.fn().mockResolvedValue([{ id: "agent-1" }, { id: "mgr-1" }]),
      },
      mtmTeam: {
        // findFirst returns team with no regionId
        findFirst: vi.fn().mockResolvedValue({ id: "team-A", regionId: null }),
        // findMany should NOT be called — no region expansion
        findMany: vi.fn(),
      },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "mgr-1",
      organizationId: "org-1",
      role: "MANAGER",
    })
    expect(result.agentIds).toEqual(["agent-1", "mgr-1"])
    // findFirst called once to get manager's team; findMany not called (no region)
    expect(mockPrisma.mtmTeam.findFirst).toHaveBeenCalledTimes(1)
    expect(mockPrisma.mtmTeam.findMany).not.toHaveBeenCalled()
  })

  // ─── Multi-tenant isolation ───────────────────────────────────────────────

  it("All DB queries include organizationId for multi-tenant isolation", async () => {
    const mockPrisma = {
      mtmAgent: {
        findUnique: vi.fn().mockResolvedValue({ id: "super-1", teamId: "team-A", organizationId: "org-42" }),
        findMany: vi.fn().mockResolvedValue([{ id: "super-1" }]),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    await resolveAgentScope(mockPrisma as any, {
      agentId: "super-1",
      organizationId: "org-42",
      role: "SUPERVISOR",
    })
    expect(mockPrisma.mtmAgent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "super-1", organizationId: "org-42" }) })
    )
    expect(mockPrisma.mtmAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-42" }) })
    )
  })

  // ─── MANAGER: territory ∪ reporting line ∪ self (owner decision 2026-09-14) ──

  describe("MANAGER scope is territory plus reporting line", () => {
    it("keeps a direct report who sits in another team", async () => {
      const prisma = orgChart({
        teams: [{ id: "team-A", regionId: null }, { id: "team-B", regionId: null }],
        agents: [
          { id: "mgr-1", teamId: "team-A", managerId: null },
          { id: "a-team-A", teamId: "team-A", managerId: null },
          { id: "report-in-B", teamId: "team-B", managerId: "mgr-1" },
          { id: "stranger-in-B", teamId: "team-B", managerId: null },
        ],
      })
      const result = await resolveAgentScope(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })
      expect(new Set(result.agentIds)).toEqual(new Set(["mgr-1", "a-team-A", "report-in-B"]))
      expect(result.agentIds).not.toContain("stranger-in-B")
    })

    it("follows the reporting line transitively for a manager without a team", async () => {
      const prisma = orgChart({
        agents: [
          { id: "mgr-1", teamId: null, managerId: null },
          { id: "sup-1", teamId: "team-X", managerId: "mgr-1" },
          { id: "agent-under-sup", teamId: "team-Y", managerId: "sup-1" },
          { id: "unrelated", teamId: "team-X", managerId: null },
        ],
      })
      const result = await resolveAgentScope(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })
      expect(new Set(result.agentIds)).toEqual(new Set(["mgr-1", "sup-1", "agent-under-sup"]))
    })

    it("a region manager sees every team of the region plus reports elsewhere", async () => {
      const prisma = orgChart({
        teams: [
          { id: "team-A", regionId: "north" },
          { id: "team-B", regionId: "north" },
          { id: "team-C", regionId: "south" },
        ],
        agents: [
          { id: "mgr-1", teamId: "team-A", managerId: null },
          { id: "a1", teamId: "team-A", managerId: null },
          { id: "b1", teamId: "team-B", managerId: null },
          { id: "c1", teamId: "team-C", managerId: null },
          { id: "c2", teamId: "team-C", managerId: "mgr-1" },
        ],
      })
      const result = await resolveAgentScope(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })
      expect(new Set(result.agentIds)).toEqual(new Set(["mgr-1", "a1", "b1", "c2"]))
      expect(result.agentIds).not.toContain("c1")
    })

    it("terminates on a managerId cycle and never repeats an id", async () => {
      const prisma = orgChart({
        agents: [
          { id: "mgr-1", teamId: null, managerId: "agent-b" },
          { id: "agent-a", teamId: null, managerId: "mgr-1" },
          { id: "agent-b", teamId: null, managerId: "agent-a" },
        ],
      })
      const result = await resolveAgentScope(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })
      expect(result.agentIds).toHaveLength(3)
      expect(new Set(result.agentIds)).toEqual(new Set(["mgr-1", "agent-a", "agent-b"]))
      expect(prisma.mtmAgent.findMany.mock.calls.length).toBeLessThanOrEqual(MTM_MANAGER_SUBTREE_MAX_DEPTH)
    })

    it("stops at the depth limit", async () => {
      const chain = Array.from({ length: MTM_MANAGER_SUBTREE_MAX_DEPTH + 3 }, (_, index) => ({
        id: `level-${index}`,
        teamId: null,
        managerId: index === 0 ? null : `level-${index - 1}`,
      }))
      const prisma = orgChart({ agents: chain })
      const ids = await resolveManagerSubtreeAgentIds(prisma as any, { agentId: "level-0", organizationId: "org-1" })
      expect(ids).toHaveLength(MTM_MANAGER_SUBTREE_MAX_DEPTH)
      expect(ids).not.toContain(`level-${MTM_MANAGER_SUBTREE_MAX_DEPTH + 1}`)
    })

    it("does not widen a supervisor through the reporting line", async () => {
      const prisma = orgChart({
        agents: [
          { id: "sup-1", teamId: "team-A", managerId: null },
          { id: "a1", teamId: "team-A", managerId: null },
          { id: "report-in-B", teamId: "team-B", managerId: "sup-1" },
        ],
      })
      const result = await resolveAgentScope(prisma as any, { agentId: "sup-1", organizationId: "org-1", role: "SUPERVISOR" })
      expect(new Set(result.agentIds)).toEqual(new Set(["sup-1", "a1"]))
    })
  })

  describe("resolveTerritoryTeamIds", () => {
    it("returns the region's teams for a manager and only the own team for a supervisor", async () => {
      const prisma = orgChart({
        teams: [{ id: "team-A", regionId: "north" }, { id: "team-B", regionId: "north" }, { id: "team-C", regionId: "south" }],
        agents: [
          { id: "mgr-1", teamId: "team-A", managerId: null },
          { id: "sup-1", teamId: "team-B", managerId: null },
        ],
      })
      expect(new Set(await resolveTerritoryTeamIds(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })))
        .toEqual(new Set(["team-A", "team-B"]))
      expect(await resolveTerritoryTeamIds(prisma as any, { agentId: "sup-1", organizationId: "org-1", role: "SUPERVISOR" }))
        .toEqual(["team-B"])
    })

    it("gives a manager without a team no territory teams, whatever their reporting line", async () => {
      const prisma = orgChart({ agents: [{ id: "mgr-1", teamId: null, managerId: null }] })
      expect(await resolveTerritoryTeamIds(prisma as any, { agentId: "mgr-1", organizationId: "org-1", role: "MANAGER" })).toEqual([])
    })
  })
})
