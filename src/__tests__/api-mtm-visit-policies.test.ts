import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { GET as listPolicies, POST as createPolicy } from "@/app/api/v1/mtm/visit-policies/route"
import { PUT as updatePolicy, DELETE as deactivatePolicy } from "@/app/api/v1/mtm/visit-policies/[id]/route"
import { POST as previewPolicy } from "@/app/api/v1/mtm/visit-policies/preview/route"
import { POST as createActionResult } from "@/app/api/v1/mtm/visits/[id]/actions/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const auth = { orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }

function request(path: string, body: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
})

describe("visit policy API", () => {
  it("blocks policy writes when the rollout flag is disabled", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "visitPoliciesEnabled", value: false }] as never)

    const response = await createPolicy(request("/api/v1/mtm/visit-policies", {
      name: "Disabled policy",
      visitType: "DOCTOR_VISIT",
      priority: 100,
      effectiveFrom: "2026-07-13T00:00:00.000Z",
      isActive: true,
      actions: [],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_POLICIES_DISABLED" })
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("rejects an overlapping active policy at the same scope and priority", async () => {
    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValue({ id: "policy-existing", name: "Existing" } as never)
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", {
      name: "Medical representatives",
      teamId: null,
      visitType: "DOCTOR_VISIT",
      priority: 100,
      effectiveFrom: "2026-07-13T00:00:00.000Z",
      effectiveTo: null,
      isActive: true,
      actions: [],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_POLICY_WINDOW_CONFLICT" })
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("previews the same resolved rule used by check-in", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", category: "A", objectType: "DOCTOR" } as never)
    vi.mocked(prisma.mtmVisitPolicy.findMany).mockResolvedValue([{
      id: "policy-1",
      name: "Doctor visits",
      teamId: "team-1",
      visitType: "DOCTOR_VISIT",
      priority: 10,
      effectiveFrom: new Date("2026-01-01"),
      actions: [{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1, conditions: null, allowWaiver: false }],
    }] as never)

    const response = await previewPolicy(request("/api/v1/mtm/visit-policies/preview", {
      agentId: "agent-1",
      customerId: "customer-1",
      visitType: "DOCTOR_VISIT",
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.sourcePolicyId).toBe("policy-1")
    expect(body.data.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionKey: "PRESENTATION", mode: "REQUIRED" }),
    ]))
  })
})

describe("visit action API", () => {
  it("rejects a hidden action even when called directly", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      status: "CHECKED_IN",
      participants: [],
      requirementSnapshot: {
        id: "snapshot-1",
        sourcePolicyId: "policy-1",
        resolvedAt: new Date(),
        requirements: [{ id: "requirement-1", actionKey: "PRESENTATION", mode: "HIDDEN", allowWaiver: false }],
      },
      actionResults: [],
    } as never)

    const response = await createActionResult(
      request("/api/v1/mtm/visits/visit-1/actions", { actionKey: "PRESENTATION", status: "COMPLETED" }),
      { params: Promise.resolve({ id: "visit-1" }) },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_ACTION_HIDDEN" })
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })
})

// ─── Who may see and change which rules (scope audit 2026-09-14) ─────────────

type Card = { id: string; userId: string | null; role: string; teamId: string | null; managerId: string | null }

/**
 * team-A (no region): mgr-1 (MANAGER) and agent-a1; team-B: sup-b (SUPERVISOR),
 * agent-b1, and report-b2 who reports to mgr-1 across teams.
 */
const CARDS: Card[] = [
  { id: "mgr-1", userId: "manager-user", role: "MANAGER", teamId: "team-A", managerId: null },
  { id: "agent-a1", userId: null, role: "AGENT", teamId: "team-A", managerId: null },
  { id: "sup-b", userId: "supervisor-user", role: "SUPERVISOR", teamId: "team-B", managerId: null },
  { id: "agent-b1", userId: "agent-user", role: "AGENT", teamId: "team-B", managerId: null },
  { id: "report-b2", userId: null, role: "AGENT", teamId: "team-B", managerId: "mgr-1" },
]
const TEAMS = [{ id: "team-A", regionId: null }, { id: "team-B", regionId: null }]

function asUser(userId: string, role: string) {
  vi.mocked(requireAuth).mockResolvedValue({ ...auth, userId, role } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async ({ where }: any) => {
    const card = where.userId !== undefined
      ? CARDS.find((row) => row.userId === where.userId)
      : CARDS.find((row) => row.id === where.id)
    return card ? { ...card, canPlanOwnRoutes: true, canSelfPublishRoutes: false } : null
  }) as never)
  vi.mocked(prisma.mtmAgent.findUnique).mockImplementation((async ({ where }: any) => {
    const card = CARDS.find((row) => row.id === where.id)
    return card ? { id: card.id, teamId: card.teamId } : null
  }) as never)
  vi.mocked(prisma.mtmAgent.findMany).mockImplementation((async ({ where, select }: any) => {
    let rows = CARDS
    if (where.managerId?.in) rows = rows.filter((row) => row.managerId && where.managerId.in.includes(row.managerId))
    else if (typeof where.teamId === "string") rows = rows.filter((row) => row.teamId === where.teamId)
    else if (where.teamId?.in) rows = rows.filter((row) => row.teamId && where.teamId.in.includes(row.teamId))
    if (where.id?.in) rows = rows.filter((row) => where.id.in.includes(row.id))
    if (where.teamId && typeof where.teamId === "object" && "not" in where.teamId) rows = rows.filter((row) => row.teamId !== null)
    return rows.map((row) => (select?.teamId ? { teamId: row.teamId } : { id: row.id }))
  }) as never)
  vi.mocked(prisma.mtmTeam.findFirst).mockImplementation((async ({ where }: any) => TEAMS.find((team) => team.id === where.id) ?? null) as never)
  vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([] as never)
}

const policyBody = (teamId: string | null) => ({
  name: "Team rule",
  teamId,
  visitType: "DOCTOR_VISIT",
  priority: 100,
  effectiveFrom: "2026-07-13T00:00:00.000Z",
  effectiveTo: null,
  isActive: true,
  actions: [],
})

function put(id: string, body: unknown) {
  return updatePolicy(
    new NextRequest(new URL(`/api/v1/mtm/visit-policies/${id}`, "http://localhost:3000"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

function del(id: string) {
  return deactivatePolicy(
    new NextRequest(new URL(`/api/v1/mtm/visit-policies/${id}`, "http://localhost:3000"), { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  )
}

describe("visit policy access by role", () => {
  beforeEach(() => {
    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmVisitPolicy.create).mockResolvedValue({ id: "policy-new" } as never)
    vi.mocked(prisma.mtmVisitPolicy.findMany).mockResolvedValue([] as never)
  })

  it("lets an administrator create an organization-wide rule", async () => {
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", policyBody(null)))
    expect(response.status).toBe(201)
    expect(prisma.mtmVisitPolicy.create).toHaveBeenCalled()
  })

  it("refuses an organization-wide rule from a manager", async () => {
    asUser("manager-user", "manager")
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", policyBody(null)))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_POLICY_SCOPE_FORBIDDEN" })
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("lets a manager create a rule for their own team", async () => {
    asUser("manager-user", "manager")
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", policyBody("team-A")))
    expect(response.status).toBe(201)
  })

  it("refuses a manager a rule for a team they only reach through one direct report", async () => {
    asUser("manager-user", "manager")
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", policyBody("team-B")))
    expect(response.status).toBe(403)
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("refuses a manager changing another team's rule or widening their own to the organization", async () => {
    asUser("manager-user", "manager")
    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValueOnce({ id: "policy-b", teamId: "team-B", actions: [] } as never)
    const other = await put("policy-b", { name: "Changed" })
    expect(other.status).toBe(403)

    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValueOnce({ id: "policy-a", teamId: "team-A", actions: [] } as never)
    const widened = await put("policy-a", { teamId: null })
    expect(widened.status).toBe(403)

    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValueOnce({ id: "policy-b", teamId: "team-B", actions: [] } as never)
    const deactivated = await del("policy-b")
    expect(deactivated.status).toBe(403)
    expect(prisma.mtmVisitPolicy.update).not.toHaveBeenCalled()
  })

  it("shows a manager the org-wide rules and the rules of every team their agents sit in", async () => {
    asUser("manager-user", "manager")
    const response = await listPolicies(new NextRequest(new URL("/api/v1/mtm/visit-policies", "http://localhost:3000")))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.access).toEqual({ canWriteOrganizationWide: false, writableTeamIds: ["team-A"] })
    const where = (vi.mocked(prisma.mtmVisitPolicy.findMany).mock.calls[0][0] as any).where
    expect(where.OR[0]).toEqual({ teamId: null })
    expect(new Set(where.OR[1].teamId.in)).toEqual(new Set(["team-A", "team-B"]))
  })

  it("gives a supervisor a read-only view of their team's rules", async () => {
    asUser("supervisor-user", "sales")
    const list = await listPolicies(new NextRequest(new URL("/api/v1/mtm/visit-policies", "http://localhost:3000")))
    expect(list.status).toBe(200)
    const where = (vi.mocked(prisma.mtmVisitPolicy.findMany).mock.calls[0][0] as any).where
    expect(where.OR).toEqual([{ teamId: null }, { teamId: { in: ["team-B"] } }])

    const create = await createPolicy(request("/api/v1/mtm/visit-policies", policyBody("team-B")))
    expect(create.status).toBe(403)
    expect(await create.json()).toMatchObject({ code: "MTM_POLICY_READ_ONLY" })
    const deactivate = await del("policy-b")
    expect(deactivate.status).toBe(403)
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("refuses a field agent and a web manager without a card", async () => {
    asUser("agent-user", "sales")
    const agent = await listPolicies(new NextRequest(new URL("/api/v1/mtm/visit-policies", "http://localhost:3000")))
    expect(agent.status).toBe(403)
    expect(await agent.json()).toMatchObject({ code: "MTM_POLICY_ADMIN_REQUIRED" })

    asUser("nobody-user", "manager")
    const noCard = await listPolicies(new NextRequest(new URL("/api/v1/mtm/visit-policies", "http://localhost:3000")))
    expect(noCard.status).toBe(403)
    expect(await noCard.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
  })

  it("limits a manager's preview to their agents and their customers", async () => {
    asUser("manager-user", "manager")
    const outOfScope = await previewPolicy(request("/api/v1/mtm/visit-policies/preview", {
      agentId: "agent-b1", customerId: "customer-1", visitType: "DOCTOR_VISIT",
    }))
    expect(outOfScope.status).toBe(404)
    expect(await outOfScope.json()).toMatchObject({ code: "MTM_VISIT_AGENT_NOT_FOUND" })

    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValueOnce(null as never)
    const foreignCustomer = await previewPolicy(request("/api/v1/mtm/visit-policies/preview", {
      agentId: "report-b2", customerId: "customer-elsewhere", visitType: "DOCTOR_VISIT",
    }))
    expect(foreignCustomer.status).toBe(404)
    expect(await foreignCustomer.json()).toMatchObject({ code: "MTM_VISIT_CUSTOMER_NOT_FOUND" })
    const customerWhere = (vi.mocked(prisma.mtmCustomer.findFirst).mock.calls.at(-1)?.[0] as any).where
    expect(customerWhere.OR).toBeDefined()

    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", category: "A", objectType: "DOCTOR" } as never)
    const allowed = await previewPolicy(request("/api/v1/mtm/visit-policies/preview", {
      agentId: "report-b2", customerId: "customer-1", visitType: "DOCTOR_VISIT",
    }))
    expect(allowed.status).toBe(200)
  })
})
