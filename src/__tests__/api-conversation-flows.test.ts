import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * E1.1b — ConversationFlow CRUD. Covers list (tenant + status filter), create
 * (defaults / 400), get-by-id (404), update (version-bump on graph edit / 404), delete (404).
 */
const db: { list: any[]; one: any; created: any; updateCount: number; deleteCount: number; lastUpdateData: any } = {
  list: [],
  one: null,
  created: null,
  updateCount: 1,
  deleteCount: 1,
  lastUpdateData: null,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationFlow: {
      findMany: vi.fn(async () => db.list),
      findFirst: vi.fn(async () => db.one),
      create: vi.fn(async ({ data }: any) => {
        db.created = data
        return { id: "flow_1", ...data }
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        db.lastUpdateData = data
        return { count: db.updateCount }
      }),
      deleteMany: vi.fn(async () => ({ count: db.deleteCount })),
    },
  },
}))
vi.mock("@/lib/with-rls", () => ({
  withRls: (h: any) => (req: any, ctx: any) => h(req, { orgId: "org_1" }, ctx),
  withRlsAuth: (_m: any, _a: any, h: any) => (req: any, ctx: any) => h(req, { orgId: "org_1", userId: "u_1" }, ctx),
}))

import { GET, POST } from "@/app/api/v1/conversation-flows/route"
import { GET as GET_ID, PUT, DELETE } from "@/app/api/v1/conversation-flows/[id]/route"

const get = (path = "http://localhost/api/v1/conversation-flows") => new NextRequest(path) as any
const json = (method: string, body: any) =>
  new NextRequest("http://localhost/api/v1/conversation-flows", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any
const idCtx = (id = "flow_1") => ({ params: Promise.resolve({ id }) }) as any

beforeEach(() => {
  db.list = []
  db.one = null
  db.created = null
  db.updateCount = 1
  db.deleteCount = 1
  db.lastUpdateData = null
  vi.clearAllMocks()
})

describe("GET /conversation-flows", () => {
  it("lists org flows", async () => {
    db.list = [{ id: "f1", name: "Triage" }]
    const res = await GET(get())
    expect(res.status).toBe(200)
    const { prisma } = await import("@/lib/prisma")
    expect((prisma.conversationFlow.findMany as any).mock.calls[0][0].where.organizationId).toBe("org_1")
  })
  it("applies a status filter", async () => {
    await GET(get("http://localhost/api/v1/conversation-flows?status=active"))
    const { prisma } = await import("@/lib/prisma")
    expect((prisma.conversationFlow.findMany as any).mock.calls[0][0].where.status).toBe("active")
  })
})

describe("POST /conversation-flows", () => {
  it("creates with defaults (draft / conversation_opened) + createdBy", async () => {
    const res = await POST(json("POST", { name: "Triage" }))
    expect(res.status).toBe(201)
    expect(db.created).toMatchObject({
      organizationId: "org_1",
      name: "Triage",
      status: "draft",
      trigger: "conversation_opened",
      createdBy: "u_1",
    })
  })
  it("rejects a missing name (400)", async () => {
    const res = await POST(json("POST", { trigger: "message_inbound" }))
    expect(res.status).toBe(400)
  })
  it("rejects an unknown trigger (400)", async () => {
    const res = await POST(json("POST", { name: "X", trigger: "on_explode" }))
    expect(res.status).toBe(400)
  })
})

describe("GET /conversation-flows/[id]", () => {
  it("404 when not in org", async () => {
    db.one = null
    const res = await GET_ID(get(), idCtx("missing"))
    expect(res.status).toBe(404)
  })
})

describe("PUT /conversation-flows/[id]", () => {
  it("bumps version when the graph changes", async () => {
    db.one = { id: "flow_1", version: 2 }
    const res = await PUT(json("PUT", { graph: { nodes: [], edges: [] } }), idCtx())
    expect(res.status).toBe(200)
    expect(db.lastUpdateData.version).toEqual({ increment: 1 })
    expect(db.lastUpdateData.graph).toEqual({ nodes: [], edges: [] })
  })
  it("does NOT bump version on a name-only edit", async () => {
    db.one = { id: "flow_1", name: "Renamed" }
    await PUT(json("PUT", { name: "Renamed" }), idCtx())
    expect(db.lastUpdateData.version).toBeUndefined()
  })
  it("404 when the id is not in this org", async () => {
    db.updateCount = 0
    const res = await PUT(json("PUT", { name: "X" }), idCtx("missing"))
    expect(res.status).toBe(404)
  })
  it("rejects an unknown field (strict, 400)", async () => {
    const res = await PUT(json("PUT", { bogus: 1 }), idCtx())
    expect(res.status).toBe(400)
  })
})

describe("DELETE /conversation-flows/[id]", () => {
  it("deletes (200)", async () => {
    const res = await DELETE(get(), idCtx())
    expect(res.status).toBe(200)
    expect((await res.json()).data.deleted).toBe("flow_1")
  })
  it("404 when nothing deleted", async () => {
    db.deleteCount = 0
    const res = await DELETE(get(), idCtx("missing"))
    expect(res.status).toBe(404)
  })
})
