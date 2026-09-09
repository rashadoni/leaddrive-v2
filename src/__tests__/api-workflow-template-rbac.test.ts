import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  groupBy: vi.fn(),
  findFirst: vi.fn(),
  createAppliedTemplate: vi.fn(),
  createWorkflow: vi.fn(),
  isSmsConfigured: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: mocks.requireAuth,
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appliedTemplate: {
      groupBy: mocks.groupBy,
      findFirst: mocks.findFirst,
      create: mocks.createAppliedTemplate,
    },
    workflowRule: { create: mocks.createWorkflow },
  },
}))

vi.mock("@/lib/sms", () => ({
  isSmsConfigured: mocks.isSmsConfigured,
}))

import { GET, POST } from "@/app/api/v1/workflows/templates/route"

const ADMIN_AUTH = {
  orgId: "org-1",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function request(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/workflows/templates", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue(ADMIN_AUTH)
  mocks.groupBy.mockResolvedValue([])
  mocks.findFirst.mockResolvedValue(null)
  mocks.isSmsConfigured.mockResolvedValue(true)
  mocks.createWorkflow.mockResolvedValue({ id: "wf-1", actions: [] })
  mocks.createAppliedTemplate.mockResolvedValue({ id: "applied-1" })
})

describe("workflow template RBAC", () => {
  it("returns 403 before catalog reads when support lacks settings access", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )

    const req = request("GET")
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "read")
    expect(mocks.groupBy).not.toHaveBeenCalled()
    expect(mocks.isSmsConfigured).not.toHaveBeenCalled()
  })

  it("returns 403 before applying a template when an API key lacks write:settings", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )

    const req = request("POST", { templateId: "welcome-new-lead" })
    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "write")
    expect(mocks.createWorkflow).not.toHaveBeenCalled()
    expect(mocks.createAppliedTemplate).not.toHaveBeenCalled()
  })

  it("keeps the admin template-apply flow functional", async () => {
    const req = request("POST", { templateId: "welcome-new-lead" })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "write")
    expect(mocks.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1" }),
    }))
    expect(mocks.createAppliedTemplate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        ruleId: "wf-1",
        appliedBy: "admin-1",
      }),
    })
  })
})
