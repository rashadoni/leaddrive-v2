import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// F-30: portal verification tokens are stored as a digest — the plaintext value
// exists only in the emailed link. Predicates in these tests must match the
// digest, exactly as the routes do.
import { hashOneTimeToken } from "@/lib/one-time-token"

// ── Mocks ────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    contact: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    ticketCategory: { findFirst: vi.fn() },
    channelConfig: { findMany: vi.fn() },
    kbArticle: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    lead: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    landingPage: { findFirst: vi.fn(), update: vi.fn() },
    formSubmission: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))

// SLA resolution is unit-tested separately (lib-sla-resolver.test.ts); here it
// just needs to not touch the un-mocked company/slaPolicy tables.
vi.mock("@/lib/sla-resolver", () => ({
  resolveTicketSla: vi.fn().mockResolvedValue({}),
  normalizeTicketPriority: (p: string) =>
    ["low", "medium", "high", "critical"].includes(p) ? p : "medium",
}))

vi.mock("@/lib/portal-auth", () => ({
  getPortalUser: vi.fn(),
  createPortalToken: vi.fn().mockResolvedValue("mock-jwt-token"),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async () => "portal-principal-hash"),
}))

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false })),
  reservePublicAction: vi.fn(async () => ({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    cooldownKey: "test:cooldown",
    windowKey: "test:window",
    token: "test-token",
  })),
  releasePublicActionReservation: vi.fn(async () => undefined),
}))

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn().mockResolvedValue("hashed"),
  },
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/lead-assignment", () => ({
  applyLeadAssignmentRules: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/auto-assign", () => ({
  autoAssignTicket: vi.fn().mockResolvedValue({ assigned: false }),
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/slack", () => ({
  formatTicketNotification: vi.fn().mockReturnValue("ticket"),
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/constants", () => ({
  PAGE_SIZE: { DEFAULT: 50 },
}))

vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto")
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue({ toString: () => "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" }),
  }
})

// ── Imports ──────────────────────────────────────────────

import { POST as POST_LOGIN, DELETE as DELETE_LOGOUT } from "@/app/api/v1/public/portal-auth/route"
import { POST as POST_REGISTER } from "@/app/api/v1/public/portal-auth/register/route"
import { POST as POST_FORGOT_PASSWORD } from "@/app/api/v1/public/portal-auth/forgot-password/route"
import { POST as POST_SET_PASSWORD } from "@/app/api/v1/public/portal-auth/set-password/route"
import { GET as GET_TICKETS, POST as POST_TICKET } from "@/app/api/v1/public/portal-tickets/route"
import { GET as GET_KB } from "@/app/api/v1/public/portal-kb/route"
import { POST as POST_LEAD, OPTIONS as OPTIONS_LEAD } from "@/app/api/v1/public/leads/route"
import { POST as POST_FORM, OPTIONS as OPTIONS_FORM } from "@/app/api/v1/public/form-submit/route"
import { prisma } from "@/lib/prisma"
import { getPortalUser } from "@/lib/portal-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import bcrypt from "bcryptjs"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { sendEmail } from "@/lib/email"
import {
  consumePublicRateLimit,
  releasePublicActionReservation,
  reservePublicAction,
} from "@/lib/public-abuse-guard"

const PORTAL_USER = {
  contactId: "contact-1",
  organizationId: "org-1",
  companyId: "comp-1",
  fullName: "John Doe",
  email: "john@acme.com",
}

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false })
  vi.mocked(reservePublicAction).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    cooldownKey: "test:cooldown",
    windowKey: "test:window",
    token: "test-token",
  })
  vi.mocked(releasePublicActionReservation).mockResolvedValue(undefined)
  vi.mocked((prisma as any).$executeRaw).mockResolvedValue(undefined)
  vi.mocked((prisma as any).$queryRaw).mockResolvedValue([{ max: 5 }])
  vi.mocked(prisma.ticketCategory.findFirst).mockImplementation(async (args: any) => {
    const slug = args?.where?.slug || "general"
    return {
      id: `cat-${slug}`,
      slug,
      name: slug,
      scope: slug === "complaint" ? "complaint" : "ticket",
      defaultPriority: null,
    } as any
  })
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as any)
  // Restore $transaction to execute callbacks after clearAllMocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.$transaction as any).mockImplementation((fn: any) => {
    if (typeof fn === "function") return fn(prisma)
    return Promise.all(fn)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/portal-auth (login)
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/portal-auth (login)", () => {
  it("rejects a body slug that disagrees with the trusted tenant host before account work", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        headers: { "x-tenant-slug": "afigroup" },
        body: JSON.stringify({
          email: "john@test.com",
          password: "correct-password",
          organizationSlug: "victim-tenant",
        }),
      }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Неверные учётные данные" })
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("rejects a body organization ID that disagrees with the trusted tenant host", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-afi" } as any)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        headers: { "x-tenant-slug": "afigroup" },
        body: JSON.stringify({
          email: "john@test.com",
          password: "correct-password",
          organizationId: "org-victim",
        }),
      }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Неверные учётные данные" })
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { slug: "afigroup", isActive: true },
      select: { id: true },
    })
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("rejects an oversized body before organization lookup or principal limiting", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({
          email: "john@test.com",
          password: "x".repeat(9 * 1024),
          slug: "leaddrive",
        }),
      }),
    )

    expect(res.status).toBe(413)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON before organization lookup or principal limiting", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: '{"email":"john@test.com",',
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("strictly rejects unknown fields before organization lookup or principal limiting", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({
          email: "john@test.com",
          password: "correct-password",
          slug: "leaddrive",
          role: "admin",
        }),
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("returns 429 when the portal principal rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "wrong", slug: "leaddrive" }),
      }),
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("60")
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })

  it("returns 400 when email is missing", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ password: "123" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when password is missing", async () => {
    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 when organization not found", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "123", slug: "nonexistent" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("rejects login for an inactive organization", async () => {
    vi.mocked(prisma.organization.findFirst).mockImplementation(async ({ where }: any) => {
      expect(where).toEqual({ slug: "disabled", isActive: true })
      return null
    })

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "correct", slug: "disabled" }),
      }),
    )

    expect(res.status).toBe(401)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(bcrypt.compare).not.toHaveBeenCalled()
  })

  it("returns 401 when contact not found", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "unknown@test.com", password: "123", slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Неверные учётные данные" })
    expect(bcrypt.compare).not.toHaveBeenCalled()
  })

  it("returns generic 401 when portal access is not enabled", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "c1",
      email: "john@test.com",
      portalAccessEnabled: false,
      portalPasswordHash: "hash",
      organizationId: "org-1",
    } as any)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "123", slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 when password is wrong", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "c1",
      email: "john@test.com",
      fullName: "John",
      portalAccessEnabled: true,
      portalPasswordHash: "hashedpass",
      organizationId: "org-1",
      company: { name: "Acme" },
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "wrong", slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Неверные учётные данные" })
  })

  it("returns success with token cookie on valid login", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "c1",
      email: "john@test.com",
      fullName: "John",
      portalAccessEnabled: true,
      portalPasswordHash: "hashedpass",
      organizationId: "org-1",
      companyId: "comp-1",
      company: { name: "Acme" },
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({} as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await POST_LOGIN(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth", {
        method: "POST",
        body: JSON.stringify({ email: "john@test.com", password: "correct", slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.fullName).toBe("John")
    // Phase 0 (native app): the JWT is ALSO returned in the body (createPortalToken
    // is mocked → "mock-jwt-token"), so the mobile client can store it. The web
    // still uses the cookie below.
    expect(body.token).toBe("mock-jwt-token")
    // Check that portal-token cookie is set (web path unchanged)
    const setCookie = res.headers.getSetCookie()
    expect(setCookie.some((c: string) => c.includes("portal-token"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/portal-auth/set-password
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/portal-auth/set-password", () => {
  it("rejects a verification link when its organization is inactive", async () => {
    vi.mocked(prisma.contact.findFirst).mockImplementationOnce(async ({ where }: any) => {
      expect(where).toMatchObject({
        portalVerificationToken: hashOneTimeToken("verification-token"),
        isActive: true,
        portalAccessEnabled: true,
        organization: { isActive: true },
      })
      expect(where.portalVerificationExpires.gte).toBeInstanceOf(Date)
      return null
    })

    const res = await POST_SET_PASSWORD(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/set-password", {
        method: "POST",
        body: JSON.stringify({
          token: "verification-token",
          password: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
          confirmPassword: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
        }),
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.contact.update).not.toHaveBeenCalled()
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })

  it("atomically consumes a verification token only once", async () => {
    const contact = {
      id: "contact-1",
      organizationId: "org-1",
      companyId: null,
      fullName: "Jane Doe",
      email: "jane@test.com",
      portalPasswordHash: null,
      company: null,
    }
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as any)
    vi.mocked(prisma.contact.updateMany)
      .mockResolvedValueOnce({ count: 1 } as any)
      .mockResolvedValueOnce({ count: 0 } as any)
    vi.mocked(bcrypt.hash).mockResolvedValue("hashed-password" as never)

    const request = () => makeRequest("http://localhost:3000/api/v1/public/portal-auth/set-password", {
      method: "POST",
      body: JSON.stringify({
        token: "verification-token",
        password: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
        confirmPassword: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
      }),
    })
    const first = await POST_SET_PASSWORD(request())
    const replay = await POST_SET_PASSWORD(request())

    expect(first.status).toBe(200)
    expect(replay.status).toBe(400)
    expect(prisma.contact.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: "contact-1",
        organizationId: "org-1",
        portalVerificationToken: hashOneTimeToken("verification-token"),
        portalPasswordHash: null,
        isActive: true,
        portalAccessEnabled: true,
        organization: { isActive: true },
      }),
    }))
  })

  it("accepts a password-reset token and binds consumption to the current password", async () => {
    const contact = {
      id: "contact-1",
      organizationId: "org-1",
      companyId: null,
      fullName: "Jane Doe",
      email: "jane@test.com",
      portalPasswordHash: "old-password-hash",
      company: null,
    }
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as any)
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_SET_PASSWORD(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/set-password", {
        method: "POST",
        body: JSON.stringify({
          token: "password-reset-token",
          password: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
          confirmPassword: "UniquePass-2026", // gitleaks:allow -- synthetic test/public display literal
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        portalVerificationToken: hashOneTimeToken("password-reset-token"),
        portalPasswordHash: "old-password-hash",
      }),
    }))
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/portal-auth/forgot-password
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/portal-auth/forgot-password", () => {
  it("sends a single-use link for an existing portal account", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "contact-1",
      organizationId: "org-1",
      fullName: "Jane Doe",
      email: "jane@test.com",
      portalPasswordHash: "old-password-hash",
      portalVerificationToken: null,
      portalVerificationExpires: null,
      organization: { name: "Acme" },
    } as any)
    vi.mocked(prisma.contact.update).mockResolvedValue({} as any)

    const res = await POST_FORGOT_PASSWORD(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "jane@test.com", slug: "acme" }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(prisma.contact.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "contact-1" },
      data: expect.objectContaining({
        portalVerificationToken: expect.any(String),
        portalVerificationExpires: expect.any(Date),
      }),
    }))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "jane@test.com",
      transactional: true,
      subject: "Acme — сброс пароля портала",
    }))
  })

  it("returns the generic response without sending mail when no portal account matches", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const res = await POST_FORGOT_PASSWORD(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "unknown@test.com", slug: "acme" }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/public/portal-auth (logout)
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/public/portal-auth (logout)", () => {
  it("clears the portal-token cookie", async () => {
    const res = await DELETE_LOGOUT()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const setCookie = res.headers.getSetCookie()
    expect(setCookie.some((c: string) => c.includes("portal-token") && c.includes("Max-Age=0"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/portal-auth/register
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/portal-auth/register", () => {
  it("returns generic success without account lookup or email when body slug mismatches the tenant host", async () => {
    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-tenant-slug": "afigroup" },
        body: JSON.stringify({
          email: "person@test.com",
          organizationSlug: "victim-tenant",
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      message: "Если указанный email связан с аккаунтом, на него будет отправлена ссылка для подтверждения.",
    })
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.contact.update).not.toHaveBeenCalled()
    expect(reservePublicAction).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns generic success without account lookup or email when body organization ID mismatches the tenant host", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-afi" } as any)

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-tenant-slug": "afigroup" },
        body: JSON.stringify({
          email: "person@test.com",
          organizationId: "org-victim",
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { slug: "afigroup", isActive: true },
      select: { id: true },
    })
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.contact.update).not.toHaveBeenCalled()
    expect(reservePublicAction).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("rate-limits the route before parsing or resolving an account", async () => {
    vi.mocked(consumePublicRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 37,
      unavailable: false,
    })

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.20" },
        body: JSON.stringify({ email: "person@test.com" }),
      }),
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("37")
    expect(consumePublicRateLimit).toHaveBeenCalledWith(
      "portal-register:ip",
      "203.0.113.20",
      { maxRequests: 10, windowSeconds: 60 },
    )
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })

  it("returns 400 when email is missing", async () => {
    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        body: JSON.stringify({ slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns generic success even when org not found (prevents enumeration)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "anyone@test.com", slug: "nonexistent" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("treats an inactive organization as unknown and sends no email", async () => {
    vi.mocked(prisma.organization.findFirst).mockImplementation(async ({ where }: any) => {
      expect(where).toEqual({ slug: "disabled", isActive: true })
      return null
    })

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "person@test.com", slug: "disabled" }),
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(prisma.contact.update).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns generic success when contact not found (prevents enumeration)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "unknown@test.com", slug: "leaddrive" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("uses a recipient gate that rotating source IPs cannot bypass", async () => {
    const contact = {
      id: "contact-1",
      organizationId: "org-1",
      fullName: "Jane Doe",
      email: "jane@test.com",
      portalAccessEnabled: true,
      portalPasswordHash: null,
      portalVerificationToken: null,
      portalVerificationExpires: null,
      organization: { name: "Acme" },
    }
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: null, name: "Acme" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as any)
    vi.mocked(prisma.contact.update).mockResolvedValue(contact as any)
    vi.mocked(reservePublicAction)
      .mockResolvedValueOnce({
        allowed: true,
        retryAfterSeconds: 0,
        unavailable: false,
        backend: "memory",
        cooldownKey: "recipient:cooldown",
        windowKey: "recipient:window",
        token: "recipient-token",
      })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600, unavailable: false })

    const first = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.21" },
        body: JSON.stringify({ email: " JANE@Test.com ", slug: "leaddrive" }),
      }),
    )
    const second = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.22" },
        body: JSON.stringify({ email: "jane@test.com", slug: "leaddrive" }),
      }),
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    expect(reservePublicAction).toHaveBeenNthCalledWith(
      1,
      "portal-register:recipient",
      "jane@test.com",
      { cooldownSeconds: 600, maxActions: 3, windowSeconds: 3600 },
    )
    expect(reservePublicAction).toHaveBeenNthCalledWith(
      2,
      "portal-register:recipient",
      "jane@test.com",
      { cooldownSeconds: 600, maxActions: 3, windowSeconds: 3600 },
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(prisma.contact.update).toHaveBeenCalledTimes(1)
  })

  it("keeps delivery failures enumeration-safe without reopening the recipient slot", async () => {
    const contact = {
      id: "contact-1",
      organizationId: "org-1",
      fullName: "Jane Doe",
      email: "jane@test.com",
      portalAccessEnabled: true,
      portalPasswordHash: null,
      portalVerificationToken: hashOneTimeToken("previous-token"),
      portalVerificationExpires: new Date("2026-08-12T00:00:00.000Z"),
      organization: { name: "Acme" },
    }
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: null, name: "Acme" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as any)
    vi.mocked(prisma.contact.update).mockResolvedValue(contact as any)
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: "provider unavailable" })

    const res = await POST_REGISTER(
      makeRequest("http://localhost:3000/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.23" },
        body: JSON.stringify({ email: "jane@test.com", slug: "leaddrive" }),
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(releasePublicActionReservation).not.toHaveBeenCalled()
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contact-1",
        portalVerificationToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      data: {
        portalVerificationToken: hashOneTimeToken("previous-token"),
        portalVerificationExpires: new Date("2026-08-12T00:00:00.000Z"),
      },
    })
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/public/portal-tickets
// ---------------------------------------------------------------------------
describe("GET /api/v1/public/portal-tickets", () => {
  it("returns 401 when portal user is not authenticated", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)

    const res = await GET_TICKETS()
    expect(res.status).toBe(401)
  })

  it("returns tickets for the portal user", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      { id: "t1", ticketNumber: "TK-00001", subject: "Bug", status: "new", priority: "high" },
    ] as any)

    const res = await GET_TICKETS()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].ticketNumber).toBe("TK-00001")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/portal-tickets
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/portal-tickets", () => {
  it("returns 401 when portal user is not authenticated", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)

    const res = await POST_TICKET(
      makeRequest("http://localhost:3000/api/v1/public/portal-tickets", {
        method: "POST",
        body: JSON.stringify({ subject: "Help" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when subject is missing", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)

    const res = await POST_TICKET(
      makeRequest("http://localhost:3000/api/v1/public/portal-tickets", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates a ticket and returns 201", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "contact-1",
      fullName: "John Doe",
      email: "john@acme.com",
      phone: null,
    } as any)
    vi.mocked(prisma.ticket.count).mockResolvedValue(5)
    vi.mocked(prisma.ticket.create).mockResolvedValue({
      id: "t-new",
      ticketNumber: "TK-0006",
      subject: "Login issue",
      status: "new",
      priority: "medium",
      category: "general",
      organizationId: "org-1",
      contactId: "contact-1",
    } as any)

    const res = await POST_TICKET(
      makeRequest("http://localhost:3000/api/v1/public/portal-tickets", {
        method: "POST",
        body: JSON.stringify({ subject: "Login issue" }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.ticketNumber).toBe("TK-0006")

    const createCall = vi.mocked(prisma.ticket.create).mock.calls[0][0] as any
    expect(createCall.data.contactId).toBe("contact-1")
    expect(createCall.data.status).toBe("new")
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/public/portal-kb
// ---------------------------------------------------------------------------
describe("GET /api/v1/public/portal-kb", () => {
  it("returns 401 when portal user is not authenticated", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)

    const res = await GET_KB(
      makeRequest("http://localhost:3000/api/v1/public/portal-kb"),
    )
    expect(res.status).toBe(401)
  })

  it("returns published articles list", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([
      { id: "a1", title: "How to reset password", content: "Step 1...", tags: ["auth"], viewCount: 5, createdAt: new Date() },
    ] as any)

    const res = await GET_KB(
      makeRequest("http://localhost:3000/api/v1/public/portal-kb"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe("How to reset password")
  })

  it("returns single article and increments viewCount when id param given", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue({
      id: "a1",
      title: "Guide",
      content: "Full content here",
      tags: [],
      viewCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId: "org-1",
      status: "published",
    } as any)
    vi.mocked(prisma.kbArticle.update).mockResolvedValue({} as any)

    const res = await GET_KB(
      makeRequest("http://localhost:3000/api/v1/public/portal-kb?id=a1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.title).toBe("Guide")
    expect(body.data.viewCount).toBe(11)
    expect(prisma.kbArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { viewCount: { increment: 1 } } }),
    )
  })

  it("returns 404 when article not found", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(PORTAL_USER)
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue(null)

    const res = await GET_KB(
      makeRequest("http://localhost:3000/api/v1/public/portal-kb?id=nonexistent"),
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/leads (web-to-lead)
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/leads (web-to-lead)", () => {
  it("returns an explicit fail-closed 503 when the shared guard is unavailable", async () => {
    vi.mocked(consumePublicRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 1,
      unavailable: true,
    })

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.29" },
        body: JSON.stringify({}),
      }),
    )

    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("1")
    expect(await res.json()).toEqual({
      success: false,
      error: "Service temporarily unavailable. Please try again later.",
    })
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
  })

  it("rate-limits invalid submissions inside the route before validation", async () => {
    vi.mocked(consumePublicRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 12,
      unavailable: false,
    })

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.30" },
        body: JSON.stringify({}),
      }),
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("12")
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
  })

  it("trusts Cloudflare's client header only when Nginx saw a Cloudflare peer", async () => {
    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: {
          "x-real-ip": "173.245.48.10",
          "cf-connecting-ip": "203.0.113.31",
          "x-forwarded-for": "198.51.100.99",
        },
        body: JSON.stringify({}),
      }),
    )

    expect(res.status).toBe(400)
    expect(consumePublicRateLimit).toHaveBeenNthCalledWith(
      1,
      "web-lead:ip",
      "203.0.113.31",
      { maxRequests: 10, windowSeconds: 60 },
    )
  })

  it("returns 400 when required fields are missing", async () => {
    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        body: JSON.stringify({ email: "test@test.com" }),
      }) as any,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it("returns 201 even when org not found (prevents enumeration)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        body: JSON.stringify({
          name: "Jane",
          email: "jane@test.com",
          org_slug: "nonexistent",
        }),
      }) as any,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("treats an inactive organization as unknown and creates no lead", async () => {
    vi.mocked(prisma.organization.findFirst).mockImplementation(async ({ where }: any) => {
      expect(where).toEqual({ slug: "disabled", isActive: true })
      return null
    })

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        body: JSON.stringify({
          name: "Jane",
          email: "jane@test.com",
          org_slug: "disabled",
        }),
      }),
    )

    expect(res.status).toBe(201)
    expect((await res.json()).success).toBe(true)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("silently accepts a filled honeypot without touching tenant data", async () => {
    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.32" },
        body: JSON.stringify({ website: "https://spam.example" }),
      }),
    )

    expect(res.status).toBe(201)
    expect((await res.json()).success).toBe(true)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("deduplicates an identical recent submission before resolving the tenant", async () => {
    vi.mocked(reservePublicAction).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 600,
      unavailable: false,
    })

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.33" },
        body: JSON.stringify({
          name: "Jane",
          email: "jane@test.com",
          org_slug: "leaddrive",
        }),
      }),
    )

    expect(res.status).toBe(201)
    expect((await res.json()).success).toBe(true)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("creates a lead and calls assignment rules", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
    const createdLead = {
      id: "lead-new",
      contactName: "Jane",
      email: "jane@test.com",
      status: "new",
      organizationId: "org-1",
    }
    vi.mocked(prisma.lead.create).mockResolvedValue(createdLead as any)

    const res = await POST_LEAD(
      makeRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        body: JSON.stringify({
          name: "Jane",
          email: "jane@test.com",
          org_slug: "leaddrive",
        }),
      }) as any,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ status: "new", message: "Lead submitted successfully" })
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { slug: "leaddrive", isActive: true },
    })
    expect(applyLeadAssignmentRules).toHaveBeenCalledWith("org-1", createdLead)
  })

  it("OPTIONS returns CORS headers", async () => {
    const res = await OPTIONS_LEAD()
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/public/form-submit
// ---------------------------------------------------------------------------
describe("POST /api/v1/public/form-submit", () => {
  it("returns 400 when pageId is missing", async () => {
    const res = await POST_FORM(
      makeRequest("http://localhost:3000/api/v1/public/form-submit", {
        method: "POST",
        body: JSON.stringify({ orgId: "org-1" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when orgId is missing", async () => {
    const res = await POST_FORM(
      makeRequest("http://localhost:3000/api/v1/public/form-submit", {
        method: "POST",
        body: JSON.stringify({ pageId: "page-1" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when landing page not found or not published", async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue(null)

    const res = await POST_FORM(
      makeRequest("http://localhost:3000/api/v1/public/form-submit", {
        method: "POST",
        body: JSON.stringify({ pageId: "page-1", orgId: "org-1", name: "Test" }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it("creates submission + lead in a transaction and returns 201", async () => {
    vi.mocked(prisma.landingPage.findFirst).mockResolvedValue({
      id: "page-1",
      name: "Landing 1",
      organizationId: "org-1",
      status: "published",
    } as any)

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        formSubmission: {
          create: vi.fn().mockResolvedValue({ id: "sub-1" }),
          update: vi.fn().mockResolvedValue({}),
        },
        lead: {
          create: vi.fn().mockResolvedValue({ id: "lead-1", contactName: "Alice" }),
        },
        landingPage: {
          update: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(tx)
    })

    const res = await POST_FORM(
      makeRequest("http://localhost:3000/api/v1/public/form-submit", {
        method: "POST",
        body: JSON.stringify({
          pageId: "page-1",
          orgId: "org-1",
          name: "Alice",
          email: "alice@test.com",
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("OPTIONS returns CORS headers", async () => {
    const res = await OPTIONS_FORM()
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})
