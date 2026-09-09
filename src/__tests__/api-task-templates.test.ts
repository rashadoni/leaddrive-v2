import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    taskTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/task-templates/route"
import { PATCH, DELETE } from "@/app/api/v1/task-templates/[id]/route"
import { POST as INSTANTIATE } from "@/app/api/v1/task-templates/[id]/instantiate/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

function makeRequest(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "sales" } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
})

describe("GET /api/v1/task-templates", () => {
  it("returns own + shared templates ordered by usageCount", async () => {
    vi.mocked(prisma.taskTemplate.findMany).mockResolvedValue([] as any)
    const res = await GET(makeRequest("http://localhost/api/v1/task-templates"))
    expect(res.status).toBe(200)

    const call = vi.mocked(prisma.taskTemplate.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.OR).toEqual([{ userId: "u-1" }, { isShared: true }])
    expect(call.orderBy).toEqual([{ usageCount: "desc" }, { name: "asc" }])
  })
})

describe("POST /api/v1/task-templates", () => {
  it("rejects missing name", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ taskTitle: "Hello" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects missing taskTitle", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ name: "X" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects priority outside enum", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ name: "X", taskTitle: "Y", priority: "extreme" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects dueDateOffsetDays > 3650 (10 years)", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ name: "X", taskTitle: "Y", dueDateOffsetDays: 4000 }),
    }))
    expect(res.status).toBe(400)
  })

  it("accepts minimal valid payload", async () => {
    vi.mocked(prisma.taskTemplate.create).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "u-1", name: "X", taskTitle: "Y",
    } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ name: "X", taskTitle: "Y" }),
    }))
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.taskTemplate.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
    expect(createCall.data.userId).toBe("u-1")
    expect(createCall.data.priority).toBe("medium")
    expect(createCall.data.checklist).toEqual([])
    expect(createCall.data.customFields).toEqual({})
  })

  it("accepts checklist + customFields + relatedType + isShared", async () => {
    vi.mocked(prisma.taskTemplate.create).mockResolvedValue({ id: "t2" } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Onboarding",
        taskTitle: "Onboard {{user}}",
        priority: "high",
        relatedType: "company",
        checklist: [{ title: "Send welcome", sortOrder: 0 }, { title: "Schedule call", sortOrder: 1 }],
        customFields: { sprint: "current" },
        isShared: true,
      }),
    }))
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.taskTemplate.create).mock.calls[0][0] as any
    expect(createCall.data.checklist).toEqual([
      { title: "Send welcome", sortOrder: 0 },
      { title: "Schedule call", sortOrder: 1 },
    ])
    expect(createCall.data.isShared).toBe(true)
    expect(createCall.data.relatedType).toBe("company")
  })

  it("rejects relatedType outside enum", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/task-templates", {
      method: "POST",
      body: JSON.stringify({ name: "X", taskTitle: "Y", relatedType: "moonbase" }),
    }))
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/v1/task-templates/[id]", () => {
  it("returns 404 when template missing", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue(null)
    const res = await PATCH(makeRequest("http://localhost/api/v1/task-templates/t1", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    }), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not owner and not admin", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "OTHER",
    } as any)
    const res = await PATCH(makeRequest("http://localhost/api/v1/task-templates/t1", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    }), makeParams("t1"))
    expect(res.status).toBe(403)
    expect(prisma.taskTemplate.update).not.toHaveBeenCalled()
  })

  it("allows owner to edit", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "u-1",
    } as any)
    vi.mocked(prisma.taskTemplate.update).mockResolvedValue({ id: "t1", name: "Renamed" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/task-templates/t1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    }), makeParams("t1"))
    expect(res.status).toBe(200)
  })

  it("allows admin to edit another user's template", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH_OK, role: "admin" } as any)
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "OTHER",
    } as any)
    vi.mocked(prisma.taskTemplate.update).mockResolvedValue({ id: "t1" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/task-templates/t1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Cleaned up" }),
    }), makeParams("t1"))
    expect(res.status).toBe(200)
  })
})

describe("DELETE /api/v1/task-templates/[id]", () => {
  it("returns 404 when missing", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue(null)
    const res = await DELETE(makeRequest("http://localhost/api/v1/task-templates/t1", { method: "DELETE" }), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not owner", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "OTHER",
    } as any)
    const res = await DELETE(makeRequest("http://localhost/api/v1/task-templates/t1", { method: "DELETE" }), makeParams("t1"))
    expect(res.status).toBe(403)
  })

  it("allows owner to delete", async () => {
    vi.mocked(prisma.taskTemplate.findFirst).mockResolvedValue({
      id: "t1", organizationId: "org-1", userId: "u-1", name: "X",
    } as any)
    vi.mocked(prisma.taskTemplate.delete).mockResolvedValue({ id: "t1" } as any)

    const res = await DELETE(makeRequest("http://localhost/api/v1/task-templates/t1", { method: "DELETE" }), makeParams("t1"))
    expect(res.status).toBe(200)
  })
})

describe("POST /api/v1/task-templates/[id]/instantiate", () => {
  it("increments usageCount on own template", async () => {
    vi.mocked(prisma.taskTemplate.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await INSTANTIATE(makeRequest("http://localhost/api/v1/task-templates/t1/instantiate", { method: "POST" }), makeParams("t1"))
    expect(res.status).toBe(200)

    const call = vi.mocked(prisma.taskTemplate.updateMany).mock.calls[0][0] as any
    expect(call.where.id).toBe("t1")
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.OR).toEqual([{ userId: "u-1" }, { isShared: true }])
    expect(call.data).toEqual({ usageCount: { increment: 1 } })
  })

  it("returns 404 when template not visible to caller", async () => {
    vi.mocked(prisma.taskTemplate.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await INSTANTIATE(makeRequest("http://localhost/api/v1/task-templates/t-other/instantiate", { method: "POST" }), makeParams("t-other"))
    expect(res.status).toBe(404)
  })
})
