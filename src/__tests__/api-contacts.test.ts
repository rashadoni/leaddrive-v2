import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
}))

// Partial mock on purpose (F-32). Only the permission SOURCE is stubbed; the
// filtering itself stays real. The previous full mock made filterEntityFields an
// identity function, so a test could not have caught a field leaking — which is
// exactly the defect that shipped.
vi.mock("@/lib/field-filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/field-filter")>()
  return {
    ...actual,
    getFieldPermissions: vi.fn().mockResolvedValue({}),
  }
})

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
vi.mock("@/lib/plan-limits", () => ({
  checkContactLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/unified-profile/profile-builder", () => ({
  refreshProfileForSource: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/loyalty/auto-earn", () => ({
  applyAutoEarn: vi.fn().mockResolvedValue({ status: "no_op" }),
}))

vi.mock("@/lib/tasks/clear-task-relations", () => ({
  clearTaskRelations: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from "@/app/api/v1/contacts/route"
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from "@/app/api/v1/contacts/[id]/route"
import { prisma, logAudit } from "@/lib/prisma"
import { getSession, getOrgId } from "@/lib/api-auth"
import { checkContactLimit } from "@/lib/plan-limits"
import { trackContactEvent } from "@/lib/contact-events"
import { fireWebhooks } from "@/lib/webhooks"
import { executeWorkflows } from "@/lib/workflow-engine"
import { applyAutoEarn } from "@/lib/loyalty/auto-earn"

const SESSION = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "a@b.com",
  name: "Test",
}

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(checkContactLimit).mockResolvedValue({ allowed: true } as any)
})

// ---------------------------------------------------------------------------
// GET /api/v1/contacts
// ---------------------------------------------------------------------------
describe("GET /api/v1/contacts", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET(makeRequest("http://localhost:3000/api/v1/contacts"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns contacts list with pagination", async () => {
    const contacts = [
      { id: "c1", fullName: "Alice", company: { id: "co1", name: "Acme" } },
    ]
    vi.mocked(prisma.contact.findMany).mockResolvedValue(contacts as any)
    vi.mocked(prisma.contact.count).mockResolvedValue(1)

    const res = await GET(
      makeRequest("http://localhost:3000/api/v1/contacts?page=1&limit=10")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.contacts).toHaveLength(1)
    expect(body.data.total).toBe(1)
    expect(body.data.page).toBe(1)
    expect(body.data.limit).toBe(10)
  })

  it("passes search and companyId filters to where clause", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    vi.mocked(prisma.contact.count).mockResolvedValue(0)

    await GET(
      makeRequest(
        "http://localhost:3000/api/v1/contacts?search=Alice&companyId=co1"
      )
    )

    const callArgs = vi.mocked(prisma.contact.findMany).mock.calls[0][0] as any
    expect(callArgs.where.fullName).toEqual({
      contains: "Alice",
      mode: "insensitive",
    })
    expect(callArgs.where.companyId).toBe("co1")
  })

  it("passes lifecycleStage filter to where clause", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    vi.mocked(prisma.contact.count).mockResolvedValue(0)

    await GET(
      makeRequest(
        "http://localhost:3000/api/v1/contacts?lifecycleStage=customer"
      )
    )

    const callArgs = vi.mocked(prisma.contact.findMany).mock.calls[0][0] as any
    expect(callArgs.where.lifecycleStage).toBe("customer")
  })

  it("rejects invalid lifecycleStage filter", async () => {
    const res = await GET(
      makeRequest("http://localhost:3000/api/v1/contacts?lifecycleStage=banana")
    )

    expect(res.status).toBe(400)
    expect(prisma.contact.findMany).not.toHaveBeenCalled()
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contact.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(
      makeRequest("http://localhost:3000/api/v1/contacts?page=2&limit=25")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/contacts
// ---------------------------------------------------------------------------
describe("POST /api/v1/contacts", () => {
  const validBody = { fullName: "Bob Smith", email: "bob@example.com" }

  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when fullName is missing", async () => {
    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ email: "x@y.com" }),
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it("rejects invalid lifecycleStage on create", async () => {
    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ ...validBody, lifecycleStage: "banana" }),
      })
    )

    expect(res.status).toBe(400)
    expect(prisma.contact.create).not.toHaveBeenCalled()
  })

  it("returns 403 when plan contact limit is exceeded", async () => {
    vi.mocked(checkContactLimit).mockResolvedValue({
      allowed: false,
      message: "Contact limit reached",
    } as any)

    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "c1" } as any)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Contact limit reached")
    expect(prisma.contact.create).not.toHaveBeenCalled()
  })

  it("creates a contact and returns 201", async () => {
    const created = {
      id: "c1",
      fullName: "Bob Smith",
      email: "bob@example.com",
      organizationId: "org-1",
      source: null,
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("c1")
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "create",
      "contact",
      "c1",
      "Bob Smith"
    )
  })

  it("accepts lifecycleStage on create", async () => {
    const created = {
      id: "c-lifecycle",
      fullName: "Lifecycle Contact",
      email: "life@example.com",
      organizationId: "org-1",
      source: null,
      lifecycleStage: "customer",
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    const res = await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ ...validBody, lifecycleStage: "customer" }),
      })
    )

    expect(res.status).toBe(201)
    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          lifecycleStage: "customer",
        }),
      })
    )
  })

  it("calls trackContactEvent when source is portal", async () => {
    const created = {
      id: "c2",
      fullName: "Portal User",
      email: "p@x.com",
      organizationId: "org-1",
      source: "portal",
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ fullName: "Portal User", source: "portal" }),
      })
    )

    expect(trackContactEvent).toHaveBeenCalledWith(
      "org-1",
      "c2",
      "form_submitted",
      { source: "portal" }
    )
  })

  it("calls trackContactEvent when source is form", async () => {
    const created = {
      id: "c3",
      fullName: "Form User",
      organizationId: "org-1",
      source: "form",
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ fullName: "Form User", source: "form" }),
      })
    )

    expect(trackContactEvent).toHaveBeenCalledWith(
      "org-1",
      "c3",
      "form_submitted",
      { source: "form" }
    )
  })

  it("does NOT call trackContactEvent for non-portal sources", async () => {
    const created = {
      id: "c4",
      fullName: "Manual User",
      organizationId: "org-1",
      source: "manual",
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ fullName: "Manual User", source: "manual" }),
      })
    )

    expect(trackContactEvent).not.toHaveBeenCalled()
  })

  it("calls fireWebhooks and executeWorkflows on create", async () => {
    const created = {
      id: "c5",
      fullName: "Webhook Test",
      email: "w@t.com",
      organizationId: "org-1",
      source: null,
    }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)

    await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ fullName: "Webhook Test" }),
      })
    )

    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "contact",
      "created",
      created
    )
    expect(fireWebhooks).toHaveBeenCalledWith("org-1", "contact.created", {
      id: "c5",
      fullName: "Webhook Test",
      email: "w@t.com",
    })
  })

  it("fires the loyalty signup auto-earn hook on create (trigger=signup, ref=contactId)", async () => {
    const created = { id: "c6", fullName: "Signup Test", email: "s@t.com", organizationId: "org-1", source: null }
    vi.mocked(prisma.contact.create).mockResolvedValue(created as any)
    await POST(
      makeRequest("http://localhost:3000/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ fullName: "Signup Test" }),
      })
    )
    expect(applyAutoEarn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org-1",
        contactId: "c6",
        trigger: "signup",
        referenceId: "c6",
        requireAutoEarnEnabled: true,
      })
    )
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/contacts/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/contacts/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/contacts/c1"),
      makeParams("c1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when contact not found", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/contacts/nonexistent"),
      makeParams("nonexistent")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("returns contact with company and activities", async () => {
    const contact = {
      id: "c1",
      fullName: "Alice",
      organizationId: "org-1",
      company: { id: "co1", name: "Acme" },
      activities: [],
    }
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as any)

    const res = await GET_BY_ID(
      makeRequest("http://localhost:3000/api/v1/contacts/c1"),
      makeParams("c1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("c1")
    expect(body.data.company.name).toBe("Acme")
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/contacts/:id
// ---------------------------------------------------------------------------
describe("PUT /api/v1/contacts/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ fullName: "Updated" }),
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid data", async () => {
    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ email: "not-an-email" }),
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(400)
  })

  it("rejects invalid lifecycleStage on update", async () => {
    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ lifecycleStage: "banana" }),
      }),
      makeParams("c1")
    )

    expect(res.status).toBe(400)
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("returns 404 when updateMany count is 0", async () => {
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ fullName: "Updated" }),
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("updates contact and returns success", async () => {
    const updated = {
      id: "c1",
      fullName: "Updated Name",
      email: "u@x.com",
      organizationId: "org-1",
    }
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(updated as any)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ fullName: "Updated Name" }),
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.fullName).toBe("Updated Name")

    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "update",
      "contact",
      "c1",
      "Updated Name",
      { newValue: { fullName: "Updated Name" } }
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "contact",
      "updated",
      updated
    )
    expect(fireWebhooks).toHaveBeenCalledWith("org-1", "contact.updated", {
      id: "c1",
      fullName: "Updated Name",
      email: "u@x.com",
    })
  })

  it("updates contact lifecycleStage", async () => {
    const updated = {
      id: "c1",
      fullName: "Lifecycle Contact",
      email: "life@example.com",
      organizationId: "org-1",
      lifecycleStage: "customer",
    }
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(updated as any)

    const res = await PUT(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "PUT",
        body: JSON.stringify({ lifecycleStage: "customer" }),
      }),
      makeParams("c1")
    )

    expect(res.status).toBe(200)
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", organizationId: "org-1" },
        data: expect.objectContaining({ lifecycleStage: "customer" }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/contacts/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/contacts/:id", () => {
  it("returns 401 when no session or fallback orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "DELETE",
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(401)
    expect(getOrgId).toHaveBeenCalled()
  })

  it("returns 404 when deleteMany count is 0", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contact.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "DELETE",
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("deletes contact and calls logAudit and fireWebhooks", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      fullName: "Gone Contact",
    } as any)
    vi.mocked(prisma.contact.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/v1/contacts/c1", {
        method: "DELETE",
      }),
      makeParams("c1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe("c1")

    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "delete",
      "contact",
      "c1",
      "Gone Contact"
    )
    expect(fireWebhooks).toHaveBeenCalledWith("org-1", "contact.deleted", {
      id: "c1",
      fullName: "Gone Contact",
    })
  })
})
