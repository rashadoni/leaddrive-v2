import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhook: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: any) => (req: any, ctx: any = {}) => handler(req, { orgId: "org_1" }, ctx),
  withRlsAuth: (_module: string, _action: string, handler: any) =>
    (req: any, ctx: any = {}) => handler(req, { orgId: "org_1", userId: "admin_1", role: "admin" }, ctx),
  withRlsSessionAuth: (handler: any) =>
    (req: any, ctx: any = {}) => handler(req, { orgId: "org_1", userId: "admin_1", role: "admin" }, ctx),
}))

import { GET as GET_LIST } from "@/app/api/v1/webhooks/manage/route"
import { GET as GET_ONE, PUT } from "@/app/api/v1/webhooks/manage/[id]/route"

const row = {
  id: "wh_1",
  organizationId: "org_1",
  url: "https://example.com/hook",
  events: ["deal.created"],
  secret: "raw-webhook-secret",
  isActive: true,
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
}

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/webhooks/manage/wh_1", {
    method: body ? "PUT" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("webhook management secret exposure", () => {
  it("does not return webhook secrets in the list response", async () => {
    mocks.findMany.mockResolvedValue([row])

    const res = await GET_LIST(req())
    const json = await res.json()

    expect(json.data[0]).not.toHaveProperty("secret")
    expect(JSON.stringify(json)).not.toContain("raw-webhook-secret")
  })

  it("does not return webhook secrets in the detail response", async () => {
    mocks.findFirst.mockResolvedValue(row)

    const res = await GET_ONE(req(), { params: Promise.resolve({ id: "wh_1" }) })
    const json = await res.json()

    expect(json.data).not.toHaveProperty("secret")
    expect(JSON.stringify(json)).not.toContain("raw-webhook-secret")
  })

  it("does not return webhook secrets after update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findFirst.mockResolvedValue({ ...row, isActive: false })

    const res = await PUT(req({ isActive: false }), { params: Promise.resolve({ id: "wh_1" }) })
    const json = await res.json()

    expect(json.data).not.toHaveProperty("secret")
    expect(json.data.isActive).toBe(false)
    expect(JSON.stringify(json)).not.toContain("raw-webhook-secret")
  })
})
