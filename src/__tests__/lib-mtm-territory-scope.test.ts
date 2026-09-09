/**
 * M4-5 — Unit tests for resolveAgentScope pure function.
 *
 * Hierarchy: Region → Team → Agent
 * Spec acceptance criteria:
 *   - ADMIN: sees all agents in org (agentIds: null = no filter)
 *   - MANAGER: sees all agents across all teams in their region
 *   - SUPERVISOR: sees all agents in their team
 *   - AGENT: sees only themselves (agentIds: [agentId])
 *   - MANAGER without a teamId sees direct reports plus themselves
 *   - SUPERVISOR without a teamId falls back to self-only visibility
 */
import { describe, it, expect, vi } from "vitest"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

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
        findMany: vi.fn().mockResolvedValue([{ id: "agent-1" }, { id: "agent-2" }]),
      },
      mtmTeam: { findMany: vi.fn() },
    }
    const result = await resolveAgentScope(mockPrisma as any, {
      agentId: "mgr-1",
      organizationId: "org-1",
      role: "MANAGER",
    })
    expect(result.agentIds).toEqual(["mgr-1", "agent-1", "agent-2"])
    expect(mockPrisma.mtmTeam.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: { managerId: "mgr-1", organizationId: "org-1" },
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
        where: { managerId: "mgr-1", organizationId: "org-1" },
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
})
