import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    user: { count: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
}))

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
    }),
  },
}))

import {
  GET as orgGET,
  PUT as orgPUT,
} from "@/app/api/v1/settings/organization/route"
import {
  GET as rolesGET,
  POST as rolesPOST,
  PUT as rolesPUT,
  DELETE as rolesDELETE,
} from "@/app/api/v1/settings/roles/route"
import {
  GET as smtpGET,
  PUT as smtpPUT,
} from "@/app/api/v1/settings/smtp/route"
import { POST as smtpTestPOST } from "@/app/api/v1/settings/smtp/test/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth, isAuthError } from "@/lib/api-auth"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeJsonRequest(url: string, body: Record<string, unknown>, method = "POST") {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isAuthError).mockReturnValue(false)
})

// ---------------------------------------------------------------------------
// Organization Settings
// ---------------------------------------------------------------------------
describe("GET /api/v1/settings/organization", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await orgGET(makeRequest("/api/v1/settings/organization"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when organization not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
    const res = await orgGET(makeRequest("/api/v1/settings/organization"))
    expect(res.status).toBe(404)
  })

  it("returns organization data on success", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const orgData = { name: "Test Co", logo: null, slug: "test-co", plan: "starter", maxUsers: 3, maxContacts: 500 }
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(orgData as any)

    const res = await orgGET(makeRequest("/api/v1/settings/organization"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(orgData)
  })
})

describe("PUT /api/v1/settings/organization", () => {
  it("returns auth error when requireAuth fails", async () => {
    const authErr = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    vi.mocked(requireAuth).mockResolvedValue(authErr as any)
    vi.mocked(isAuthError).mockReturnValue(true)

    const res = await orgPUT(makeJsonRequest("/api/v1/settings/organization", { name: "X" }, "PUT"))
    expect(res.status).toBe(403)
  })

  it("returns 400 when name is empty", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
    const res = await orgPUT(makeJsonRequest("/api/v1/settings/organization", { name: "" }, "PUT"))
    expect(res.status).toBe(400)
  })

  it("updates organization and generates slug from name", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
    const updated = { name: "My New Org", logo: null, slug: "my-new-org", plan: "starter", maxUsers: 3, maxContacts: 500 }
    vi.mocked(prisma.organization.update).mockResolvedValue(updated as any)

    const res = await orgPUT(makeJsonRequest("/api/v1/settings/organization", { name: "My New Org" }, "PUT"))
    const json = await res.json()
    expect(json.success).toBe(true)

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: expect.objectContaining({ name: "My New Org", slug: "my-new-org" }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
describe("GET /api/v1/settings/roles", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await rolesGET(makeRequest("/api/v1/settings/roles"))
    expect(res.status).toBe(401)
  })

  it("returns default roles when org has no custom settings", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)

    const res = await rolesGET(makeRequest("/api/v1/settings/roles"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.roles.length).toBeGreaterThanOrEqual(4) // at least system roles
    expect(json.data.permissions).toBeDefined()
    expect(json.data.permissions.admin.settings).toBe("full")
    // Direction 2: the default catalog contains only enforce-able roles, so
    // every default role is flagged assignable.
    expect(json.data.roles.every((r: any) => r.assignable === true)).toBe(true)
  })

  it("flags non-enforce-able roles (extended/custom) as assignable:false", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: {
        roles: [
          { id: "manager", name: "Manager", color: "blue", isSystem: true },
          { id: "marketing", name: "Marketing", color: "pink", isSystem: false },
          { id: "auditor", name: "Auditor", color: "slate", isSystem: false },
        ],
      },
    } as any)

    const res = await rolesGET(makeRequest("/api/v1/settings/roles"))
    const json = await res.json()
    const byId = Object.fromEntries(json.data.roles.map((r: any) => [r.id, r.assignable]))
    expect(byId.manager).toBe(true) // enforce-able RBAC role
    expect(byId.marketing).toBe(false) // deny-all extended role
    expect(byId.auditor).toBe(false) // custom role, not enforced
  })
})

describe("POST /api/v1/settings/roles", () => {
  it("returns auth error when not authorized", async () => {
    const authErr = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    vi.mocked(requireAuth).mockResolvedValue(authErr as any)
    vi.mocked(isAuthError).mockReturnValue(true)

    const res = await rolesPOST(makeJsonRequest("/api/v1/settings/roles", { name: "Custom" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when role name is too short", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    const res = await rolesPOST(makeJsonRequest("/api/v1/settings/roles", { name: "A" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when role with same name already exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { roles: [{ id: "sales", name: "Sales", color: "emerald", isSystem: false }] },
    } as any)

    const res = await rolesPOST(makeJsonRequest("/api/v1/settings/roles", { name: "Sales" }))
    expect(res.status).toBe(400)
  })

  it("creates a new role with default view permissions", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any)

    const res = await rolesPOST(makeJsonRequest("/api/v1/settings/roles", { name: "Support Lead", color: "teal" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("support_lead")
    expect(json.data.isSystem).toBe(false)
  })
})

describe("DELETE /api/v1/settings/roles", () => {
  it("returns 400 when no role id is provided", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    const res = await rolesDELETE(makeRequest("/api/v1/settings/roles"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when trying to delete a system role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: {
        roles: [{ id: "admin", name: "Admin", color: "red", isSystem: true }],
      },
    } as any)

    const res = await rolesDELETE(makeRequest("/api/v1/settings/roles?id=admin"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/system role/i)
  })

  it("returns 400 when users still have the role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: {
        roles: [{ id: "custom", name: "Custom", color: "slate", isSystem: false }],
      },
    } as any)
    vi.mocked(prisma.user.count).mockResolvedValue(3)

    const res = await rolesDELETE(makeRequest("/api/v1/settings/roles?id=custom"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/3 users/)
  })
})

// ---------------------------------------------------------------------------
// SMTP Settings
// ---------------------------------------------------------------------------
describe("GET /api/v1/settings/smtp", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await smtpGET(makeRequest("/api/v1/settings/smtp"))
    expect(res.status).toBe(401)
  })

  it("returns masked password and isConfigured flag", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: {
        smtp: {
          smtpHost: "smtp.example.com",
          smtpPort: 587,
          smtpUser: "user@example.com",
          smtpPass: "secret123",
          smtpTls: true,
          fromEmail: "noreply@example.com",
          fromName: "Test",
        },
      },
    } as any)

    const res = await smtpGET(makeRequest("/api/v1/settings/smtp"))
    const json = await res.json()
    expect(json.data.smtpPass).toBe("••••••••")
    expect(json.data.isConfigured).toBe(true)
  })

  it("returns defaults when no smtp configured", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)

    const res = await smtpGET(makeRequest("/api/v1/settings/smtp"))
    const json = await res.json()
    expect(json.data.smtpHost).toBe("")
    expect(json.data.smtpPort).toBe(587)
    expect(json.data.isConfigured).toBe(false)
  })
})

describe("PUT /api/v1/settings/smtp", () => {
  const validSmtp = {
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpUser: "user@gmail.com",
    smtpPass: "app-password",
    smtpTls: true,
    fromEmail: "noreply@company.com",
    fromName: "Company",
  }

  it("returns auth error when not authorized", async () => {
    const authErr = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    vi.mocked(requireAuth).mockResolvedValue(authErr as any)
    vi.mocked(isAuthError).mockReturnValue(true)

    const res = await smtpPUT(makeJsonRequest("/api/v1/settings/smtp", validSmtp, "PUT"))
    expect(res.status).toBe(403)
  })

  it("returns 400 on Zod validation failure (invalid email)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    const res = await smtpPUT(makeJsonRequest("/api/v1/settings/smtp", { ...validSmtp, fromEmail: "not-an-email" }, "PUT"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("keeps old password when masked value is sent", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { smtp: { smtpPass: "real-secret" } },
    } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any)

    await smtpPUT(makeJsonRequest("/api/v1/settings/smtp", { ...validSmtp, smtpPass: "••••••••" }, "PUT"))

    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0][0]
    const savedSmtp = (updateCall.data as any).settings.smtp
    expect(savedSmtp.smtpPass).toBe("real-secret")
  })

  it("saves new password when non-masked value is sent", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any)

    await smtpPUT(makeJsonRequest("/api/v1/settings/smtp", validSmtp, "PUT"))

    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0][0]
    const savedSmtp = (updateCall.data as any).settings.smtp
    expect(savedSmtp.smtpPass).toBe("app-password")
  })
})

// ---------------------------------------------------------------------------
// SMTP Test
// ---------------------------------------------------------------------------
describe("POST /api/v1/settings/smtp/test", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await smtpTestPOST(makeJsonRequest("/api/v1/settings/smtp/test", { email: "test@test.com" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when SMTP is not configured", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {}, name: "Test" } as any)

    const res = await smtpTestPOST(makeJsonRequest("/api/v1/settings/smtp/test", { email: "test@test.com" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when email is invalid", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await smtpTestPOST(makeJsonRequest("/api/v1/settings/smtp/test", { email: "not-an-email" }))
    expect(res.status).toBe(400)
  })

  it("sends test email successfully and returns messageId", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: {
        smtp: {
          smtpHost: "smtp.example.com",
          smtpPort: 587,
          smtpUser: "user@example.com",
          smtpPass: "pass",
          smtpTls: true,
          fromEmail: "noreply@example.com",
          fromName: "Test",
        },
      },
      name: "Test Org",
    } as any)

    const res = await smtpTestPOST(makeJsonRequest("/api/v1/settings/smtp/test", { email: "admin@test.com" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.messageId).toBe("msg-123")
  })
})
