import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    pipeline: {
      findMany: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(() => false),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/unified-profile/profile-builder", () => ({ refreshProfileForSource: vi.fn().mockResolvedValue(undefined) }))

import { POST } from "@/app/api/v1/social/mentions/[id]/convert-to-lead/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { executeWorkflows } from "@/lib/workflow-engine"

const AUTH = { orgId: "org-1", userId: "user-1" }

function makeRequest(body?: unknown) {
  const url = new URL("/api/v1/social/mentions/m1/convert-to-lead", "http://localhost:3000")
  return new NextRequest(url, {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  })
}
const params = { params: Promise.resolve({ id: "m1" }) }

const MENTION = {
  id: "m1",
  organizationId: "org-1",
  platform: "twitter",
  authorName: "Jane Doe",
  authorHandle: "jane",
  url: "https://x.com/jane/1",
  sentiment: "negative",
  text: "Your product is broken",
  leadId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue(AUTH)
  ;(prisma.socialMention.findFirst as any).mockResolvedValue(MENTION)
  ;(prisma.lead.create as any).mockImplementation(({ data }: any) => Promise.resolve({ id: "lead-1", ...data }))
  ;(prisma.lead.delete as any).mockResolvedValue({})
  ;(prisma.socialMention.updateMany as any).mockResolvedValue({ count: 1 })
  ;(prisma.pipeline.findMany as any).mockResolvedValue([
    { id: "pipe-smm", name: "SMM" },
  ])
})

describe("POST /social/mentions/[id]/convert-to-lead", () => {
  it("uses the posted form overrides for the new lead", async () => {
    const res = await POST(makeRequest({
      contactName: "Jane Q. Doe",
      companyName: "Acme Corp",
      email: "jane@acme.com",
      phone: "+994501112233",
      telegramHandle: "@janeq",
      brand: "Pepsi",
      category: "vip",
      priority: "high",
      estimatedValue: 5000,
      notes: "Rep-edited notes",
    }), params as any)

    expect(res.status).toBe(200)
    const { data } = (prisma.lead.create as any).mock.calls[0][0]
    expect(data.contactName).toBe("Jane Q. Doe")
    expect(data.companyName).toBe("Acme Corp")
    expect(data.email).toBe("jane@acme.com")
    expect(data.phone).toBe("+994501112233")
    expect(data.telegramHandle).toBe("@janeq")
    expect(data.brand).toBe("Pepsi")
    expect(data.category).toBe("vip")
    expect(data.estimatedValue).toBe(5000)
    expect(data.notes).toBe("Rep-edited notes")
    expect(data.assignedTo).toBe("user-1")
    expect(data.pipelineId).toBe("pipe-smm")
    // mention is still claimed atomically
    expect(prisma.socialMention.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", leadId: null } }),
    )
    // first-class lead: side-effects fire on successful claim
    expect(fireWebhooks).toHaveBeenCalledWith(
      "org-1",
      "lead.created",
      expect.objectContaining({ id: "lead-1" }),
      { awaitDelivery: true },
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "lead",
      "created",
      expect.objectContaining({ id: "lead-1" }),
      { awaitExternalSideEffects: true },
    )
    expect(refreshProfileForSource).toHaveBeenCalledWith(prisma, "org-1", "lead", "lead-1")
  })

  it("rejects legacy one-click conversion when the mention has no phone", async () => {
    const res = await POST(makeRequest(), params as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "phone_required" })
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("assigns the social lead to the explicitly selected active salesperson", async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue({ id: "seller-1" })

    const res = await POST(makeRequest({
      contactName: "Jane Doe",
      assignedTo: "seller-1",
      phone: "+994501112233",
    }), params as any)

    expect(res.status).toBe(200)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: "seller-1",
        organizationId: "org-1",
        role: "sales",
        isActive: true,
      },
      select: { id: true },
    })
    expect((prisma.lead.create as any).mock.calls[0][0].data.assignedTo).toBe("seller-1")
  })

  it("rejects an invalid explicit salesperson before creating a lead", async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue(null)

    const res = await POST(makeRequest({
      contactName: "Jane Doe",
      assignedTo: "foreign-user",
    }), params as any)

    expect(res.status).toBe(400)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid email with 400 and creates no lead", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }), params as any)
    expect(res.status).toBe(400)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("returns 409 and deletes the orphan lead when the claim loses the race", async () => {
    ;(prisma.socialMention.updateMany as any).mockResolvedValue({ count: 0 })
    ;(prisma.socialMention.findUnique as any).mockResolvedValue({ leadId: "other-lead" })

    const res = await POST(makeRequest({ contactName: "X", phone: "+994501112233" }), params as any)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.data).toEqual({ leadId: "other-lead" })
    expect(prisma.lead.delete).toHaveBeenCalledWith({ where: { id: "lead-1" } })
    // the orphan lead is deleted → its side-effects must NOT fire
    expect(fireWebhooks).not.toHaveBeenCalled()
    expect(refreshProfileForSource).not.toHaveBeenCalled()
  })

  it("returns 409 without creating a lead when the mention is already converted", async () => {
    ;(prisma.socialMention.findFirst as any).mockResolvedValue({ ...MENTION, leadId: "existing-lead" })

    const res = await POST(makeRequest({ contactName: "X" }), params as any)
    expect(res.status).toBe(409)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })
})
