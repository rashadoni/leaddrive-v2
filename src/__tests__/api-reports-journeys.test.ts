import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { mockValidateOutboundWebhookUrl } = vi.hoisted(() => ({
  mockValidateOutboundWebhookUrl: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    contact: { count: vi.fn() },
    deal: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    pipelineStage: { findMany: vi.fn() },
    lead: { count: vi.fn(), groupBy: vi.fn() },
    task: { count: vi.fn(), groupBy: vi.fn() },
    ticket: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    ticketCategory: { findMany: vi.fn() },
    ticketClosureRequest: { count: vi.fn(), findMany: vi.fn() },
    entitlement: { count: vi.fn(), findMany: vi.fn() },
    entitlementTicketMilestone: { count: vi.fn(), findMany: vi.fn() },
    slaPolicy: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    savedReport: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    journey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    journeyStep: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "AZN", PAGE_SIZE: { EXPORT: 1000 } }))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  validateOutboundWebhookUrl: mockValidateOutboundWebhookUrl,
}))

type MockTicketWhere = {
  organizationId?: string
  AND?: Array<Record<string, unknown>>
  ticket?: MockTicketWhere
  status?: string
}

import { GET as GET_REPORTS } from "@/app/api/v1/reports/route"
import { GET as GET_BUILDER, POST as POST_BUILDER } from "@/app/api/v1/reports/builder/route"
import { GET as GET_REPORT_BY_ID, PUT as PUT_REPORT, DELETE as DELETE_REPORT } from "@/app/api/v1/reports/builder/[id]/route"
import { GET as GET_JOURNEYS, POST as POST_JOURNEY } from "@/app/api/v1/journeys/route"
import { GET as GET_JOURNEY_BY_ID, PUT as PUT_JOURNEY, DELETE as DELETE_JOURNEY } from "@/app/api/v1/journeys/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockValidateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" } as any)
  vi.mocked(requireAuth).mockImplementation(async (req, module, action) => {
    const session = await getSession(req)
    const orgId = session?.orgId ?? await getOrgId(req)
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }) as any
    }
    return {
      orgId,
      userId: session?.userId || "admin-1",
      role: session?.role || "admin",
      email: session?.email || "admin@example.com",
      name: session?.name || "Admin",
      module,
      action,
    } as any
  })
  vi.mocked(prisma.pipelineStage.findMany).mockResolvedValue([])
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma))
})

// ─── GET /api/v1/reports ────────────────────────────────────────────

describe("GET /api/v1/reports", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_REPORTS(makeReq("http://localhost:3000/api/v1/reports"))
    expect(res.status).toBe(401)
  })

  it("returns report overview with all sections", async () => {
    vi.mocked(prisma.company.count).mockResolvedValue(10)
    vi.mocked(prisma.contact.count).mockResolvedValue(50)
    vi.mocked(prisma.deal.count).mockResolvedValue(5)
    vi.mocked(prisma.lead.count).mockResolvedValue(20)
    vi.mocked(prisma.task.count)
      .mockResolvedValueOnce(15)   // total tasks
      .mockResolvedValueOnce(3)    // overdue tasks
    vi.mocked(prisma.ticket.count)
      .mockResolvedValueOnce(10)   // total tickets
      .mockResolvedValueOnce(4)    // open tickets
      .mockResolvedValueOnce(4)    // filtered active tickets
      .mockResolvedValueOnce(1)    // SLA breached
      .mockResolvedValueOnce(2)    // SLA at risk
      .mockResolvedValueOnce(1)    // first response breached
      .mockResolvedValueOnce(0)    // reopened
    vi.mocked(prisma.ticketClosureRequest.count)
      .mockResolvedValueOnce(1)    // pending closure
      .mockResolvedValueOnce(0)    // auto-closed last 30 days
    vi.mocked(prisma.deal.groupBy).mockResolvedValue([
      { stage: "LEAD", _count: 3, _sum: { valueAmount: 3000 } },
      { stage: "WON", _count: 2, _sum: { valueAmount: 8000 } },
    ] as any)
    vi.mocked(prisma.task.groupBy).mockResolvedValue([
      { status: "completed", _count: 5 },
      { status: "in_progress", _count: 10 },
    ] as any)
    vi.mocked(prisma.ticket.groupBy)
      .mockResolvedValueOnce([
        { status: "resolved", _count: 3 },
        { status: "closed", _count: 2 },
        { status: "new", _count: 5 },
      ] as any)
      .mockResolvedValueOnce([{ categoryId: "cat-1", _count: 3 }] as any)
      .mockResolvedValueOnce([{ category: "legacy", _count: 1 }] as any)
      .mockResolvedValueOnce([{ source: "portal", _count: 4 }] as any)
      .mockResolvedValueOnce([{ priority: "high", _count: 2 }] as any)
      .mockResolvedValueOnce([{ assignedTo: "agent-1", _count: 2 }] as any)
      .mockResolvedValueOnce([{ satisfactionRating: 5, _count: 6 }, { satisfactionRating: 4, _count: 4 }] as any)
    const reportNow = new Date()
    vi.mocked(prisma.entitlement.count)
      .mockResolvedValueOnce(2)    // active support terms
      .mockResolvedValueOnce(1)    // expiring 30d
    vi.mocked(prisma.entitlementTicketMilestone.count)
      .mockResolvedValueOnce(1)    // overdue milestones
      .mockResolvedValueOnce(1)    // at-risk milestones
      .mockResolvedValueOnce(1)    // missed 30d
    vi.mocked(prisma.entitlement.findMany).mockResolvedValue([
      {
        id: "ent-1",
        companyId: "company-1",
        supportLevel: "premium",
        status: "active",
        validTo: new Date(reportNow.getTime() + 7 * 24 * 60 * 60 * 1000),
        company: { name: "Acme" },
        slaPolicy: { id: "sla-1", name: "Gold SLA" },
      },
    ] as any)
    vi.mocked(prisma.entitlementTicketMilestone.findMany).mockResolvedValue([
      {
        id: "milestone-1",
        type: "first_response",
        status: "in_progress",
        dueAt: new Date(reportNow.getTime() - 60 * 60 * 1000),
        missedAt: null,
        ticketId: "t-1",
        ticket: {
          id: "t-1",
          ticketNumber: "T-1",
          subject: "SLA risk",
          status: "new",
          priority: "high",
          companyId: "company-1",
        },
        definition: {
          entitlementId: "ent-1",
          entitlement: {
            id: "ent-1",
            companyId: "company-1",
            supportLevel: "premium",
            status: "active",
            company: { name: "Acme" },
            slaPolicy: { id: "sla-1", name: "Gold SLA" },
          },
        },
      },
      {
        id: "milestone-2",
        type: "resolution",
        status: "missed",
        dueAt: new Date(reportNow.getTime() - 2 * 60 * 60 * 1000),
        missedAt: new Date(reportNow.getTime() - 30 * 60 * 1000),
        ticketId: "t-2",
        ticket: {
          id: "t-2",
          ticketNumber: "T-2",
          subject: "Resolution late",
          status: "open",
          priority: "high",
          companyId: "company-1",
        },
        definition: {
          entitlementId: "ent-1",
          entitlement: {
            id: "ent-1",
            companyId: "company-1",
            supportLevel: "premium",
            status: "active",
            company: { name: "Acme" },
            slaPolicy: { id: "sla-1", name: "Gold SLA" },
          },
        },
      },
    ] as any)
    vi.mocked(prisma.slaPolicy.findMany).mockResolvedValue([
      { id: "sla-1", name: "Gold SLA" },
    ] as any)
    vi.mocked(prisma.ticket.findMany)
      .mockResolvedValueOnce([
        { createdAt: new Date(reportNow.getTime() - 2 * 60 * 60 * 1000) },
        { createdAt: new Date(reportNow.getTime() - 2 * 24 * 60 * 60 * 1000) },
      ] as any)
      .mockResolvedValueOnce([
        {
          assignedTo: "agent-1",
          createdAt: new Date(reportNow.getTime() - 48 * 60 * 60 * 1000),
          resolvedAt: new Date(reportNow.getTime() - 24 * 60 * 60 * 1000),
          closedAt: null,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          createdAt: new Date(reportNow.getTime() - 60 * 60 * 1000),
          firstResponseAt: new Date(reportNow.getTime() - 30 * 60 * 1000),
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "t-1",
          ticketNumber: "T-1",
          subject: "SLA risk",
          status: "new",
          priority: "high",
          source: "portal",
          requesterName: "Customer",
          requesterEmail: "c@example.com",
          requesterPhone: null,
          slaDueAt: new Date(reportNow.getTime() - 60 * 60 * 1000),
          slaFirstResponseDueAt: null,
          assignedTo: "agent-1",
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          createdAt: new Date(reportNow.getTime() - 60 * 60 * 1000),
          resolvedAt: new Date(reportNow.getTime() - 30 * 60 * 1000),
          closedAt: null,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          status: "new",
          source: "portal",
          requesterName: "Customer",
          requesterEmail: "c@example.com",
          requesterPhone: null,
          contact: null,
        },
        {
          status: "closed",
          source: "email",
          requesterName: "Customer",
          requesterEmail: "c@example.com",
          requesterPhone: null,
          contact: null,
        },
      ] as any)
    vi.mocked(prisma.ticketCategory.findMany).mockResolvedValue([
      {
        id: "cat-1",
        name: "Billing",
        slug: "billing",
        parentId: null,
        scope: "ticket",
        isActive: true,
        isPortalVisible: true,
        parent: null,
        _count: { children: 1, tickets: 3 },
      },
    ] as any)
    vi.mocked(prisma.ticketClosureRequest.findMany).mockResolvedValue([
      {
        id: "closure-1",
        channel: "portal",
        recipient: "c@example.com",
        dueAt: new Date(reportNow.getTime() + 24 * 60 * 60 * 1000),
        ticket: {
          id: "t-2",
          ticketNumber: "T-2",
          subject: "Resolved ticket",
          priority: "medium",
          requesterName: "Customer",
          requesterEmail: "c@example.com",
          requesterPhone: null,
        },
      },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent One", email: "agent@example.com" },
    ] as any)
    vi.mocked(prisma.lead.groupBy).mockResolvedValue([
      { status: "new", _count: 15 },
      { status: "converted", _count: 5 },
    ] as any)
    vi.mocked(prisma.company.findMany)
      .mockResolvedValueOnce([{ id: "company-1", name: "Acme" }] as any)
      .mockResolvedValueOnce([{ name: "Acme", contracts: [{ valueAmount: 10000 }] }] as any)
    vi.mocked(prisma.company.groupBy).mockResolvedValue([
      { leadStatus: "active", _count: 8 },
    ] as any)
    vi.mocked(prisma.ticket.aggregate).mockResolvedValue({
      _avg: { satisfactionRating: 4.2 },
      _count: { satisfactionRating: 10 },
    } as any)
    vi.mocked(prisma.contract.findMany).mockResolvedValue([
      { valueAmount: 5000, status: "active" },
      { valueAmount: 2000, status: "expired" },
    ] as any)

    const res = await GET_REPORTS(makeReq("http://localhost:3000/api/v1/reports"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.overview.companies).toBe(10)
    expect(json.data.overview.contacts).toBe(50)
    expect(json.data.overview.deals).toBe(5)
    expect(json.data.revenue.totalRevenue).toBe(8000)
    expect(json.data.revenue.wonDealsCount).toBe(2)
    expect(json.data.pipeline.stages).toHaveLength(2)
    expect(json.data.tasks.total).toBe(15)
    expect(json.data.tasks.completionRate).toBe(33) // 5/15 * 100 = 33
    expect(json.data.tickets.resolutionRate).toBe(50) // (3+2)/10 * 100 = 50
    expect(json.data.leads.conversionRate).toBe(25) // 5/20 * 100 = 25
    expect(json.data.csat.average).toBe(4.2)
    expect(json.data.financial.activeContracts).toBe(1)
    expect(json.data.serviceDesk.totals.pendingClosure).toBe(1)
    expect(json.data.serviceDesk.byCategory[0]).toMatchObject({
      id: "cat-1",
      name: "Billing",
      parentId: null,
      depth: 0,
      scope: "ticket",
      isPortalVisible: true,
      childrenCount: 1,
      count: 3,
    })
    expect(json.data.serviceDesk.requesterBreakdown[0]).toMatchObject({
      label: "Customer",
      email: "c@example.com",
      source: "portal",
      active: 1,
      count: 2,
    })
    expect(json.data.serviceDesk.entitlements.totals).toMatchObject({
      activeSupportTerms: 2,
      expiringSupportTerms30d: 1,
      overdueMilestones: 1,
      atRiskMilestones: 1,
      missedMilestones30d: 1,
    })
    expect(json.data.serviceDesk.entitlements.companyRisk[0]).toMatchObject({
      companyName: "Acme",
      supportLevel: "premium",
      slaPolicyName: "Gold SLA",
      activeTickets: 2,
      overdue: 1,
      missed30d: 1,
    })
    expect(json.data.serviceDesk.entitlements.supportLevelComparison.find((row: { supportLevel: string }) => row.supportLevel === "premium")).toMatchObject({
      activeTerms: 1,
      tickets: 2,
      overdue: 1,
      missed30d: 1,
    })
    expect(json.data.serviceDesk.entitlements.milestoneDrilldown[0]).toMatchObject({
      ticketNumber: "T-1",
      companyName: "Acme",
      supportLevel: "premium",
      milestoneType: "first_response",
    })
    expect(json.data.serviceDesk.filterOptions.slaPolicies).toEqual([{ id: "sla-1", name: "Gold SLA" }])
  })

  it("applies Service Desk query filters to ticket report queries", async () => {
    vi.mocked(prisma.company.count).mockResolvedValue(0)
    vi.mocked(prisma.contact.count).mockResolvedValue(0)
    vi.mocked(prisma.deal.count).mockResolvedValue(0)
    vi.mocked(prisma.lead.count).mockResolvedValue(0)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    vi.mocked(prisma.ticket.count).mockResolvedValue(0)
    vi.mocked(prisma.ticketClosureRequest.count).mockResolvedValue(0)
    vi.mocked(prisma.deal.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.deal.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.task.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.ticketCategory.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.ticketClosureRequest.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.lead.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.company.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.company.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.aggregate).mockResolvedValue({
      _avg: { satisfactionRating: null },
      _count: { satisfactionRating: 0 },
    } as any)
    vi.mocked(prisma.contract.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.entitlement.count).mockResolvedValue(0)
    vi.mocked(prisma.entitlementTicketMilestone.count).mockResolvedValue(0)
    vi.mocked(prisma.entitlement.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.entitlementTicketMilestone.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.slaPolicy.findMany).mockResolvedValue([] as any)

    const res = await GET_REPORTS(makeReq("http://localhost:3000/api/v1/reports?q=Acme&period=30d&companyId=company-1&categoryId=cat-1&assigneeId=agent-1&source=email&status=open&priority=high&sla=breached&supportLevel=premium&slaPolicyId=sla-1&entitlementStatus=active&milestoneType=resolution&milestoneState=missed"))

    expect(res.status).toBe(200)
    const ticketCountCalls = vi.mocked(prisma.ticket.count).mock.calls as Array<[{ where?: MockTicketWhere }]>
    const ticketCountWheres = ticketCountCalls.map(call => call[0]?.where)
    const filteredWhere = ticketCountWheres.find((where): where is MockTicketWhere => (
      Array.isArray(where?.AND) && where.AND.some(clause => clause.companyId === "company-1")
    ))
    expect(filteredWhere).toBeTruthy()
    const filteredClauses = filteredWhere?.AND || []
    expect(filteredClauses).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: "company-1" }),
      expect.objectContaining({ categoryId: "cat-1" }),
      expect.objectContaining({ assignedTo: "agent-1" }),
      expect.objectContaining({ source: "email" }),
      expect.objectContaining({ status: "open" }),
      expect.objectContaining({ priority: "high" }),
    ]))
    expect(filteredClauses.some(clause => (clause.createdAt as { gte?: unknown } | undefined)?.gte instanceof Date)).toBe(true)
    expect(filteredClauses.some(clause => {
      const parts = clause.OR as Array<{ ticketNumber?: { contains?: string } }> | undefined
      return parts?.some(part => part.ticketNumber?.contains === "Acme")
    })).toBe(true)
    expect(filteredClauses.some(clause => {
      const parts = clause.OR as Array<{ slaDueAt?: { lt?: unknown } }> | undefined
      return parts?.some(part => part.slaDueAt?.lt instanceof Date)
    })).toBe(true)
    const entitlementClause = filteredClauses.find(clause => "entitlementMilestones" in clause)
    const entitlementClauseText = JSON.stringify(entitlementClause)
    expect(entitlementClauseText).toContain("\"supportLevel\":\"premium\"")
    expect(entitlementClauseText).toContain("\"slaPolicyId\":\"sla-1\"")
    expect(entitlementClauseText).toContain("\"status\":\"active\"")
    expect(entitlementClauseText).toContain("\"type\":\"resolution\"")
    expect(entitlementClauseText).toContain("\"status\":\"missed\"")
    expect(vi.mocked(prisma.ticketClosureRequest.count).mock.calls[0][0]?.where).toMatchObject({
      organizationId: "org-1",
      status: "pending",
      ticket: expect.objectContaining({ organizationId: "org-1" }),
    })
  })

  it("returns 500 on database error", async () => {
    vi.mocked(prisma.company.count).mockRejectedValue(new Error("DB down"))
    const res = await GET_REPORTS(makeReq("http://localhost:3000/api/v1/reports"))
    expect(res.status).toBe(500)
  })
})

// ─── GET /api/v1/reports/builder ────────────────────────────────────

describe("GET /api/v1/reports/builder", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder"))
    expect(res.status).toBe(401)
  })

  it("returns saved reports with pagination", async () => {
    vi.mocked(prisma.savedReport.findMany).mockResolvedValue([
      { id: "r1", name: "Report A" },
    ] as any)
    vi.mocked(prisma.savedReport.count).mockResolvedValue(1)

    const res = await GET_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder?page=1&limit=20"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
    expect(json.pagination.page).toBe(1)
  })
})

// ─── POST /api/v1/reports/builder ───────────────────────────────────

describe("POST /api/v1/reports/builder", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder", {
      method: "POST",
      body: JSON.stringify({ name: "Test", entityType: "deals", columns: ["name"] }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder", {
      method: "POST",
      body: JSON.stringify({ name: "Test", entityType: "deals", columns: ["name"] }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST_BUILDER(new NextRequest(
      new URL("http://localhost:3000/api/v1/reports/builder"),
      { method: "POST", body: "not json" },
    ))
    expect(res.status).toBe(400)
  })

  it("creates a report and returns 201", async () => {
    const created = { id: "r-new", name: "Sales Report", entityType: "deals", columns: ["name", "value"] }
    vi.mocked(prisma.savedReport.create).mockResolvedValue(created as any)

    const res = await POST_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder", {
      method: "POST",
      body: JSON.stringify({ name: "Sales Report", entityType: "deals", columns: ["name", "value"] }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Sales Report")
  })

  it("updates existing report when id is provided in body", async () => {
    vi.mocked(prisma.savedReport.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.savedReport.findUnique).mockResolvedValue({ id: "r1", name: "Updated" } as any)

    const res = await POST_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder", {
      method: "POST",
      body: JSON.stringify({ id: "r1", name: "Updated" }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.name).toBe("Updated")
  })

  it("returns 400 when validation fails (missing entityType)", async () => {
    const res = await POST_BUILDER(makeReq("http://localhost:3000/api/v1/reports/builder", {
      method: "POST",
      body: JSON.stringify({ name: "Bad Report", columns: ["name"] }),
    }))
    expect(res.status).toBe(400)
  })
})

// ─── GET /api/v1/reports/builder/:id ────────────────────────────────

describe("GET /api/v1/reports/builder/:id", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue(null)
    const res = await GET_REPORT_BY_ID(makeReq("http://localhost:3000/api/v1/reports/builder/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("returns report by id", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue({ id: "r1", name: "My Report" } as any)
    const res = await GET_REPORT_BY_ID(makeReq("http://localhost:3000/api/v1/reports/builder/r1"), makeParams("r1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("r1")
  })
})

// ─── PUT /api/v1/reports/builder/:id ────────────────────────────────

describe("PUT /api/v1/reports/builder/:id", () => {
  it("returns 404 when report not found", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue(null)
    const res = await PUT_REPORT(
      makeReq("http://localhost:3000/api/v1/reports/builder/missing", { method: "PUT", body: JSON.stringify({ name: "X" }) }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("updates report and returns updated data", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue({ id: "r1" } as any)
    vi.mocked(prisma.savedReport.update).mockResolvedValue({ id: "r1", name: "Updated Report", chartType: "bar" } as any)

    const res = await PUT_REPORT(
      makeReq("http://localhost:3000/api/v1/reports/builder/r1", { method: "PUT", body: JSON.stringify({ name: "Updated Report", chartType: "bar" }) }),
      makeParams("r1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Updated Report")
  })

  it("returns 400 on invalid JSON", async () => {
    const res = await PUT_REPORT(
      new NextRequest(new URL("http://localhost:3000/api/v1/reports/builder/r1"), { method: "PUT", body: "bad json" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(400)
  })
})

// ─── DELETE /api/v1/reports/builder/:id ─────────────────────────────

describe("DELETE /api/v1/reports/builder/:id", () => {
  it("returns 404 when report not found", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue(null)
    const res = await DELETE_REPORT(
      makeReq("http://localhost:3000/api/v1/reports/builder/missing", { method: "DELETE" }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes report and returns success", async () => {
    vi.mocked(prisma.savedReport.findFirst).mockResolvedValue({ id: "r1" } as any)
    vi.mocked(prisma.savedReport.delete).mockResolvedValue({ id: "r1" } as any)

    const res = await DELETE_REPORT(
      makeReq("http://localhost:3000/api/v1/reports/builder/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe(true)
  })
})

// ─── GET /api/v1/journeys ───────────────────────────────────────────

describe("GET /api/v1/journeys", () => {
  it("returns 403 when support lacks journeys read permission", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const res = await GET_JOURNEYS(makeReq("http://localhost:3000/api/v1/journeys"))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "journeys", "read")
    expect(prisma.journey.findMany).not.toHaveBeenCalled()
  })

  it("returns 401 when no orgId", async () => {
    // The requireAuth fixture resolves session.orgId before its getOrgId fallback.
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_JOURNEYS(makeReq("http://localhost:3000/api/v1/journeys"))
    expect(res.status).toBe(401)
  })

  it("returns journeys with pagination", async () => {
    vi.mocked(prisma.journey.findMany).mockResolvedValue([
      { id: "j1", name: "Welcome", steps: [] },
    ] as any)
    vi.mocked(prisma.journey.count).mockResolvedValue(1)

    const res = await GET_JOURNEYS(makeReq("http://localhost:3000/api/v1/journeys?page=1&limit=10"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.journeys).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })

  it("passes search filter to where clause", async () => {
    vi.mocked(prisma.journey.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.journey.count).mockResolvedValue(0)

    await GET_JOURNEYS(makeReq("http://localhost:3000/api/v1/journeys?search=onboard"))

    const call = vi.mocked(prisma.journey.findMany).mock.calls[0][0] as any
    expect(call.where.name).toEqual({ contains: "onboard", mode: "insensitive" })
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.journey.findMany).mockRejectedValue(new Error("DB fail"))
    const res = await GET_JOURNEYS(makeReq("http://localhost:3000/api/v1/journeys"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

// ─── POST /api/v1/journeys ──────────────────────────────────────────

describe("POST /api/v1/journeys", () => {
  it("returns 403 when a viewer cannot create journeys", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const res = await POST_JOURNEY(makeReq("http://localhost:3000/api/v1/journeys", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "journeys", "write")
    expect(prisma.journey.create).not.toHaveBeenCalled()
  })

  it("returns 401 when no orgId", async () => {
    // The requireAuth fixture resolves session.orgId before its getOrgId fallback.
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_JOURNEY(makeReq("http://localhost:3000/api/v1/journeys", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when name is missing", async () => {
    const res = await POST_JOURNEY(makeReq("http://localhost:3000/api/v1/journeys", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
  })

  it("creates journey and returns 201", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      orgId: "org-1",
      userId: "manager-1",
      role: "manager",
      email: "manager@example.com",
      name: "Manager",
    } as any)
    const created = { id: "j-new", name: "Onboarding", status: "draft" }
    vi.mocked(prisma.journey.create).mockResolvedValue(created as any)

    const res = await POST_JOURNEY(makeReq("http://localhost:3000/api/v1/journeys", {
      method: "POST",
      body: JSON.stringify({ name: "Onboarding", status: "draft", triggerType: "segment_entry" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Onboarding")
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "journeys", "write")
  })
})

// ─── GET /api/v1/journeys/:id ───────────────────────────────────────

describe("GET /api/v1/journeys/:id", () => {
  it("returns 404 when journey not found", async () => {
    vi.mocked(prisma.journey.findFirst).mockResolvedValue(null)
    const res = await GET_JOURNEY_BY_ID(makeReq("http://localhost:3000/api/v1/journeys/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("returns journey with steps", async () => {
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({
      id: "j1", name: "Welcome", steps: [{ id: "s1", stepType: "email", stepOrder: 0 }],
    } as any)

    const res = await GET_JOURNEY_BY_ID(makeReq("http://localhost:3000/api/v1/journeys/j1"), makeParams("j1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.steps).toHaveLength(1)
  })
})

// ─── PUT /api/v1/journeys/:id ───────────────────────────────────────

describe("PUT /api/v1/journeys/:id", () => {
  it("returns 400 on invalid body (bad status)", async () => {
    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", { method: "PUT", body: JSON.stringify({ status: "invalid" }) }),
      makeParams("j1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when updateMany count is 0", async () => {
    vi.mocked(prisma.journey.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/missing", { method: "PUT", body: JSON.stringify({ name: "X" }) }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("updates journey with steps replacement", async () => {
    vi.mocked(prisma.journey.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.journeyStep.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.journeyStep.createMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({
      id: "j1", name: "Updated Journey", status: "active",
      steps: [
        { id: "s1", stepType: "email", stepOrder: 0 },
        { id: "s2", stepType: "delay", stepOrder: 1 },
      ],
    } as any)

    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", {
        method: "PUT",
        body: JSON.stringify({
          name: "Updated Journey",
          status: "active",
          steps: [
            { stepType: "email", stepOrder: 0, config: { templateId: "t1" } },
            { stepType: "delay", stepOrder: 1, config: { days: 3 } },
          ],
        }),
      }),
      makeParams("j1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.steps).toHaveLength(2)

    // Verify parent + destructive replacement share one transaction.
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.journeyStep.deleteMany).toHaveBeenCalledWith({ where: { journeyId: "j1" } })
    expect(prisma.journeyStep.createMany).toHaveBeenCalled()
  })

  it("caps journey steps before persistence", async () => {
    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", {
        method: "PUT",
        body: JSON.stringify({
          steps: Array.from({ length: 101 }, (_, stepOrder) => ({
            stepType: "email",
            stepOrder,
            config: {},
          })),
        }),
      }),
      makeParams("j1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()
  })

  it("caps webhook URL validations per journey request", async () => {
    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", {
        method: "PUT",
        body: JSON.stringify({
          steps: Array.from({ length: 11 }, (_, stepOrder) => ({
            stepType: "webhook",
            stepOrder,
            config: { url: `https://hooks.example.com/${stepOrder}` },
          })),
        }),
      }),
      makeParams("j1"),
    )

    expect(res.status).toBe(400)
    expect(mockValidateOutboundWebhookUrl).not.toHaveBeenCalled()
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()
  })

  it("rejects an unsafe webhook step before changing the journey", async () => {
    mockValidateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await PUT_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", {
        method: "PUT",
        body: JSON.stringify({
          steps: [{
            stepType: "webhook",
            stepOrder: 0,
            config: { url: "https://internal.example.test/callback" },
          }],
        }),
      }),
      makeParams("j1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()
    expect(prisma.journeyStep.createMany).not.toHaveBeenCalled()
  })
})

// ─── DELETE /api/v1/journeys/:id ────────────────────────────────────

describe("DELETE /api/v1/journeys/:id", () => {
  it("returns 404 when deleteMany count is 0", async () => {
    vi.mocked(prisma.journey.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/missing", { method: "DELETE" }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes journey and returns deleted id", async () => {
    vi.mocked(prisma.journey.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE_JOURNEY(
      makeReq("http://localhost:3000/api/v1/journeys/j1", { method: "DELETE" }),
      makeParams("j1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("j1")
  })
})
