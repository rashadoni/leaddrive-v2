import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  stageFindFirst: vi.fn(),
  ruleFindMany: vi.fn(),
  ruleCreate: vi.fn(),
  ruleDeleteMany: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: mocks.requireAuth,
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: { findFirst: mocks.stageFindFirst },
    stageValidationRule: {
      findMany: mocks.ruleFindMany,
      create: mocks.ruleCreate,
      deleteMany: mocks.ruleDeleteMany,
    },
  },
}))

import { DELETE, GET, POST } from "@/app/api/v1/pipeline-stages/[id]/rules/route"

const AUTH = {
  orgId: "org-1",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

const context = (id = "stage-1") => ({ params: Promise.resolve({ id }) })

function request(method: "GET" | "POST" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/pipeline-stages/stage-1/rules", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  })
}

const validRule = {
  fieldName: "valueAmount",
  ruleType: "min_value",
  ruleValue: 10,
  errorMessage: "Value is too low",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue(AUTH)
  mocks.stageFindFirst.mockResolvedValue({ id: "stage-1" })
  mocks.ruleFindMany.mockResolvedValue([])
  mocks.ruleCreate.mockResolvedValue({ id: "rule-1" })
  mocks.ruleDeleteMany.mockResolvedValue({ count: 1 })
})

describe("pipeline-stage rule RBAC", () => {
  it("requires settings:read before listing rules", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )
    const req = request("GET")

    const res = await GET(req, context())

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "read")
    expect(mocks.stageFindFirst).not.toHaveBeenCalled()
    expect(mocks.ruleFindMany).not.toHaveBeenCalled()
  })

  it("blocks a viewer before creating a rule", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )
    const req = request("POST", validRule)

    const res = await POST(req, context())

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "write")
    expect(mocks.stageFindFirst).not.toHaveBeenCalled()
    expect(mocks.ruleCreate).not.toHaveBeenCalled()
  })

  it("blocks an API key missing write:settings before deleting a rule", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )
    const req = request("DELETE", { ruleId: "rule-1" })

    const res = await DELETE(req, context())

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "settings", "delete")
    expect(mocks.stageFindFirst).not.toHaveBeenCalled()
    expect(mocks.ruleDeleteMany).not.toHaveBeenCalled()
  })
})

describe("pipeline-stage rule tenant boundaries", () => {
  it("does not create a rule for another tenant's stage", async () => {
    mocks.stageFindFirst.mockResolvedValue(null)

    const res = await POST(request("POST", validRule), context("foreign-stage"))

    expect(res.status).toBe(404)
    expect(mocks.stageFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-stage", organizationId: "org-1" },
      select: { id: true },
    })
    expect(mocks.ruleCreate).not.toHaveBeenCalled()
  })

  it("does not delete from another tenant's stage", async () => {
    mocks.stageFindFirst.mockResolvedValue(null)

    const res = await DELETE(
      request("DELETE", { ruleId: "foreign-rule" }),
      context("foreign-stage"),
    )

    expect(res.status).toBe(404)
    expect(mocks.ruleDeleteMany).not.toHaveBeenCalled()
  })

  it("binds deletion to the authenticated org and owned stage", async () => {
    const res = await DELETE(request("DELETE", { ruleId: "rule-1" }), context())

    expect(res.status).toBe(200)
    expect(mocks.ruleDeleteMany).toHaveBeenCalledWith({
      where: {
        id: "rule-1",
        pipelineStageId: "stage-1",
        organizationId: "org-1",
      },
    })
  })

  it("returns 404 when the rule is not attached to the owned stage", async () => {
    mocks.ruleDeleteMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(request("DELETE", { ruleId: "foreign-rule" }), context())

    expect(res.status).toBe(404)
  })

  it("validates stage ownership and scopes the list query", async () => {
    const res = await GET(request("GET"), context())

    expect(res.status).toBe(200)
    expect(mocks.stageFindFirst).toHaveBeenCalledWith({
      where: { id: "stage-1", organizationId: "org-1" },
      select: { id: true },
    })
    expect(mocks.ruleFindMany).toHaveBeenCalledWith({
      where: { pipelineStageId: "stage-1", organizationId: "org-1" },
      orderBy: { createdAt: "asc" },
    })
  })
})
