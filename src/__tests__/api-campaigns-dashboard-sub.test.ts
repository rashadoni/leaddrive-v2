import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ───────── mocks ───────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    campaignVariant: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    emailTemplate: { findFirst: vi.fn() },
    contact: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    contactSegment: { findFirst: vi.fn() },
    dashboardLayout: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: { findMany: vi.fn() },
    // executive dashboard aggregates
    company: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    deal: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    ticket: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    task: { count: vi.fn() },
    activity: { findMany: vi.fn(), count: vi.fn() },
    clientService: { groupBy: vi.fn() },
    lead2: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  const getSession = vi.fn().mockResolvedValue(null)
  return {
    getOrgId,
    getSession,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = (await getSession(req))?.orgId ?? await getOrgId(req)
      return orgId
        ? { orgId, userId: "u1", role: "admin", email: "a@b.com", name: "Test" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  renderTemplate: vi.fn().mockImplementation((html) => html),
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue({
    grandTotalG: 1000,
    summary: { totalRevenue: 5000, totalMargin: 4000, marginPct: 80, profitableClients: 5, lossClients: 1 },
    clients: [],
  }),
}))
vi.mock("@/lib/ai/predictive", () => ({
  generateRevenueForecast: vi.fn().mockResolvedValue({ committed: 100, bestCase: 200, pipeline: 300 }),
}))
vi.mock("@/lib/constants", () => ({
  ALL_ROLES: ["admin", "manager", "user"],
}))

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { auth } from "@/lib/auth"

/* ───────── campaign [id] routes ───────── */

import {
  GET as campaignGet,
  PUT as campaignPut,
  DELETE as campaignDelete,
} from "@/app/api/v1/campaigns/[id]/route"

import { POST as campaignSend } from "@/app/api/v1/campaigns/[id]/send/route"

import {
  GET as variantsGet,
  POST as variantsPost,
} from "@/app/api/v1/campaigns/[id]/variants/route"

import {
  PUT as variantPut,
  DELETE as variantDelete,
} from "@/app/api/v1/campaigns/[id]/variants/[variantId]/route"

/* ───────── dashboard routes ───────── */

import { GET as execGet } from "@/app/api/v1/dashboard/executive/route"
import { GET as layoutGet, PUT as layoutPut } from "@/app/api/v1/dashboard/layout/route"
import { GET as widgetGet, PUT as widgetPut } from "@/app/api/v1/dashboard/widget-config/route"

/* ───────── helpers ───────── */

// Returns a params promise that satisfies both overloads in the test suite
// (campaign-level + variant-level) without TS rejecting the wider shape.
const mkParams = (...ids: string[]): Promise<{ id: string; variantId: string }> => {
  return Promise.resolve({ id: ids[0], variantId: ids[1] || "" })
}

const sampleCampaign = {
  id: "c1",
  name: "Spring Sale",
  organizationId: "org-1",
  type: "email",
  status: "draft",
  subject: "Hello",
  templateId: null,
  recipientMode: "all",
  recipientIds: [],
  recipientSource: null,
  segmentId: null,
  isAbTest: false,
  testPercentage: 20,
}

beforeEach(() => vi.clearAllMocks())

/* ═══════════ CAMPAIGN [id] ═══════════ */

describe("Campaign [id] — GET", () => {
  it("returns 401 without orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await campaignGet(new NextRequest("http://x"), { params: mkParams("c1") })
    expect(res.status).toBe(401)
  })

  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(null)
    const res = await campaignGet(new NextRequest("http://x"), { params: mkParams("c1") })
    expect(res.status).toBe(404)
  })

  it("returns campaign data", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    const res = await campaignGet(new NextRequest("http://x"), { params: mkParams("c1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Spring Sale")
  })
})

describe("Campaign [id] — PUT", () => {
  it("returns 400 on invalid body", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ testPercentage: 5 }), // min 10
      headers: { "Content-Type": "application/json" },
    })
    const res = await campaignPut(req, { params: mkParams("c1") })
    expect(res.status).toBe(400)
  })

  it("rejects an unrealistically large campaign budget on update", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ budget: 1_000_000_000_000 }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await campaignPut(req, { params: mkParams("c1") })

    expect(res.status).toBe(400)
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled()
  })

  it("updates campaign", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ ...sampleCampaign, name: "Updated" } as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await campaignPut(req, { params: mkParams("c1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Updated")
  })
})

describe("Campaign [id] — DELETE", () => {
  it("does not delete when campaigns:delete authorization is denied", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await campaignDelete(
      new NextRequest("http://x", { method: "DELETE" }),
      { params: mkParams("c1") },
    )

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "delete")
    expect(prisma.campaign.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await campaignDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("c1") })
    expect(res.status).toBe(404)
  })

  it("deletes campaign", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await campaignDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("c1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("c1")
  })
})

/* ═══════════ CAMPAIGN SEND ═══════════ */

describe("Campaign [id] send — POST", () => {
  it("returns 404 when campaign missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(null)
    const res = await campaignSend(new NextRequest("http://x", { method: "POST" }), { params: mkParams("c1") })
    expect(res.status).toBe(404)
  })

  it("sends to contacts and returns count", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "ct1", email: "a@b.com", fullName: "Alice" },
    ] as any)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.campaign.update).mockResolvedValue({} as any)
    const res = await campaignSend(new NextRequest("http://x", { method: "POST" }), { params: mkParams("c1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.sent).toBe(1)
    expect(json.data.total).toBe(1)
  })
})

/* ═══════════ CAMPAIGN VARIANTS ═══════════ */

describe("Campaign variants — GET", () => {
  it("returns 404 when campaign not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(null)
    const res = await variantsGet(new NextRequest("http://x"), { params: mkParams("c1") })
    expect(res.status).toBe(404)
  })

  it("returns variants list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.campaignVariant.findMany).mockResolvedValue([{ id: "v1", name: "Variant A" }] as any)
    const res = await variantsGet(new NextRequest("http://x"), { params: mkParams("c1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("Campaign variants — POST", () => {
  it("returns 400 on empty name", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await variantsPost(req, { params: mkParams("c1") })
    expect(res.status).toBe(400)
  })

  it("creates variant (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.campaignVariant.create).mockResolvedValue({ id: "v1", name: "A", campaignId: "c1" } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "A" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await variantsPost(req, { params: mkParams("c1") })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.name).toBe("A")
  })
})

describe("Campaign variant [variantId] — PUT", () => {
  it("returns 404 when variant missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.campaignVariant.updateMany).mockResolvedValue({ count: 0 } as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ name: "B" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await variantPut(req, { params: mkParams("c1", "v1") })
    expect(res.status).toBe(404)
  })

  it("updates variant", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.campaignVariant.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.campaignVariant.findFirst).mockResolvedValue({ id: "v1", name: "B" } as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ name: "B" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await variantPut(req, { params: mkParams("c1", "v1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("B")
  })
})

describe("Campaign variant [variantId] — DELETE", () => {
  it("deletes variant", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(sampleCampaign as any)
    vi.mocked(prisma.campaignVariant.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await variantDelete(
      new NextRequest("http://x", { method: "DELETE" }),
      { params: mkParams("c1", "v1") },
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("v1")
  })
})

/* ═══════════ DASHBOARD LAYOUT ═══════════ */

describe("Dashboard layout — GET", () => {
  it("returns 401 without orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await layoutGet(new NextRequest("http://x"))
    expect(res.status).toBe(401)
  })

  it("returns null when no saved layout", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as any)
    vi.mocked(prisma.dashboardLayout.findFirst).mockResolvedValue(null)
    const res = await layoutGet(new NextRequest("http://x"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toBeNull()
  })
})

describe("Dashboard layout — PUT", () => {
  it("creates layout when none exists", async () => {
    // I2 slice 1: route now requires `{ layout: DashboardLayoutPayload }`
    // (the schema field is `layout`, prior `layoutConfig` was a pre-existing
    // bug). Payload validated via `validateLayout`.
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as any)
    vi.mocked(prisma.dashboardLayout.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.dashboardLayout.create).mockResolvedValue({} as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ layout: { version: 1, cols: 12, widgets: [] } }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await layoutPut(req)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.dashboardLayout.create).toHaveBeenCalled()
  })

  it("rejects malformed layout payload with 400 + issues", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({
        layout: {
          version: 1,
          cols: 12,
          widgets: [{
            id: "w1",
            type: "kpi_card",
            title: "Bad",
            position: { x: 0, y: 0, w: 3, h: 2 },
            config: {}, // missing required `metric`
          }],
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await layoutPut(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Invalid layout")
    expect(json.issues.length).toBeGreaterThan(0)
  })
})

/* ═══════════ WIDGET CONFIG ═══════════ */

describe("Widget config — GET", () => {
  it("returns default widgets when org has no overrides", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ role: "admin" }] as any)
    const res = await widgetGet(new NextRequest("http://x"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.widgets).toBeDefined()
    expect(json.data.widgets.risksBanner.enabled).toBe(true)
  })
})

describe("Widget config — PUT", () => {
  it("returns 400 with invalid body", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ widgets: null }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await widgetPut(req)
    expect(res.status).toBe(400)
  })

  it("saves widget config", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ widgets: { risksBanner: { enabled: false, roles: ["admin"] } } }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await widgetPut(req)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.organization.update).toHaveBeenCalled()
  })
})
