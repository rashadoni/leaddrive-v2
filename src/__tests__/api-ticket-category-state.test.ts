/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: any) =>
    (request: NextRequest, context?: unknown) => handler(request, {
      orgId: "org-1",
      userId: "admin-1",
      role: "admin",
    }, context),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticketCategory: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { DELETE, PATCH } from "@/app/api/v1/ticket-categories/[id]/route"
import { prisma } from "@/lib/prisma"

const context = { params: Promise.resolve({ id: "category-1" }) }
const request = (method: string, body?: unknown) => new NextRequest(
  "http://localhost:3000/api/v1/ticket-categories/category-1",
  {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  },
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ticketCategory.findFirst).mockResolvedValue({ id: "category-1" } as never)
  vi.mocked(prisma.ticketCategory.update).mockResolvedValue({
    id: "category-1",
    isActive: false,
    isPortalVisible: true,
  } as never)
})

describe("ticket category lifecycle state", () => {
  it("deactivates without erasing the configured portal preference", async () => {
    const response = await DELETE(request("DELETE"), context)

    expect(response.status).toBe(200)
    expect(prisma.ticketCategory.findFirst).toHaveBeenCalledWith({
      where: { id: "category-1", organizationId: "org-1" },
      select: { id: true },
    })
    expect(prisma.ticketCategory.update).toHaveBeenCalledWith({
      where: { id: "category-1" },
      data: { isActive: false },
    })
  })

  it("restores the category through the tenant-validated update path", async () => {
    vi.mocked(prisma.ticketCategory.update).mockResolvedValue({ id: "category-1", isActive: true } as never)

    const response = await PATCH(request("PATCH", { isActive: true }), context)

    expect(response.status).toBe(200)
    expect(prisma.ticketCategory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "category-1", organizationId: "org-1" },
    }))
    expect(prisma.ticketCategory.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: true },
    }))
  })
})
