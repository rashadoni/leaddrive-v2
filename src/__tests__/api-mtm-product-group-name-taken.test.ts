/**
 * Two product groups with one name under one parent are refused by the table
 * ((organizationId, parentId, name) is unique). The route answered that with
 * «Failed to create product group», 500, and the catalog screen could only
 * say «could not save»; it now says the name is taken (2026-10-15).
 */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withRouteFieldRlsAuth: (_action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context: unknown) => handler(req, {
      orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin", principal: "web",
    }, context),
}))

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST } from "@/app/api/v1/mtm/product-groups/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/v1/mtm/product-groups", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}), undefined as never)

describe("POST /api/v1/mtm/product-groups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue([] as never)
  })

  it("says the name is taken when the table already has it under that parent", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))

    const response = await post({ name: "Gastro" })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "A group with this name already exists here", code: "MTM_PRODUCT_GROUP_NAME_TAKEN" })
  })

  it("still answers any other failure as one", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("connection reset"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await post({ name: "Gastro" })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: "MTM_PRODUCT_GROUP_CREATE_FAILED" })
    spy.mockRestore()
  })
})
