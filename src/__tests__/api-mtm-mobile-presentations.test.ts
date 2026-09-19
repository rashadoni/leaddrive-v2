import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as getProducts } from "@/app/api/v1/mtm/mobile/products/route"
import { POST as startPresentation } from "@/app/api/v1/mtm/mobile/presentation-sessions/route"
import { PATCH as savePresentation } from "@/app/api/v1/mtm/mobile/presentation-sessions/[id]/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Authorization: "Bearer mobile", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: "org-1",
    agentId: "agent-1",
    userId: "user-1",
    role: "AGENT",
    email: "agent@example.test",
    name: "Agent",
  } as never)
})

describe("mobile product presentation catalog", () => {
  it("inherits products from a directly assigned parent portfolio", async () => {
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue([
      { id: "portfolio", parentId: null, name: "Cardiology", description: null, sortOrder: 0, members: [{ role: "AGENT" }] },
      { id: "line", parentId: "portfolio", name: "Hypertension", description: null, sortOrder: 0, members: [] },
    ] as never)
    vi.mocked(prisma.mtmProduct.findMany).mockResolvedValue([{
      id: "product-1",
      groupId: "line",
      name: "Product A",
      description: null,
      presentationVersion: "2",
      updatedAt: new Date("2026-09-19T09:00:00.000Z"),
      document: {
        id: "document-1",
        title: "Product A",
        fileName: "product-a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_200,
        checksumSha256: "a".repeat(64),
        deletedAt: null,
      },
    }] as never)

    const response = await getProducts(request("/api/v1/mtm/mobile/products"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.groups.map((group: { id: string }) => group.id)).toEqual(["portfolio", "line"])
    expect(json.data.products[0]).toMatchObject({
      id: "product-1",
      downloadUrl: "/api/v1/mtm/mobile/documents/document-1/download",
    })
  })
})

describe("mobile presentation evidence", () => {
  it("starts an idempotent visit-bound session with the current file snapshot", async () => {
    vi.mocked(prisma.mtmPresentationSession.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      customerId: "customer-1",
      checkInAt: new Date("2026-09-19T10:00:00.000Z"),
      checkOutAt: null,
    } as never)
    vi.mocked(prisma.mtmProductGroup.findMany).mockResolvedValue([
      { id: "group-1", parentId: null, members: [{ id: "member-1" }] },
    ] as never)
    vi.mocked(prisma.mtmProduct.findFirst).mockResolvedValue({
      id: "product-1",
      groupId: "group-1",
      presentationVersion: "7",
      document: { id: "document-1", deletedAt: null },
    } as never)
    vi.mocked(prisma.mtmPresentationSession.create).mockResolvedValue({ id: "session-1" } as never)

    const response = await startPresentation(request("/api/v1/mtm/mobile/presentation-sessions", "POST", {
      clientSessionId: "device-session-1",
      visitId: "visit-1",
      productId: "product-1",
      openedAt: "2026-09-19T10:10:00.000Z",
      location: { latitude: 40.4093, longitude: 49.8671 },
      pageCount: 12,
    }))

    expect(response.status).toBe(201)
    expect(prisma.mtmPresentationSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        customerId: "customer-1",
        documentId: "document-1",
        presentationVersion: "7",
        openLat: 40.4093,
        openLng: 49.8671,
      }),
    })
  })

  it("normalizes page evidence and clamps active time to elapsed time", async () => {
    vi.mocked(prisma.mtmPresentationSession.findFirst).mockResolvedValue({
      id: "session-1",
      organizationId: "org-1",
      agentId: "agent-1",
      openedAt: new Date("2026-09-19T10:00:00.000Z"),
      closedAt: null,
      pageCount: 12,
      lastPage: null,
      closeLat: null,
      closeLng: null,
    } as never)
    vi.mocked(prisma.mtmPresentationSession.update).mockResolvedValue({ id: "session-1", closedAt: new Date("2026-09-19T10:05:00.000Z") } as never)

    const response = await savePresentation(
      request("/api/v1/mtm/mobile/presentation-sessions/session-1", "PATCH", {
        lastViewedAt: "2026-09-19T10:05:00.000Z",
        activeDurationSeconds: 900,
        pageCount: 12,
        lastPage: 4,
        pagesViewed: [4, 2, 4],
        pageEvents: [{ page: 2, viewedAt: "2026-09-19T10:02:00.000Z" }],
        closedAt: "2026-09-19T10:05:00.000Z",
        closeLocation: { latitude: 40.4094, longitude: 49.8672 },
      }),
      { params: Promise.resolve({ id: "session-1" }) },
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmPresentationSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        activeDurationSeconds: 300,
        pagesViewed: [2, 4],
        closeLat: 40.4094,
        closeLng: 49.8672,
      }),
    })
  })
})
