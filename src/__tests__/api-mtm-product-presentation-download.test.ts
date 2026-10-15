/**
 * «Скачать» on the product catalog (/mtm/products, 2026-10-15): the file of a
 * product, to whoever the catalog shows that product — the catalog's own rule
 * (`resolveMtmProductAccess`), nobody else.
 */
import { readFile, stat } from "node:fs/promises"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withRouteFieldWebRlsAuth: (_action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context: unknown) => handler(req, {
      orgId: "org-1",
      userId: "manager-user",
      role: "manager",
      email: "manager@example.com",
      name: "Manager",
    }, context),
  withRouteFieldRlsAuth: (_action: unknown, handler: unknown) => handler,
}))

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), stat: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/products/[id]/presentation/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const PDF = Buffer.from("%PDF-1.7 Forlaks")

const request = () => new NextRequest("http://localhost/api/v1/mtm/products/product-1/presentation")
const params = (id = "product-1") => ({ params: Promise.resolve({ id }) })

/** Two portfolios: «Gastro» with «Gastro / Kids» under it, and «Cardio». */
const GROUPS = [
  { id: "gastro", parentId: null, members: [] as Array<{ role: string }> },
  { id: "gastro-kids", parentId: "gastro", members: [] as Array<{ role: string }> },
  { id: "cardio", parentId: null, members: [] as Array<{ role: string }> },
]

function product(groupId: string, document: Record<string, unknown> | null = {}) {
  return {
    groupId,
    document: document && {
      fileName: "Forlaks prezentasiya.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.byteLength,
      storageKey: "b".repeat(48),
      deletedAt: null,
      mediaObject: null,
      ...document,
    },
  }
}

describe("GET /api/v1/mtm/products/:id/presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: PDF.byteLength } as never)
    vi.mocked(readFile).mockResolvedValue(PDF as never)
  })

  it("gives an administrator the file of any product, as a download with its own name", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue(GROUPS as never)
    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("cardio") as never)

    const response = await GET(request(), params())

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toContain("attachment;")
    expect(response.headers.get("Content-Disposition")).toContain("Forlaks%20prezentasiya.pdf")
    expect(prisma.mtmProduct.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "product-1", organizationId: "org-1" },
    }))
  })

  it("gives a manager the products of his group and of its subgroups", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["agent-1"] } as never)
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue(GROUPS.map((group) =>
      group.id === "gastro" ? { ...group, members: [{ role: "MANAGER" }] } : group) as never)

    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("gastro-kids") as never)
    expect((await GET(request(), params())).status).toBe(200)

    // A product of a group he is not in is answered as one that does not exist.
    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("cardio") as never)
    const outside = await GET(request(), params())
    expect(outside.status).toBe(404)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it("refuses a user the field module does not know", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)

    const response = await GET(request(), params())

    expect(response.status).toBe(403)
    expect(prisma.mtmProduct.findFirst).not.toHaveBeenCalled()
  })

  it("says the file is gone when it was deleted or its bytes are not all there", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue(GROUPS as never)

    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("gastro", { deletedAt: new Date() }) as never)
    expect((await GET(request(), params())).status).toBe(410)

    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("gastro", null) as never)
    expect((await GET(request(), params())).status).toBe(410)

    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue(product("gastro") as never)
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: PDF.byteLength - 1 } as never)
    const truncated = await GET(request(), params())
    expect(truncated.status).toBe(410)
    expect(await truncated.json()).toMatchObject({ code: "MTM_PRODUCT_PRESENTATION_UNAVAILABLE" })
  })
})
