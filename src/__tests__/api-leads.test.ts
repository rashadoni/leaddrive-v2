import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    socialMention: { updateMany: vi.fn() },
    task: { updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
    pipeline: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  const getOrgId = vi.fn()
  return {
    getSession,
    getOrgId,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      if (session) return session
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((data) => data),
  filterWritableFields: vi.fn().mockImplementation((data) => data),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn().mockImplementation((_o, _u, _r, _e, where) => where),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/lead-assignment", () => ({
  applyLeadAssignmentRules: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/inbox/customer-stage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbox/customer-stage")>()
  return {
    ...actual,
    setLeadReportedCustomerStage: vi.fn().mockResolvedValue({ conversationsUpdated: 1 }),
    setLeadReportedCustomerStages: vi.fn().mockResolvedValue({ conversationsUpdated: 1 }),
  }
})

import { GET, POST } from "@/app/api/v1/leads/route"
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from "@/app/api/v1/leads/[id]/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { createNotification } from "@/lib/notifications"
import { executeWorkflows } from "@/lib/workflow-engine"
import { setLeadReportedCustomerStages } from "@/lib/inbox/customer-stage"

const SESSION = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "a@b.com",
  name: "Test",
}
type LeadFindManyArgs = { where: { OR?: unknown; status?: unknown } }
type LeadCreateArgs = { data: { status?: string; priority?: string } }

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.pipeline.findMany).mockResolvedValue([])
  vi.mocked(prisma.lead.findFirst).mockResolvedValue({
    id: "l1",
    contactName: "Alice",
    organizationId: "org-1",
    assignedTo: "user-1",
  } as never)
})

// ---------------------------------------------------------------------------
// GET /api/v1/leads
// ---------------------------------------------------------------------------
describe("GET /api/v1/leads", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null as never)

    const res = await GET(makeRequest("http://localhost:3000/api/v1/leads"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("requires explicit leads:read permission", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await GET(makeRequest("http://localhost:3000/api/v1/leads"))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "leads", "read")
    expect(prisma.lead.findMany).not.toHaveBeenCalled()
  })

  it("returns leads with default pagination", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    const fakeLead = { id: "l1", contactName: "Alice", organizationId: "org-1" }
    vi.mocked(prisma.lead.findMany).mockResolvedValue([fakeLead] as never)
    vi.mocked(prisma.lead.count).mockResolvedValue(1)

    const res = await GET(makeRequest("http://localhost:3000/api/v1/leads"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.leads).toHaveLength(1)
    expect(body.data.total).toBe(1)
    expect(body.data.page).toBe(1)
    expect(body.data.limit).toBe(50)
  })

  it("applies search filter as OR on contactName, companyName, email", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.lead.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost:3000/api/v1/leads?search=acme"))

    const call = vi.mocked(prisma.lead.findMany).mock.calls[0][0] as LeadFindManyArgs
    const where = call.where
    expect(where.OR).toEqual([
      { contactName: { contains: "acme", mode: "insensitive" } },
      { companyName: { contains: "acme", mode: "insensitive" } },
      { email: { contains: "acme", mode: "insensitive" } },
    ])
  })

  it("filters by exact status when status param provided", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.lead.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost:3000/api/v1/leads?status=qualified"))

    const call = vi.mocked(prisma.lead.findMany).mock.calls[0][0] as LeadFindManyArgs
    expect(call.where.status).toBe("qualified")
  })

  it("includes converted leads when includeConverted=true", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.lead.count).mockResolvedValue(0)

    await GET(
      makeRequest("http://localhost:3000/api/v1/leads?includeConverted=true")
    )

    const call = vi.mocked(prisma.lead.findMany).mock.calls[0][0] as LeadFindManyArgs
    expect(call.where.status).toBeUndefined()
  })

  it("excludes converted by default", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.lead.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost:3000/api/v1/leads"))

    const call = vi.mocked(prisma.lead.findMany).mock.calls[0][0] as LeadFindManyArgs
    expect(call.where.status).toEqual({ not: "converted" })
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(makeRequest("http://localhost:3000/api/v1/leads"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/leads
// ---------------------------------------------------------------------------
describe("POST /api/v1/leads", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Bob" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when contactName is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({}),
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it("rejects a negative estimated value on create", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Unsafe", estimatedValue: -1 }),
      })
    )

    expect(res.status).toBe(400)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("rejects phone and WhatsApp values shorter than 10 digits", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)

    const shortPhone = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Invalid", phone: "34543" }),
      }),
    )
    const shortWhatsApp = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Invalid", phoneWhatsApp: "43" }),
      }),
    )

    expect(shortPhone.status).toBe(400)
    expect(shortWhatsApp.status).toBe(400)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("creates a lead and returns 201", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    const created = {
      id: "l-new",
      contactName: "Bob",
      companyName: "Acme",
      status: "new",
      priority: "medium",
      organizationId: "org-1",
    }
    vi.mocked(prisma.lead.create).mockResolvedValue(created as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Bob", companyName: "Acme" }),
      })
    )
    expect(res.status).toBe(201)
    expect(prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedTo: "user-1" }),
    }))
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.contactName).toBe("Bob")
  })

  it("defaults status to 'new' and priority to 'medium'", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.create).mockResolvedValue({
      id: "l2",
      contactName: "Eve",
      status: "new",
      priority: "medium",
    } as never)

    await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Eve" }),
      })
    )

    const call = vi.mocked(prisma.lead.create).mock.calls[0][0] as LeadCreateArgs
    expect(call.data.status).toBe("new")
    expect(call.data.priority).toBe("medium")
  })

  it("calls applyLeadAssignmentRules after creation", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    const created = { id: "l3", contactName: "Dan", organizationId: "org-1" }
    vi.mocked(prisma.lead.create).mockResolvedValue(created as never)

    await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Dan" }),
      })
    )

    expect(applyLeadAssignmentRules).toHaveBeenCalledWith("org-1", created)
  })

  it("routes a salesperson's own manual lead to Satış and keeps the salesperson as owner", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...SESSION,
      userId: "sales-1",
      role: "sales",
    } as never)
    vi.mocked(prisma.pipeline.findMany).mockResolvedValue([
      { id: "pipe-default", name: "Default Sales", isDefault: true },
      { id: "pipe-sales", name: "Satış", isDefault: false },
    ] as never)
    vi.mocked(prisma.lead.create).mockResolvedValue({
      id: "l-sales",
      contactName: "Afiq",
      organizationId: "org-1",
      assignedTo: "sales-1",
      pipelineId: "pipe-sales",
    } as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Afiq" }),
      }),
    )

    expect(res.status).toBe(201)
    expect(prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedTo: "sales-1",
        pipelineId: "pipe-sales",
      }),
    }))
    expect(applyLeadAssignmentRules).not.toHaveBeenCalled()
  })

  it("stores an explicitly selected active lead pipeline", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.pipeline.findMany).mockResolvedValue([
      { id: "pipe-event", name: "Tədbir", isDefault: false },
    ] as never)
    vi.mocked(prisma.lead.create).mockResolvedValue({
      id: "l-event",
      contactName: "Event buyer",
      organizationId: "org-1",
      pipelineId: "pipe-event",
    } as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Event buyer", pipelineId: "pipe-event" }),
      }),
    )

    expect(res.status).toBe(201)
    expect(prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineId: "pipe-event" }),
    }))
  })

  it("assigns an explicitly selected active seller and skips automatic rules", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "seller-1" } as never)
    vi.mocked(prisma.lead.create).mockResolvedValue({
      id: "l4",
      contactName: "Mila",
      organizationId: "org-1",
      assignedTo: "seller-1",
    } as never)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Mila", assignedTo: "seller-1" }),
      }),
    )

    expect(res.status).toBe(201)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: "seller-1",
        organizationId: "org-1",
        role: "sales",
        isActive: true,
      },
      select: { id: true },
    })
    expect(prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedTo: "seller-1" }),
    }))
    expect(applyLeadAssignmentRules).not.toHaveBeenCalled()
  })

  it("rejects a seller outside the organization or an inactive seller", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({ contactName: "Mila", assignedTo: "foreign-user" }),
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/leads/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/leads/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null as never)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/leads/l1"),
      makeParams("l1")
    )
    expect(res.status).toBe(401)
  })

  it("returns the lead when found", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    const lead = { id: "l1", contactName: "Alice", organizationId: "org-1" }
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(lead as never)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/leads/l1"),
      makeParams("l1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contactName).toBe("Alice")
  })

  it("applies the same record-sharing filter to the detail lookup", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...SESSION, role: "sales" } as never)
    vi.mocked(applyRecordFilter).mockResolvedValueOnce({
      id: "l1",
      organizationId: "org-1",
      assignedTo: "user-1",
    } as never)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1",
      contactName: "Alice",
      organizationId: "org-1",
      assignedTo: "user-1",
    } as never)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/leads/l1"),
      makeParams("l1"),
    )

    expect(res.status).toBe(200)
    expect(applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "sales",
      "lead",
      { id: "l1", organizationId: "org-1" },
    )
    expect(prisma.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedTo: "user-1" }),
    }))
  })

  it("returns 404 when lead not found", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/leads/nonexistent"),
      makeParams("nonexistent")
    )
    expect(res.status).toBe(404)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findFirst).mockRejectedValue(new Error("DB crash"))

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/leads/l1"),
      makeParams("l1")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/leads/:id
// ---------------------------------------------------------------------------
describe("PUT /api/v1/leads/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({ contactName: "Updated" }),
      }),
      makeParams("l1")
    )
    expect(res.status).toBe(401)
  })

  it("updates a lead and returns it", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.updateMany).mockResolvedValue({ count: 1 } as never)
    const updated = { id: "l1", contactName: "Updated", organizationId: "org-1" }
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(updated as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({ contactName: "Updated" }),
      }),
      makeParams("l1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contactName).toBe("Updated")
  })

  it("rejects an unrealistically large estimated value on update", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({ estimatedValue: 1_000_000_000_000 }),
      }),
      makeParams("l1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.lead.updateMany).not.toHaveBeenCalled()
  })

  it("returns 404 when lead not found (count===0)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.updateMany).mockResolvedValue({ count: 0 } as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/nonexistent", {
        method: "PUT",
        body: JSON.stringify({ contactName: "Nope" }),
      }),
      makeParams("nonexistent")
    )
    expect(res.status).toBe(404)
  })

  it("creates notification with correct type when status changes to converted", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.updateMany).mockResolvedValue({ count: 1 } as never)
    const updated = {
      id: "l1",
      contactName: "Alice",
      status: "converted",
      organizationId: "org-1",
    }
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(updated as never)

    await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({ status: "converted" }),
      }),
      makeParams("l1")
    )

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "success",
        entityType: "lead",
        entityId: "l1",
      })
    )

    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "lead",
      "status_changed",
      updated
    )
  })

  it("triggers 'updated' workflow when no status change", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.updateMany).mockResolvedValue({ count: 1 } as never)
    const updated = { id: "l1", contactName: "Alice2", organizationId: "org-1" }
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(updated as never)

    await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({ contactName: "Alice2" }),
      }),
      makeParams("l1")
    )

    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "lead",
      "updated",
      updated
    )
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("saves a salesperson call result and syncs it to linked Inbox conversations", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    const updated = {
      id: "l1",
      contactName: "Alice",
      phone: "+994501234567",
      customerStage: "potential",
      customerStageReason: "Asked for a detailed offer",
      organizationId: "org-1",
    }
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(updated as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({
          customerStage: "potential",
          customerStageReason: "Asked for a detailed offer",
        }),
      }),
      makeParams("l1"),
    )

    expect(res.status).toBe(200)
    expect(setLeadReportedCustomerStages).toHaveBeenCalledWith(prisma, {
      organizationId: "org-1",
      leadId: "l1",
      stages: ["potential"],
      changedBy: "user-1",
      canOverrideAssignee: true,
      reason: "Asked for a detailed offer",
    })
    expect(await res.json()).toMatchObject({
      meta: { inboxConversationsUpdated: 1 },
    })
  })

  it("saves several compatible call results in one report", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1",
      contactName: "Alice",
      organizationId: "org-1",
      customerStage: "sold",
      salesCallOutcomes: ["sales_contacted", "potential", "sold"],
    } as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({
          salesCallOutcomes: ["sold", "sales_contacted", "potential"],
          customerStageReason: "Reached the customer, qualified the need, and completed the sale",
        }),
      }),
      makeParams("l1"),
    )

    expect(res.status).toBe(200)
    expect(setLeadReportedCustomerStages).toHaveBeenCalledWith(prisma, {
      organizationId: "org-1",
      leadId: "l1",
      stages: ["sales_contacted", "potential", "sold"],
      changedBy: "user-1",
      canOverrideAssignee: true,
      reason: "Reached the customer, qualified the need, and completed the sale",
    })
  })

  it("rejects contradictory call results", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({
          salesCallOutcomes: ["sold", "not_sold"],
          customerStageReason: "Contradictory report",
        }),
      }),
      makeParams("l1"),
    )

    expect(res.status).toBe(400)
    expect(setLeadReportedCustomerStages).not.toHaveBeenCalled()
  })

  it("returns a clear error when a potential lead has no phone", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as never)
    vi.mocked(setLeadReportedCustomerStages).mockRejectedValueOnce(new Error("phone-required"))

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/leads/l1", {
        method: "PUT",
        body: JSON.stringify({
          customerStage: "potential",
          customerStageReason: "Asked for a detailed offer",
        }),
      }),
      makeParams("l1"),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "phone_required" })
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/leads/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/leads/:id", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 } as never)
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as never)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/leads/l1", { method: "DELETE" }),
      makeParams("l1")
    )
    expect(res.status).toBe(401)
  })

  it("does not delete when leads:delete authorization is denied", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/leads/l1", { method: "DELETE" }),
      makeParams("l1"),
    )

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "leads", "delete")
    expect(prisma.lead.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes a lead and returns its id", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ contactName: "Alice" } as never)
    vi.mocked(prisma.lead.deleteMany).mockResolvedValue({ count: 1 } as never)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/leads/l1", { method: "DELETE" }),
      makeParams("l1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deleted).toBe("l1")
    // clears the dangling social-mention back-reference (no FK → not auto-nulled)
    expect(prisma.socialMention.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leadId: { in: ["l1"] } }), data: { leadId: null } }),
    )
  })

  it("returns 404 when lead not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.lead.deleteMany).mockResolvedValue({ count: 0 } as never)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/leads/nonexistent", {
        method: "DELETE",
      }),
      makeParams("nonexistent")
    )
    expect(res.status).toBe(404)
  })
})
