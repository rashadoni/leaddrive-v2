import { describe, expect, it } from "vitest"
import {
  canAssignMtmRouteAgents,
  canCreateMtmRouteFor,
  canEditMtmRoute,
  canEditMtmRouteDraft,
  canPublishMtmRoute,
  canReviewMtmRouteRequest,
  canViewMtmRoute,
  resolveMtmRouteActor,
  type MtmRouteActor,
} from "@/lib/mtm/route-permissions"

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
