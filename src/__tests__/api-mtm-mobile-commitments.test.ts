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

import { GET } from "@/app/api/v1/mtm/mobile/commitments/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/commitments${query}`, {
    headers: { Authorization: "Bearer mobile-token" },
  })
}

describe("GET /api/v1/mtm/mobile/commitments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockReturnValue({ orgId: "org-1", agentId: "agent-1" } as never)
    vi.mocked(prisma.mtmCommitment.findMany).mockResolvedValue([])
  })

  it("scopes open commitments to the authenticated tenant and agent", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCommitment.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      organizationId: "org-1",
      agentId: "agent-1",
      fulfillment: { is: null },
    })
  })

  it("serializes Decimal quantities and derives overdue status", async () => {
    vi.mocked(prisma.mtmCommitment.findMany).mockResolvedValue([{
      id: "commitment-1",
      clientCommitmentId: "client-commitment-1",
      visitId: "visit-1",
      customerId: "customer-1",
      contactId: null,
      productExternalId: "sku-1",
      productName: "ACC",
      brandExternalId: null,
      brandName: "ACC",
      promisedQuantity: { toString: () => "10.50" },
      unit: "packs",
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
      note: null,
      submittedAt: new Date("2019-12-01T00:00:00.000Z"),
      customer: { id: "customer-1", name: "Clinic", objectType: "CLINIC", address: null, city: null },
      contact: null,
      evidencePhoto: null,
      fulfillment: null,
    }] as never)

    const response = await GET(request("?scope=all"))
    const body = await response.json()
    expect(body.data.commitments[0]).toMatchObject({
      promisedQuantity: 10.5,
      status: "OVERDUE",
    })
    const args = vi.mocked(prisma.mtmCommitment.findMany).mock.calls[0][0] as any
    expect(args.where.fulfillment).toBeUndefined()
  })

  it("filters a visit and rejects an oversized visit identity", async () => {
    const ok = await GET(request("?visitId=visit-1"))
    expect(ok.status).toBe(200)
    const args = vi.mocked(prisma.mtmCommitment.findMany).mock.calls[0][0] as any
    expect(args.where.visitId).toBe("visit-1")

    const invalid = await GET(request(`?visitId=${"x".repeat(129)}`))
    expect(invalid.status).toBe(400)
  })
})
