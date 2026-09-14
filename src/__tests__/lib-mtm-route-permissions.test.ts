import { describe, expect, it, vi } from "vitest"
import {
  canAssignMtmRouteAgents,
  canCreateMtmRouteFor,
  canEditMtmRoute,
  canEditMtmRouteDraft,
  canPublishMtmRoute,
  canReviewMtmRouteRequest,
  canViewMtmRoute,
  canWriteMtmVisitPolicyTeam,
  resolveMtmRouteActor,
  resolveMtmVisitPolicyAccess,
  type MtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { fieldScopeForActor } from "@/lib/mtm/field-access"

const agent: MtmRouteActor = {
  agentId: "agent-1",
  role: "AGENT",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: true,
  scopedAgentIds: ["agent-1"],
}

const manager: MtmRouteActor = {
  agentId: "manager-1",
  role: "MANAGER",
  canPlanOwnRoutes: true,
  scopedAgentIds: ["manager-1", "agent-1", "agent-2"],
}

const admin: MtmRouteActor = {
  agentId: null,
  role: "ADMIN",
  canPlanOwnRoutes: true,
  scopedAgentIds: null,
}

describe("MTM route permissions", () => {
  it("limits an agent to assigned routes and their own draft", () => {
    expect(canViewMtmRoute(agent, { primaryAgentId: "agent-2", assignedAgentIds: ["agent-1"] })).toBe(true)
    expect(canViewMtmRoute(agent, { primaryAgentId: "agent-2" })).toBe(false)
    expect(canCreateMtmRouteFor(agent, "agent-1")).toBe(true)
    expect(canCreateMtmRouteFor(agent, "agent-2")).toBe(false)
    expect(canEditMtmRouteDraft(agent, { primaryAgentId: "agent-1", status: "DRAFT" })).toBe(true)
    expect(canEditMtmRouteDraft(agent, { primaryAgentId: "agent-1", status: "PLANNED" })).toBe(false)
    expect(canEditMtmRoute(agent, { primaryAgentId: "agent-1", status: "IN_PROGRESS" })).toBe(false)
  })

  it("allows a manager to work only inside resolved territory scope", () => {
    expect(canCreateMtmRouteFor(manager, "agent-2")).toBe(true)
    expect(canCreateMtmRouteFor(manager, "agent-outside")).toBe(false)
    expect(canEditMtmRouteDraft(manager, { primaryAgentId: "agent-2", status: "DRAFT" })).toBe(true)
    expect(canEditMtmRouteDraft(manager, { primaryAgentId: "agent-outside", status: "DRAFT" })).toBe(false)
    expect(canEditMtmRoute(manager, { primaryAgentId: "agent-2", status: "PLANNED" })).toBe(true)
    expect(canEditMtmRoute(manager, { primaryAgentId: "agent-2", status: "IN_PROGRESS" })).toBe(true)
    expect(canEditMtmRoute(manager, { primaryAgentId: "agent-2", status: "COMPLETED" })).toBe(false)
    expect(canEditMtmRoute(manager, { primaryAgentId: "agent-outside", status: "PLANNED" })).toBe(false)
    expect(canAssignMtmRouteAgents(manager, "agent-1", ["agent-2"])).toBe(true)
    expect(canAssignMtmRouteAgents(manager, "agent-1", ["agent-outside"])).toBe(false)
  })

  it("does not allow agents to assign a multi-agent route", () => {
    expect(canAssignMtmRouteAgents(agent, "agent-1", ["agent-2"])).toBe(false)
    expect(canAssignMtmRouteAgents(agent, "agent-1", [])).toBe(true)
  })

  it("honours an agent-level block on planning their own route drafts", () => {
    const blockedAgent: MtmRouteActor = { ...agent, canPlanOwnRoutes: false }
    expect(canCreateMtmRouteFor(blockedAgent, "agent-1")).toBe(false)
    expect(canEditMtmRouteDraft(blockedAgent, { primaryAgentId: "agent-1", status: "DRAFT" })).toBe(false)
    expect(canAssignMtmRouteAgents(blockedAgent, "agent-1", [])).toBe(false)
    expect(canPublishMtmRoute(blockedAgent, { primaryAgentId: "agent-1", status: "DRAFT" }, true)).toBe(false)
  })

  it("keeps agent self-publish configurable while manager scope can publish", () => {
    const ownDraft = { primaryAgentId: "agent-1", status: "DRAFT" as const }
    expect(canPublishMtmRoute(agent, ownDraft, false)).toBe(false)
    expect(canPublishMtmRoute(agent, ownDraft, true)).toBe(true)
    expect(canPublishMtmRoute({ ...agent, canSelfPublishRoutes: false }, ownDraft, true)).toBe(false)
    expect(canPublishMtmRoute({ ...agent, canSelfPublishRoutes: undefined }, ownDraft, true)).toBe(false)
    expect(canPublishMtmRoute(manager, ownDraft, false)).toBe(true)
    expect(canPublishMtmRoute(admin, { primaryAgentId: "outside", status: "DRAFT" }, false)).toBe(true)
  })

  it("prevents self-approval and requires manager scope", () => {
    expect(canReviewMtmRouteRequest(manager, "agent-1")).toBe(true)
    expect(canReviewMtmRouteRequest(manager, "manager-1")).toBe(false)
    expect(canReviewMtmRouteRequest(manager, "agent-outside")).toBe(false)
    expect(canReviewMtmRouteRequest(agent, "agent-1")).toBe(false)
  })

  it("grants administrators organization-wide access", () => {
    expect(canCreateMtmRouteFor(admin, "any-agent")).toBe(true)
    expect(canAssignMtmRouteAgents(admin, "agent-1", ["agent-outside"])).toBe(true)
    expect(canReviewMtmRouteRequest(admin, "agent-outside")).toBe(true)
    expect(canEditMtmRoute(admin, { primaryAgentId: "agent-outside", status: "PLANNED" })).toBe(true)
  })

  it("resolves web administrators without an MTM agent row", async () => {
    const prisma = { mtmAgent: { findFirst: () => { throw new Error("should not query") } } }
    await expect(resolveMtmRouteActor(prisma as any, {
      organizationId: "org-1",
      userId: "admin-user",
      webRole: "admin",
    })).resolves.toEqual({
      agentId: null,
      role: "ADMIN",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
      scopedAgentIds: null,
    })
  })

  it("resolves a linked field agent to self scope", async () => {
    const prisma = {
      mtmAgent: {
        findFirst: async () => ({
          id: "agent-1",
          role: "AGENT",
          canPlanOwnRoutes: true,
          canSelfPublishRoutes: true,
        }),
      },
      mtmTeam: {},
    }
    await expect(resolveMtmRouteActor(prisma as any, {
      organizationId: "org-1",
      userId: "user-1",
      webRole: "sales",
    })).resolves.toEqual({
      agentId: "agent-1",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
      scopedAgentIds: ["agent-1"],
    })
  })

  it("resolves a mobile principal by the verified JWT agent id", async () => {
    let where: unknown
    const prisma = {
      mtmAgent: {
        findFirst: async (args: { where: unknown }) => {
          where = args.where
          return {
            id: "agent-mobile",
            role: "AGENT",
            canPlanOwnRoutes: false,
            canSelfPublishRoutes: false,
          }
        },
      },
      mtmTeam: {},
    }
    await expect(resolveMtmRouteActor(prisma as any, {
      organizationId: "org-1",
      userId: "",
      webRole: "AGENT",
      agentId: "agent-mobile",
    })).resolves.toEqual({
      agentId: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: false,
      canSelfPublishRoutes: false,
      scopedAgentIds: ["agent-mobile"],
    })
    expect(where).toEqual({ organizationId: "org-1", id: "agent-mobile", status: "ACTIVE" })
  })

  it("denies a non-admin web user without a linked active MTM agent", async () => {
    const prisma = {
      mtmAgent: { findFirst: async () => null },
      mtmTeam: {},
    }
    await expect(resolveMtmRouteActor(prisma as any, {
      organizationId: "org-1",
      userId: "user-without-agent",
      webRole: "manager",
    })).resolves.toBeNull()
  })
})

describe("MTM actor lookup is deterministic (audit 2026-09-14)", () => {
  const card = { id: "agent-old", role: "MANAGER", canPlanOwnRoutes: true, canSelfPublishRoutes: false }

  function prismaWith(activeCards: number) {
    return {
      mtmAgent: {
        findFirst: vi.fn().mockResolvedValue(card),
        findUnique: vi.fn().mockResolvedValue({ id: "agent-old", teamId: null }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(activeCards),
      },
      mtmTeam: { findFirst: vi.fn(), findMany: vi.fn() },
    }
  }

  it("picks the oldest ACTIVE card for a web user and warns about duplicates", async () => {
    const prisma = prismaWith(2)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const actor = await resolveMtmRouteActor(prisma as any, { organizationId: "org-1", userId: "user-1", webRole: "manager" })
      expect(actor?.agentId).toBe("agent-old")
      expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: "org-1", userId: "user-1", status: "ACTIVE" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }))
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("several ACTIVE agent cards"),
        expect.objectContaining({ userId: "user-1", activeCards: 2, chosenAgentId: "agent-old" }),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("stays quiet for a single card and does not count for a token-bound agent", async () => {
    const single = prismaWith(1)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await resolveMtmRouteActor(single as any, { organizationId: "org-1", userId: "user-1", webRole: "manager" })
      expect(warn).not.toHaveBeenCalled()

      const token = prismaWith(5)
      await resolveMtmRouteActor(token as any, { organizationId: "org-1", userId: "user-1", webRole: "sales", agentId: "agent-old" })
      expect(token.mtmAgent.count).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("never lets a failed duplicate count change the answer", async () => {
    const prisma = prismaWith(0)
    prisma.mtmAgent.count.mockRejectedValue(new Error("db down"))
    const actor = await resolveMtmRouteActor(prisma as any, { organizationId: "org-1", userId: "user-1", webRole: "manager" })
    expect(actor?.role).toBe("MANAGER")
  })
})

describe("field scope for list endpoints", () => {
  it("maps actors to organization, bounded or no scope", () => {
    expect(fieldScopeForActor(admin).kind).toBe("organization")
    expect(fieldScopeForActor(agent)).toMatchObject({ kind: "agents", agentIds: ["agent-1"] })
    expect(fieldScopeForActor(manager)).toMatchObject({ kind: "agents", agentIds: ["manager-1", "agent-1", "agent-2"] })
    expect(fieldScopeForActor(null).kind).toBe("none")
    // A bounded role with the tenant-wide sentinel fails closed.
    expect(fieldScopeForActor({ ...manager, scopedAgentIds: null }).kind).toBe("none")
  })
})

describe("visit policy write rules", () => {
  it("admins write any team and org-wide rules; managers only their teams; supervisors nothing", async () => {
    expect(canWriteMtmVisitPolicyTeam({ kind: "admin" }, null)).toBe(true)
    const managerAccess = { kind: "manager" as const, actor: manager, readableTeamIds: ["team-A", "team-B"], writableTeamIds: ["team-A"] }
    expect(canWriteMtmVisitPolicyTeam(managerAccess, "team-A")).toBe(true)
    expect(canWriteMtmVisitPolicyTeam(managerAccess, "team-B")).toBe(false)
    expect(canWriteMtmVisitPolicyTeam(managerAccess, null)).toBe(false)
    const supervisorAccess = { kind: "supervisor" as const, actor: manager, readableTeamIds: ["team-A"], writableTeamIds: [] }
    expect(canWriteMtmVisitPolicyTeam(supervisorAccess, "team-A")).toBe(false)
    expect(canWriteMtmVisitPolicyTeam({ kind: "none", reason: "role" }, "team-A")).toBe(false)
  })

  it("resolves an MTM ADMIN card behind a non-admin web role to full access", async () => {
    const prisma = {
      mtmAgent: {
        findFirst: vi.fn().mockResolvedValue({ id: "a-1", role: "ADMIN", canPlanOwnRoutes: true, canSelfPublishRoutes: true }),
        count: vi.fn().mockResolvedValue(1),
      },
      mtmTeam: {},
    }
    expect(await resolveMtmVisitPolicyAccess(prisma as any, { organizationId: "org-1", userId: "u", webRole: "sales" }))
      .toEqual({ kind: "admin" })
  })
})
