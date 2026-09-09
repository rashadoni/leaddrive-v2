import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ───────── mocks ───────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    additionalSale: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pricingProfile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pricingGroup: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    pricingProfileCategory: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    pricingService: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    offer: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    journey: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    journeyEnrollment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    journeyStep: { update: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/invoice-html", () => ({
  generateInvoiceHtml: vi.fn().mockReturnValue("<html>invoice</html>"),
}))
vi.mock("@/lib/invoice-chain-template", () => ({
  getOrCreateInvoiceChainJourney: vi.fn().mockResolvedValue("j1"),
}))
vi.mock("@/lib/journey-engine", () => ({
  processEnrollmentStep: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock("@/lib/invoice-number", () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue("INV-001"),
}))
vi.mock("@/lib/invoice-calculations", () => ({
  calculateItemTotal: vi.fn().mockReturnValue(100),
  calculateInvoiceTotals: vi.fn().mockReturnValue({
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 18,
    totalAmount: 118,
  }),
  calculateDueDate: vi.fn().mockReturnValue(new Date("2026-06-01")),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import { auth } from "@/lib/auth"

/* ───────── route imports ───────── */

import { GET as salesGet, POST as salesPost } from "@/app/api/v1/pricing/additional-sales/route"
import {
  PUT as saleUpdate,
  DELETE as saleDelete,
} from "@/app/api/v1/pricing/additional-sales/[id]/route"
import { PUT as companyPut } from "@/app/api/v1/pricing/company/[code]/route"
import { DELETE as profileDelete } from "@/app/api/v1/pricing/delete/[code]/route"
import { GET as groupsGet, POST as groupsPost } from "@/app/api/v1/pricing/groups-db/route"
import {
  POST as catPost,
  DELETE as catDelete,
} from "@/app/api/v1/pricing/profiles/[id]/categories/route"
import {
  POST as svcPost,
  PUT as svcPut,
  DELETE as svcDelete,
} from "@/app/api/v1/pricing/profiles/[id]/services/route"
import { GET as pdfGet } from "@/app/api/v1/invoices/[id]/pdf/route"
import { GET as chainGet, POST as chainPost, DELETE as chainDelete } from "@/app/api/v1/invoices/[id]/chain/route"
import { POST as fixBalances } from "@/app/api/v1/invoices/fix-balances/route"
import { POST as fromOffer } from "@/app/api/v1/invoices/from-offer/route"

/* ───────── helpers ───────── */

const mkParams = (key: string, val: string) => Promise.resolve({ [key]: val }) as any

beforeEach(() => {
  vi.clearAllMocks()
  // The invoice PDF still resolves withRls through getOrgId; chain operations
  // now use permissioned withRlsAuth.
  vi.mocked(getSession).mockResolvedValue(null as any)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "u1",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as any)
})

/* ═══════════ ADDITIONAL SALES ═══════════ */

describe("Pricing additional-sales — GET", () => {
  it("returns 401 without orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await salesGet(new NextRequest("http://x/api/v1/pricing/additional-sales"))
    expect(res.status).toBe(401)
  })

  it("returns paginated sales", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.additionalSale.findMany).mockResolvedValue([{ id: "s1" }] as any)
    vi.mocked(prisma.additionalSale.count).mockResolvedValue(1)
    const res = await salesGet(new NextRequest("http://x/api/v1/pricing/additional-sales?page=1&limit=10"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.sales).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })
})

describe("Pricing additional-sales — POST", () => {
  it("returns 400 when required fields missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await salesPost(req)
    expect(res.status).toBe(400)
  })

  it("creates additional sale (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as any)
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.additionalSale.create).mockResolvedValue({ id: "s1", name: "Extra" } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ profileId: "p1", name: "Extra", type: "one_time", effectiveDate: "2026-05-01" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await salesPost(req)
    expect(res.status).toBe(201)
  })
})

/* ═══════════ ADDITIONAL SALES [id] ═══════════ */

describe("Pricing additional-sales [id] — PUT", () => {
  it("returns 404 when sale not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.additionalSale.findFirst).mockResolvedValue(null)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ name: "New" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await saleUpdate(req, { params: mkParams("id", "s1") })
    expect(res.status).toBe(404)
  })

  it("updates sale", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.additionalSale.findFirst).mockResolvedValue({ id: "s1", qty: 1, price: 50 } as any)
    vi.mocked(prisma.additionalSale.update).mockResolvedValue({ id: "s1", name: "Updated" } as any)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await saleUpdate(req, { params: mkParams("id", "s1") })
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe("Pricing additional-sales [id] — DELETE", () => {
  it("deletes sale", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.additionalSale.findFirst).mockResolvedValue({ id: "s1" } as any)
    vi.mocked(prisma.additionalSale.delete).mockResolvedValue({} as any)
    const res = await saleDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("id", "s1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe(true)
  })
})

/* ═══════════ PRICING COMPANY [code] ═══════════ */

describe("Pricing company [code] — PUT", () => {
  it("returns 404 when profile missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const req = new NextRequest("http://x", {
      method: "PUT",
      body: JSON.stringify({ categories: {} }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await companyPut(req, { params: mkParams("code", "ACME") })
    expect(res.status).toBe(404)
  })
})

/* ═══════════ PRICING DELETE [code] ═══════════ */

describe("Pricing delete [code] — DELETE", () => {
  it("returns 404 when profile missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const res = await profileDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("code", "ACME") })
    expect(res.status).toBe(404)
  })

  it("deletes profile", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.pricingProfile.delete).mockResolvedValue({} as any)
    const res = await profileDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("code", "ACME") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("ACME")
  })
})

/* ═══════════ PRICING GROUPS ═══════════ */

describe("Pricing groups-db — GET", () => {
  it("returns groups", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingGroup.findMany).mockResolvedValue([{ id: "g1", name: "Enterprise" }] as any)
    const res = await groupsGet(new NextRequest("http://x"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("Pricing groups-db — POST", () => {
  it("returns 400 when name missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    })
    const res = await groupsPost(req)
    expect(res.status).toBe(400)
  })

  it("creates group (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingGroup.aggregate).mockResolvedValue({ _max: { sortOrder: 2 } } as any)
    vi.mocked(prisma.pricingGroup.create).mockResolvedValue({ id: "g2", name: "SMB" } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "SMB" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await groupsPost(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.name).toBe("SMB")
  })
})

/* ═══════════ PRICING PROFILE CATEGORIES ═══════════ */

describe("Pricing profiles [id] categories — POST", () => {
  it("returns 404 when profile not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue(null)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ categoryId: "cat1" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await catPost(req, { params: mkParams("id", "p1") })
    expect(res.status).toBe(404)
  })

  it("creates profile category (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.pricingProfileCategory.create).mockResolvedValue({ id: "pc1", categoryId: "cat1" } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ categoryId: "cat1" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await catPost(req, { params: mkParams("id", "p1") })
    expect(res.status).toBe(201)
  })
})

/* ═══════════ PRICING PROFILE SERVICES ═══════════ */

describe("Pricing profiles [id] services — POST", () => {
  it("returns 400 on validation failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await svcPost(req, { params: mkParams("id", "p1") })
    expect(res.status).toBe(400)
  })

  it("creates service (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.pricingProfile.findFirst).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.pricingProfileCategory.findFirst).mockResolvedValue({ id: "pc1" } as any)
    vi.mocked(prisma.pricingService.aggregate).mockResolvedValue({ _max: { sortOrder: 0 } } as any)
    vi.mocked(prisma.pricingService.create).mockResolvedValue({ id: "svc1", name: "Monitoring" } as any)
    vi.mocked(prisma.pricingService.findMany).mockResolvedValue([{ total: 500 }] as any)
    vi.mocked(prisma.pricingProfileCategory.update).mockResolvedValue({} as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ profileCategoryId: "pc1", name: "Monitoring", qty: 5, price: 100 }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await svcPost(req, { params: mkParams("id", "p1") })
    expect(res.status).toBe(201)
  })
})

describe("Pricing profiles [id] services — DELETE", () => {
  it("returns 400 when serviceId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await svcDelete(
      new NextRequest("http://x/api/v1/pricing/profiles/p1/services", { method: "DELETE" }),
      { params: mkParams("id", "p1") },
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════ INVOICE PDF ═══════════ */

describe("Invoice [id] pdf — GET", () => {
  it("returns 404 when invoice missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null)
    const res = await pdfGet(new NextRequest("http://x"), { params: mkParams("id", "inv1") })
    expect(res.status).toBe(404)
  })

  it("returns HTML content", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: "inv1", invoiceNumber: "INV-001", items: [] } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ name: "Org", settings: {} } as any)
    const res = await pdfGet(new NextRequest("http://x"), { params: mkParams("id", "inv1") })
    expect(res.headers.get("Content-Type")).toContain("text/html")
  })
})

/* ═══════════ INVOICE CHAIN ═══════════ */

describe("Invoice [id] chain — GET", () => {
  it("returns null when no chain journey", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ chainJourneyId: null } as any)
    const res = await chainGet(new NextRequest("http://x"), { params: mkParams("id", "inv1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toBeNull()
  })
})

describe("Invoice [id] chain — POST setup", () => {
  it("creates chain journey", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ chainJourneyId: null, contactId: null } as any)
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({ id: "j1", steps: [] } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ action: "setup" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await chainPost(req, { params: mkParams("id", "inv1") })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.journey).toBeDefined()
  })
})

describe("Invoice [id] chain — DELETE", () => {
  it("returns 404 when no active chain", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: "inv1" } as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(null)
    const res = await chainDelete(new NextRequest("http://x", { method: "DELETE" }), { params: mkParams("id", "inv1") })
    expect(res.status).toBe(404)
  })
})

/* ═══════════ FIX BALANCES ═══════════ */

describe("Invoices fix-balances — POST", () => {
  it("returns 401 without orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await fixBalances(new NextRequest("http://x", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("fixes invoices with wrong balances", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv1",
        invoiceNumber: "INV-001",
        totalAmount: 1000,
        paidAmount: 0,
        balanceDue: 1000,
        status: "paid",
        paidAt: null,
        payments: [],
      },
    ] as any)
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as any)
    const res = await fixBalances(new NextRequest("http://x", { method: "POST" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.fixed).toBe(1)
  })
})

/* ═══════════ INVOICE FROM OFFER ═══════════ */

describe("Invoices from-offer — POST", () => {
  it("returns 400 when offerId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    })
    const res = await fromOffer(req)
    expect(res.status).toBe(400)
  })

  it("creates invoice from offer (201)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.offer.findFirst).mockResolvedValue({
      id: "o1",
      title: "Offer",
      items: [{ name: "Svc", quantity: 1, unitPrice: 100, discount: 0, sortOrder: 0 }],
      includeVat: true,
      discount: 0,
      currency: "AZN",
      voen: null,
      dealId: null,
      companyId: "co1",
      contactId: "ct1",
      recipientEmail: "a@b.com",
    } as any)
    vi.mocked(prisma.invoice.create).mockResolvedValue({
      id: "inv1",
      invoiceNumber: "INV-001",
      items: [],
    } as any)
    const req = new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ offerId: "o1" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await fromOffer(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.invoiceNumber).toBe("INV-001")
  })
})
