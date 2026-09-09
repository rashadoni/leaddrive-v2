import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findMany: vi.fn() },
    account: { findFirst: vi.fn() },
    planTemplate: { findFirst: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/superadmin-guard", () => ({
  requireSuperAdmin: vi.fn(),
}))

vi.mock("@/lib/tenant-provisioning", () => ({
  provisionTenant: vi.fn(),
  validateSlug: vi.fn(),
  deactivateTenant: vi.fn(),
  activateTenant: vi.fn(),
  scheduleTenantDeletion: vi.fn(),
  hardDeleteTenant: vi.fn(),
  cancelTenantDeletion: vi.fn(),
  assertTenantWorkforceRetentionClear: vi.fn(),
  WorkforceRetentionBlockedError: class WorkforceRetentionBlockedError extends Error {
    readonly code = "WORKFORCE_RETENTION_BLOCKED"
  },
}))

vi.mock("@/lib/tenant-export", () => ({
  exportTenantData: vi.fn(),
}))

vi.mock("@/lib/cloudflare-dns", () => ({
  createDnsRecord: vi.fn(),
  deleteDnsRecord: vi.fn(),
  isCloudflareConfigured: vi.fn(),
}))

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/emails/welcome-tenant", () => ({ getWelcomeTenantEmail: vi.fn().mockReturnValue({ subject: "Welcome", html: "<p>Hi</p>" }) }))
vi.mock("@/lib/emails/tenant-deletion", () => ({
  getDeletionScheduledEmail: vi.fn().mockReturnValue({ subject: "Scheduled", html: "<p>Scheduled</p>" }),
  getDeletionCompletedEmail: vi.fn().mockReturnValue({ subject: "Deleted", html: "<p>Deleted</p>" }),
  getDeletionCancelledEmail: vi.fn().mockReturnValue({ subject: "Cancelled", html: "<p>Cancelled</p>" }),
}))
vi.mock("@/lib/tenant-plans", () => ({ PLAN_LABELS: { starter: "Starter", professional: "Professional", enterprise: "Enterprise" } }))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  RATE_LIMIT_CONFIG: {},
}))
vi.mock("child_process", () => ({ execFile: vi.fn() }))

import { GET, POST } from "@/app/api/v1/admin/tenants/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/admin/tenants/[id]/route"
import { POST as DNS_POST, DELETE as DNS_DELETE } from "@/app/api/v1/admin/tenants/[id]/dns/route"
import { GET as GET_EXPORT } from "@/app/api/v1/admin/tenants/[id]/export/route"
import { POST as CANCEL_DELETION } from "@/app/api/v1/admin/tenants/[id]/cancel-deletion/route"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import {
  provisionTenant,
  validateSlug,
  scheduleTenantDeletion,
  hardDeleteTenant,
  cancelTenantDeletion,
  assertTenantWorkforceRetentionClear,
  WorkforceRetentionBlockedError,
} from "@/lib/tenant-provisioning"
import { exportTenantData } from "@/lib/tenant-export"
import { sendEmail } from "@/lib/email"
import { createDnsRecord, deleteDnsRecord, isCloudflareConfigured } from "@/lib/cloudflare-dns"
import { checkRateLimit } from "@/lib/rate-limit"
import { execFile } from "child_process"

const AUTH = { orgId: "org-1", userId: "user-1", role: "superadmin" as const, email: "admin@test.com", name: "Admin" }

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH as any)
})

// ─── GET /api/v1/admin/tenants ──────────────────────────────────────

describe("GET /api/v1/admin/tenants", () => {
  it("returns 403 when not superadmin", async () => {
    const { NextResponse } = await import("next/server")
    vi.mocked(requireSuperAdmin).mockResolvedValue(
      NextResponse.json({ error: "Forbidden: superadmin access required" }, { status: 403 }),
    )

    const res = await GET(makeReq("http://localhost:3000/api/v1/admin/tenants"))
    expect(res.status).toBe(403)
  })

  it("returns list of tenants with counts", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      {
        id: "t1", name: "Acme", slug: "acme", plan: "starter", isActive: true,
        serverType: "shared", maxUsers: 5, maxContacts: 1000,
        provisionedAt: new Date(), provisionedBy: "user-1", createdAt: new Date(),
        _count: { users: 2, contacts: 50, deals: 5, companies: 10, tickets: 3 },
      },
    ] as any)

    const res = await GET(makeReq("http://localhost:3000/api/v1/admin/tenants"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].slug).toBe("acme")
    expect(json.data[0]._count.users).toBe(2)
  })
})

// ─── POST /api/v1/admin/tenants ─────────────────────────────────────

describe("POST /api/v1/admin/tenants", () => {
  it("returns 429 when rate limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)

    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X", slug: "x", adminName: "A", adminEmail: "a@b.com" }),
    }))
    expect(res.status).toBe(429)
  })

  it("returns 400 when required fields missing", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X" }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Required fields")
  })

  it("returns 400 for invalid email format", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X", slug: "x", adminName: "A", adminEmail: "not-an-email" }),
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Invalid email format")
  })

  it("provisions tenant and returns 201", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key: "starter", name: "Starter" } as any)
    vi.mocked(provisionTenant).mockResolvedValue({
      organization: { id: "t-new", name: "NewCo", plan: "starter" },
      user: { id: "u-new", email: "admin@newco.com", name: "Admin" },
      tempPassword: "temp123",
      url: "https://newco.leaddrivecrm.org",
    } as any)
    vi.mocked(isCloudflareConfigured).mockReturnValue(false)

    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "NewCo", slug: "newco", adminName: "Admin", adminEmail: "admin@newco.com" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.organization.id).toBe("t-new")
    expect(json.data.tempPassword).toBe("temp123")
  })

  it("passes the dedicated confirmation and password only through the demo seed child environment", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key: "starter", name: "Starter" } as any)
    vi.mocked(provisionTenant).mockResolvedValue({
      organization: { id: "t-seeded", name: "SeededCo", plan: "starter" },
      user: { id: "u-seeded", email: "admin@seededco.com", name: "Admin" },
      tempPassword: "PolicyPass123!",
      url: "https://seededco.leaddrivecrm.org",
    } as any)
    vi.mocked(isCloudflareConfigured).mockReturnValue(false)

    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({
        companyName: "SeededCo",
        slug: "seededco",
        adminName: "Admin",
        adminEmail: "admin@seededco.com",
        seedDemoData: true,
      }),
    }))

    expect(res.status).toBe(201)
    expect(execFile).toHaveBeenCalledOnce()
    const call = vi.mocked(execFile).mock.calls[0]
    expect(call?.[1]).toEqual(expect.arrayContaining([
      expect.stringContaining("scripts/seed-tenant-demo.mjs"),
      "--slug=seededco",
    ]))
    expect(call?.[1]).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--password=/)]))
    expect(call?.[2]).toEqual(expect.objectContaining({
      timeout: 300000,
      env: expect.objectContaining({
        CONFIRM_PROD: "tenant-demo-seed-v1",
        SEED_PASSWORD: "PolicyPass123!",
      }),
    }))
  })

  it("rejects a plan with no active PlanTemplate (400)", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X", slug: "xco", adminName: "A", adminEmail: "a@b.c", plan: "ghost" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects 2 base currencies in custom scaffolding (400)", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key: "starter", name: "Starter" } as any)
    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({
        companyName: "X", slug: "xco", adminName: "A", adminEmail: "a@b.c", plan: "starter",
        currencies: [
          { code: "USD", name: "USD", symbol: "$", exchangeRate: 1, isBase: true },
          { code: "EUR", name: "EUR", symbol: "€", exchangeRate: 0.9, isBase: true },
        ],
      }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects empty pipelineStages (400)", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key: "starter", name: "Starter" } as any)
    const res = await POST(makeReq("http://localhost:3000/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X", slug: "xco", adminName: "A", adminEmail: "a@b.c", plan: "starter", pipelineStages: [] }),
    }))
    expect(res.status).toBe(400)
  })
})

// ─── GET /api/v1/admin/tenants/:id ──────────────────────────────────

describe("GET /api/v1/admin/tenants/:id", () => {
  it("returns 404 when tenant not found", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/admin/tenants/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Tenant not found")
  })

  it("returns tenant details with users and counts", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: "t1", name: "Acme", slug: "acme", plan: "professional", isActive: true,
      serverType: "shared", serverIp: null, maxUsers: 10, maxContacts: 5000,
      features: "{}", branding: "{}", addons: null,
      provisionedAt: new Date(), provisionedBy: "user-1",
      createdAt: new Date(), updatedAt: new Date(),
      users: [{ id: "u1", name: "Admin", email: "admin@acme.com", role: "admin", createdAt: new Date() }],
      _count: { users: 1, contacts: 100, deals: 10, companies: 20, leads: 5 },
    } as any)

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/admin/tenants/t1"), makeParams("t1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.slug).toBe("acme")
    expect(json.data.users).toHaveLength(1)
    expect(json.data._count.contacts).toBe(100)
  })
})

// ─── PUT /api/v1/admin/tenants/:id ──────────────────────────────────

describe("PUT /api/v1/admin/tenants/:id", () => {
  it("returns 404 when tenant not found", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/admin/tenants/missing", { method: "PUT", body: JSON.stringify({ name: "X" }) }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("updates tenant and returns updated data", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: "t1", name: "Acme", slug: "acme", plan: "starter", isActive: true,
    } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({
      id: "t1", name: "Acme Pro", slug: "acme", plan: "professional", isActive: true, maxUsers: 20, maxContacts: 10000,
    } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1", {
        method: "PUT",
        body: JSON.stringify({ name: "Acme Pro", plan: "professional", maxUsers: 20 }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Acme Pro")
    expect(json.data.plan).toBe("professional")
  })
})

// ─── DELETE /api/v1/admin/tenants/:id ───────────────────────────────

describe("DELETE /api/v1/admin/tenants/:id", () => {
  it("schedules deletion (soft delete) without force param", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", slug: "acme", plan: "starter" } as any)
    const deletionDate = new Date(Date.now() + 30 * 86400000)
    vi.mocked(scheduleTenantDeletion).mockResolvedValue(deletionDate)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message).toContain("scheduled for deletion")
    expect(json.deletionScheduledAt).toBeDefined()
  })

  it("returns 400 when force=true but confirm slug does not match", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", slug: "acme" } as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1?force=true&confirm=wrong-slug", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Slug confirmation does not match")
  })

  it("force deletes tenant when slug confirmed", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", slug: "acme", plan: "starter" } as any)
    vi.mocked(assertTenantWorkforceRetentionClear).mockResolvedValue(undefined as never)
    vi.mocked(exportTenantData).mockResolvedValue({ filename: "acme-export.json", data: {} } as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
    vi.mocked(hardDeleteTenant).mockResolvedValue(undefined as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1?force=true&confirm=acme", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message).toContain("permanently deleted")
    expect(hardDeleteTenant).toHaveBeenCalledWith("t1")
  })

  it("blocks force deletion before export when Workforce retention applies", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", slug: "acme", plan: "starter" } as any)
    vi.mocked(assertTenantWorkforceRetentionClear).mockRejectedValue(new WorkforceRetentionBlockedError())

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1?force=true&confirm=acme", { method: "DELETE" }),
      makeParams("t1"),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "WORKFORCE_RETENTION_BLOCKED" })
    expect(exportTenantData).not.toHaveBeenCalled()
    expect(hardDeleteTenant).not.toHaveBeenCalled()
  })

  it("does not announce permanent deletion when a concurrent Workforce fact blocks it", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", slug: "acme", plan: "starter" } as any)
    vi.mocked(assertTenantWorkforceRetentionClear).mockResolvedValue(undefined as never)
    vi.mocked(exportTenantData).mockResolvedValue({ filename: "acme-export.json", data: {} } as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ email: "admin@acme.test" }] as any)
    vi.mocked(hardDeleteTenant).mockRejectedValue(new WorkforceRetentionBlockedError())

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/admin/tenants/t1?force=true&confirm=acme", { method: "DELETE" }),
      makeParams("t1"),
    )

    expect(res.status).toBe(409)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// ─── POST /api/v1/admin/tenants/:id/dns ─────────────────────────────

describe("POST /api/v1/admin/tenants/:id/dns", () => {
  it("returns 503 when Cloudflare not configured", async () => {
    vi.mocked(isCloudflareConfigured).mockReturnValue(false)

    const res = await DNS_POST(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/dns", { method: "POST" }), makeParams("t1"))
    expect(res.status).toBe(503)
  })

  it("creates DNS record for tenant", async () => {
    vi.mocked(isCloudflareConfigured).mockReturnValue(true)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", slug: "acme", serverIp: null } as any)
    vi.mocked(createDnsRecord).mockResolvedValue({ success: true, recordId: "rec-1" } as any)

    const res = await DNS_POST(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/dns", { method: "POST" }), makeParams("t1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.recordId).toBe("rec-1")
  })
})

// ─── GET /api/v1/admin/tenants/:id/export ───────────────────────────

describe("GET /api/v1/admin/tenants/:id/export", () => {
  it("returns exported JSON with content-disposition header", async () => {
    vi.mocked(exportTenantData).mockResolvedValue({
      filename: "acme-2026-04-13.json",
      data: { organization: { name: "Acme" }, users: [] },
    } as any)

    const res = await GET_EXPORT(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/export"), makeParams("t1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(res.headers.get("content-disposition")).toContain("acme-2026-04-13.json")
  })

  it("returns 500 when export fails", async () => {
    vi.mocked(exportTenantData).mockRejectedValue(new Error("Export failed"))

    const res = await GET_EXPORT(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/export"), makeParams("t1"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Export failed")
  })
})

// ─── POST /api/v1/admin/tenants/:id/cancel-deletion ────────────────

describe("POST /api/v1/admin/tenants/:id/cancel-deletion", () => {
  it("returns 404 when tenant not found", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await CANCEL_DELETION(makeReq("http://localhost:3000/api/v1/admin/tenants/missing/cancel-deletion", { method: "POST" }), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("returns 400 when no deletion is scheduled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", deletionScheduledAt: null } as any)

    const res = await CANCEL_DELETION(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/cancel-deletion", { method: "POST" }), makeParams("t1"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("No deletion is scheduled for this tenant")
  })

  it("cancels scheduled deletion and returns success", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: "t1", name: "Acme", deletionScheduledAt: new Date() } as any)
    vi.mocked(cancelTenantDeletion).mockResolvedValue(undefined as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await CANCEL_DELETION(makeReq("http://localhost:3000/api/v1/admin/tenants/t1/cancel-deletion", { method: "POST" }), makeParams("t1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message).toContain("Deletion cancelled")
    expect(cancelTenantDeletion).toHaveBeenCalledWith("t1")
  })
})
