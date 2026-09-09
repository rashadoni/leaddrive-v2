import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kbArticle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from "@/app/api/v1/kb/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/kb/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

function makeRequest(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /api/v1/kb
// ---------------------------------------------------------------------------
describe("GET /api/v1/kb", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET(makeRequest("http://localhost/api/v1/kb"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns articles with default pagination", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const articles = [{ id: "a1", title: "How to reset", status: "published" }]
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue(articles as any)
    vi.mocked(prisma.kbArticle.count).mockResolvedValue(1)

    const res = await GET(makeRequest("http://localhost/api/v1/kb"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.articles).toHaveLength(1)
    expect(body.data.total).toBe(1)
    expect(body.data.page).toBe(1)
    expect(body.data.limit).toBe(50)
  })

  it("applies search filter with case-insensitive contains", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([])
    vi.mocked(prisma.kbArticle.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/kb?search=reset"))

    const call = vi.mocked(prisma.kbArticle.findMany).mock.calls[0][0] as any
    expect(call.where.title).toEqual({ contains: "reset", mode: "insensitive" })
  })

  it("applies status filter", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([])
    vi.mocked(prisma.kbArticle.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/kb?status=draft"))

    const call = vi.mocked(prisma.kbArticle.findMany).mock.calls[0][0] as any
    expect(call.where.status).toBe("draft")
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.findMany).mockRejectedValue(new Error("DB error"))

    const res = await GET(makeRequest("http://localhost/api/v1/kb"))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe("Internal server error")
  })

  it("includes category relation in query", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([])
    vi.mocked(prisma.kbArticle.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/kb"))

    const call = vi.mocked(prisma.kbArticle.findMany).mock.calls[0][0] as any
    expect(call.include).toEqual({ category: true })
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/kb
// ---------------------------------------------------------------------------
describe("POST /api/v1/kb", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await POST(makeRequest("http://localhost/api/v1/kb", {
      method: "POST",
      body: JSON.stringify({ title: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when title is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const res = await POST(makeRequest("http://localhost/api/v1/kb", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it("creates article with all fields", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "a-new", title: "Guide", content: "Steps...", status: "draft", tags: ["help"] }
    vi.mocked(prisma.kbArticle.create).mockResolvedValue(created as any)

    const res = await POST(makeRequest("http://localhost/api/v1/kb", {
      method: "POST",
      body: JSON.stringify({ title: "Guide", content: "Steps...", status: "draft", tags: ["help"] }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("a-new")

    const createCall = vi.mocked(prisma.kbArticle.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
    expect(createCall.data.title).toBe("Guide")
    expect(createCall.data.tags).toEqual(["help"])
  })

  it("returns 500 on create error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.create).mockRejectedValue(new Error("constraint"))

    const res = await POST(makeRequest("http://localhost/api/v1/kb", {
      method: "POST",
      body: JSON.stringify({ title: "Fail" }),
    }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/kb/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/kb/:id", () => {
  it("returns article when found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const article = { id: "a1", title: "Found", organizationId: "org-1", category: { id: "cat1", name: "FAQ" } }
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue(article as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/kb/a1"), makeParams("a1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("a1")
  })

  it("returns 404 when article not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/kb/nope"), makeParams("nope"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/kb/a1"), makeParams("a1"))
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/kb/:id
// ---------------------------------------------------------------------------
describe("PUT /api/v1/kb/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("a1")
    )
    expect(res.status).toBe(401)
  })

  it("updates article successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.updateMany).mockResolvedValue({ count: 1 } as any)
    const updated = { id: "a1", title: "Updated", organizationId: "org-1", category: null }
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue(updated as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "PUT", body: JSON.stringify({ title: "Updated" }) }),
      makeParams("a1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.title).toBe("Updated")
  })

  it("returns 404 when article not found for update", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("a1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("validates status enum on update", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const res = await PUT(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "PUT", body: JSON.stringify({ status: "invalid_status" }) }),
      makeParams("a1")
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/kb/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/kb/:id", () => {
  it("deletes article successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "DELETE" }),
      makeParams("a1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe("a1")
  })

  it("returns 404 when article not found for deletion", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.kbArticle.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "DELETE" }),
      makeParams("a1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/kb/a1", { method: "DELETE" }),
      makeParams("a1")
    )
    expect(res.status).toBe(401)
  })
})
