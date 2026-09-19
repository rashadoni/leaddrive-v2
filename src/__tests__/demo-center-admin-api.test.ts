import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const sendDemoAccessEmail = vi.hoisted(() => vi.fn())
const requireSuperAdmin = vi.hoisted(() => vi.fn())

vi.mock("@/lib/demo-center/email", () => ({ sendDemoAccessEmail }))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    demoRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    demoGrant: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    demoAccessEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

import { POST as issueDemo } from "@/app/api/v1/admin/demo-requests/[id]/issue/route"
import { prisma } from "@/lib/prisma"

const REQUEST_ID = "request-1"

function request() {
  return new NextRequest(`http://localhost:3000/api/v1/admin/demo-requests/${REQUEST_ID}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moduleIds: ["crm", "sales"],
      linkValidDays: 7,
      sessionDurationMinutes: 120,
      inactivityMinutes: 30,
      locale: "az",
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireSuperAdmin.mockResolvedValue({
    orgId: "platform",
    userId: "superadmin-1",
    role: "superadmin",
    email: "admin@example.az",
    name: "Admin",
  })
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
    return await run(prisma) as never
  })
  vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue({
    id: REQUEST_ID,
    status: "SUBMITTED",
    name: "Prospect",
    company: "Example MMC",
    email: "buyer@example.az",
  } as never)
  vi.mocked(prisma.demoGrant.findMany).mockResolvedValue([])
  vi.mocked(prisma.demoGrant.create).mockResolvedValue({ id: "grant-1" } as never)
  vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.demoAccessEvent.createMany).mockResolvedValue({ count: 0 })
  sendDemoAccessEmail.mockResolvedValue({ success: true, messageId: "message-1" })
})

describe("Demo Center admin issuance races", () => {
  it("issues only after request and grant compare-and-set transitions succeed", async () => {
    vi.mocked(prisma.demoRequest.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })

    const response = await issueDemo(request(), { params: Promise.resolve({ id: REQUEST_ID }) })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, grantId: "grant-1", status: "SENT" })
    expect(prisma.demoGrant.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "grant-1", status: "ISSUING" },
      data: expect.objectContaining({ status: "SENT" }),
    }))
  })

  it("does not create or email access when rejection wins the initial request lock", async () => {
    vi.mocked(prisma.demoRequest.updateMany).mockResolvedValue({ count: 0 })

    const response = await issueDemo(request(), { params: Promise.resolve({ id: REQUEST_ID }) })

    expect(response.status).toBe(409)
    expect(prisma.demoGrant.create).not.toHaveBeenCalled()
    expect(sendDemoAccessEmail).not.toHaveBeenCalled()
  })

  it("does not resurrect a grant revoked while its email was in flight", async () => {
    vi.mocked(prisma.demoRequest.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 0 })

    const response = await issueDemo(request(), { params: Promise.resolve({ id: REQUEST_ID }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ success: false })
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "SENT" }),
    })
  })

  it("does not overwrite revocation when delivery itself fails", async () => {
    vi.mocked(prisma.demoRequest.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 0 })
    sendDemoAccessEmail.mockResolvedValue({ success: false, error: "provider unavailable" })

    const response = await issueDemo(request(), { params: Promise.resolve({ id: REQUEST_ID }) })

    expect(response.status).toBe(409)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "DELIVERY_FAILED" }),
    })
  })
})
