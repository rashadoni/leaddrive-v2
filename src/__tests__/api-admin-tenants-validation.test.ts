/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    planTemplate: { findFirst: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn() }))

vi.mock("@/lib/tenant-provisioning", () => ({
  validateSlug: vi.fn(),
  provisionTenant: vi.fn(),
}))

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))

vi.mock("@/lib/cloudflare-dns", () => ({
  isCloudflareConfigured: vi.fn(() => false),
  createDnsRecord: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))

import { POST } from "@/app/api/v1/admin/tenants/route"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { provisionTenant, validateSlug } from "@/lib/tenant-provisioning"

const AUTH = {
  orgId: "platform",
  userId: "super-1",
  role: "superadmin" as const,
  email: "super@leaddrivecrm.org",
  name: "Super",
}

/** What the admin wizard posts once all five of its steps are filled in. */
function wizardBody(primaryBrand: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "new-tenant-wizard-20260910-001",
    companyName: "Fanum",
    slug: "fanum",
    adminName: "Fanum Admin",
    adminEmail: "admin@fanum.az",
    plan: "enterprise",
    branding: { primaryColor: "#F4510B" },
    features: ["crm", "omnichannel"],
    seedDemoData: false,
    primaryBrand: {
      name: "Fanum",
      languages: ["az", "ru", "en"],
      geographies: ["Azerbaijan"],
      ...primaryBrand,
    },
    channels: ["email", "webchat", "whatsapp", "instagram", "telegram"],
    providers: [
      { providerKey: "serpapi", billingMode: "disabled", enabled: false, spendPolicy: { sourceOfTruth: "tenant_policy" } },
    ],
    ...rest,
  }
}

function makeReq(body: unknown) {
  return new NextRequest(new URL("/api/v1/admin/tenants", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireSuperAdmin as any).mockResolvedValue(AUTH)
  ;(validateSlug as any).mockResolvedValue({ valid: true })
  ;(prisma.planTemplate.findFirst as any).mockResolvedValue({ key: "enterprise", name: "Enterprise", isActive: true })
  ;(provisionTenant as any).mockResolvedValue({
    organization: { id: "org-1", name: "Fanum", slug: "fanum", plan: "enterprise" },
    user: { id: "user-1", email: "admin@fanum.az", name: "Fanum Admin" },
    tempPassword: "temp-password",
    url: "https://fanum.leaddrivecrm.org",
    provisioning: { id: "run-1", status: "succeeded", steps: [] },
  })
})

describe("POST /api/v1/admin/tenants — brand website", () => {
  it("accepts a website typed without a scheme and stores it as https", async () => {
    const response = await POST(makeReq(wizardBody({ website: "fanum.az" })))

    expect(response.status).toBe(201)
    expect((provisionTenant as any).mock.calls[0][0].primaryBrand.website).toBe("https://fanum.az")
  })

  it("leaves an explicit scheme alone", async () => {
    const response = await POST(makeReq(wizardBody({ website: "http://fanum.az" })))

    expect(response.status).toBe(201)
    expect((provisionTenant as any).mock.calls[0][0].primaryBrand.website).toBe("http://fanum.az")
  })

  it("rejects a non-http scheme instead of storing a script URL as the brand link", async () => {
    const response = await POST(makeReq(wizardBody({ website: "javascript://leaddrivecrm.org" })))

    expect(response.status).toBe(400)
    expect(provisionTenant).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/admin/tenants — rejection messages", () => {
  it("names the field that failed, not just that something did", async () => {
    const response = await POST(makeReq(wizardBody({ website: "https://" })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/^primaryBrand\.website: /)
    expect(body.error).not.toBe("Invalid input")
  })

  it("points at the offending array element", async () => {
    const response = await POST(makeReq(wizardBody({}, { channels: ["email", "sms"] })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/^channels\.1: /)
  })

  it("names the support email too", async () => {
    const response = await POST(makeReq(wizardBody({ supportEmail: "info@fanum" })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/^primaryBrand\.supportEmail: /)
  })
})
