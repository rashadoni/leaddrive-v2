import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "USD",
  CURRENCY_SYMBOLS: { AZN: "₼", USD: "$", EUR: "€" },
}))

import { GET, POST } from "@/app/api/v1/products/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/products/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { Prisma } from "@prisma/client"

function makeRequest(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
})

// ---------------------------------------------------------------------------
// GET /api/v1/products
// ---------------------------------------------------------------------------
describe("GET /api/v1/products", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET(makeRequest("http://localhost/api/v1/products"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns products ordered by name asc", async () => {
    const mockProducts = [
      { id: "p1", name: "Alpha", price: 100 },
      { id: "p2", name: "Beta", price: 200 },
    ]
    vi.mocked(prisma.product.findMany).mockResolvedValue(mockProducts as any)

    const res = await GET(makeRequest("http://localhost/api/v1/products"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.orderBy).toEqual({ name: "asc" })
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/products
// ---------------------------------------------------------------------------
describe("POST /api/v1/products", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it("accepts a null description — the form sends one for every empty field", async () => {
    /*
     * Форма шлёт `description: description || null`. Схема создания требовала
     * строку, поэтому продукт без описания создать было НЕЛЬЗЯ: 400 «expected
     * string, received null», а экран показывал глухое «Не удалось создать».
     * Обновление того же продукта работало — там поле всегда было nullable.
     * Воспроизведено на проде 2026-09-10.
     */
    vi.mocked(prisma.product.create).mockResolvedValue({ id: "p9", name: "No description" } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        name: "No description",
        description: null,
        category: "service",
        price: 0,
        currency: "USD",
        isActive: true,
        features: [],
        tags: [],
        sku: null,
        productType: "subscription",
      }),
    }))

    expect(res.status).toBe(201)
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: null }) }),
    )
  })

  it("still refuses a description that is neither text nor null", async () => {
    // Негативный якорь: nullable — это не «любой тип».
    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Bad description", description: 42 }),
    }))
    expect(res.status).toBe(400)
    expect(prisma.product.create).not.toHaveBeenCalled()
  })
  it.each([-1, 1_000_000_000])("rejects an invalid product price (%s)", async (price) => {
    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Invalid price", price }),
    }))

    expect(res.status).toBe(400)
    expect(prisma.product.create).not.toHaveBeenCalled()
  })

  it("rejects unsupported product currencies", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Crypto product", currency: "BTC" }),
    }))

    expect(res.status).toBe(400)
    expect(prisma.product.create).not.toHaveBeenCalled()
  })

  it("creates a product with defaults and returns 201", async () => {
    const created = { id: "p-new", name: "Widget", category: "service", price: 0, currency: "USD", isActive: true }
    vi.mocked(prisma.product.create).mockResolvedValue(created as any)

    const res = await POST(makeRequest("http://localhost/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Widget" }),
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("p-new")

    const call = vi.mocked(prisma.product.create).mock.calls[0][0] as any
    expect(call.data.organizationId).toBe("org-1")
    expect(call.data.category).toBe("service")
    expect(call.data.price).toBe(0)
    expect(call.data.currency).toBe("USD")
    expect(call.data.isActive).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/products/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/products/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/products/prod-1"), makeParams("prod-1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when product not found", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/products/prod-1"), makeParams("prod-1"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Product not found")
  })

  it("returns product when found", async () => {
    const product = { id: "prod-1", name: "Widget", organizationId: "org-1" }
    vi.mocked(prisma.product.findFirst).mockResolvedValue(product as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/products/prod-1"), makeParams("prod-1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("prod-1")

    const call = vi.mocked(prisma.product.findFirst).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: "prod-1", organizationId: "org-1" })
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/products/:id
// ---------------------------------------------------------------------------
describe("PUT /api/v1/products/:id", () => {
  it.each([-1, 1_000_000_000])("rejects an invalid product price (%s)", async (price) => {
    const res = await PUT(
      makeRequest("http://localhost/api/v1/products/prod-1", {
        method: "PUT",
        body: JSON.stringify({ price }),
      }),
      makeParams("prod-1")
    )

    expect(res.status).toBe(400)
    expect(prisma.product.updateMany).not.toHaveBeenCalled()
  })

  it("rejects unsupported product currencies", async () => {
    const res = await PUT(
      makeRequest("http://localhost/api/v1/products/prod-1", {
        method: "PUT",
        body: JSON.stringify({ currency: "BTC" }),
      }),
      makeParams("prod-1")
    )

    expect(res.status).toBe(400)
    expect(prisma.product.updateMany).not.toHaveBeenCalled()
  })

  it("normalizes supported product currencies before saving", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      id: "prod-1",
      currency: "AZN",
      organizationId: "org-1",
    } as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/products/prod-1", {
        method: "PUT",
        body: JSON.stringify({ currency: " azn " }),
      }),
      makeParams("prod-1")
    )

    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.product.updateMany).mock.calls[0][0] as any
    expect(updateCall.data.currency).toBe("AZN")
  })

  it("returns 404 when product not found (updateMany count 0)", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/products/prod-1", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Product not found")
  })

  it("updates a product and returns the updated record", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    const updated = { id: "prod-1", name: "Updated Widget", organizationId: "org-1" }
    vi.mocked(prisma.product.findFirst).mockResolvedValue(updated as any)

    const res = await PUT(
      makeRequest("http://localhost/api/v1/products/prod-1", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated Widget" }),
      }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.name).toBe("Updated Widget")

    // updateMany uses both id and organizationId
    const updateCall = vi.mocked(prisma.product.updateMany).mock.calls[0][0] as any
    expect(updateCall.where).toEqual({ id: "prod-1", organizationId: "org-1" })

    // NOTE: findFirst for the updated record uses only { id } without orgId
    const findCall = vi.mocked(prisma.product.findFirst).mock.calls[0][0] as any
    expect(findCall.where).toEqual({ id: "prod-1" })
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/products/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/products/:id", () => {
  it("returns 404 when product not found (deleteMany count 0)", async () => {
    vi.mocked(prisma.product.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/products/prod-1", { method: "DELETE" }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Product not found")
  })

  it("deletes a product and returns success without data", async () => {
    vi.mocked(prisma.product.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/products/prod-1", { method: "DELETE" }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toBeUndefined()

    // Verify deleteMany uses both id and organizationId
    const deleteCall = vi.mocked(prisma.product.deleteMany).mock.calls[0][0] as any
    expect(deleteCall.where).toEqual({ id: "prod-1", organizationId: "org-1" })
  })

  it("returns 409 when the product still has inventory stock (P2003 FK violation)", async () => {
    const fkError = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed on the field: `InventoryItem_productId_fkey`",
      { code: "P2003", clientVersion: "test" } as any,
    )
    vi.mocked(prisma.product.deleteMany).mockRejectedValue(fkError)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/products/prod-1", { method: "DELETE" }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain("inventory")
  })

  it("returns 500 with the canonical shape on an unexpected error", async () => {
    vi.mocked(prisma.product.deleteMany).mockRejectedValue(new Error("db unreachable"))

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/products/prod-1", { method: "DELETE" }),
      makeParams("prod-1")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})
