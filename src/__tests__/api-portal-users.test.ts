import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authState = vi.hoisted(() => ({ role: "admin" }))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "admin-1", role: authState.role }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    aiChatSession: { findMany: vi.fn(), deleteMany: vi.fn() },
    aiChatMessage: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  },
}))

vi.mock("@/lib/portal-password-link", () => ({
  issuePortalPasswordLink: vi.fn(),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn() },
}))

import { GET, PATCH } from "@/app/api/v1/portal-users/route"
import { prisma } from "@/lib/prisma"
import { issuePortalPasswordLink } from "@/lib/portal-password-link"
import bcrypt from "bcryptjs"

const contact = {
  id: "contact-1",
  organizationId: "org-1",
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: "+994501234567",
  isActive: true,
  portalAccessEnabled: true,
  portalPasswordHash: "old-password-hash",
  portalVerificationToken: "old-token",
  portalVerificationExpires: new Date("2026-09-02T00:00:00Z"),
  organization: { name: "Acme" },
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/portal-users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.role = "admin"
  vi.mocked(prisma.contact.findFirst).mockResolvedValue(contact as never)
  vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.aiChatSession.findMany).mockResolvedValue([] as never)
  vi.mocked(issuePortalPasswordLink).mockResolvedValue({ ok: true, mode: "reset", expiresAt: "2026-09-06T12:00:00.000Z" })
  vi.mocked(bcrypt.hash).mockResolvedValue("new-password-hash" as never)
})

describe("PATCH /api/v1/portal-users", () => {
  it("allows only portal administrators", async () => {
    authState.role = "viewer"

    const res = await PATCH(request({ contactId: contact.id, sendPasswordLink: true }))

    expect(res.status).toBe(403)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })

  it("sends an administrator-requested single-use password link instead of clearing the hash", async () => {
    const res = await PATCH(request({ contactId: contact.id, sendPasswordLink: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { mode: "reset", expiresAt: "2026-09-06T12:00:00.000Z" }, auditRecorded: true })
    expect(issuePortalPasswordLink).toHaveBeenCalledWith(expect.objectContaining({
      id: contact.id,
      organizationId: "org-1",
      portalPasswordHash: "old-password-hash",
    }))
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "portal_password_link_sent_by_admin" }),
    }))
  })

  it("revokes portal credentials when an administrator changes a portal email", async () => {
    const res = await PATCH(request({
      contactId: contact.id,
      profile: {
        fullName: "Jane Updated",
        email: "new-address@example.com",
        phone: null,
        portalAccessEnabled: true,
      },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { credentialsRevoked: true }, auditRecorded: true })
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: contact.id, organizationId: "org-1" },
      data: expect.objectContaining({
        fullName: "Jane Updated",
        email: "new-address@example.com",
        portalPasswordHash: null,
        portalVerificationToken: null,
        portalVerificationExpires: null,
        portalLastLoginAt: null,
      }),
    }))
  })

  it("allows an administrator to set a compliant password and invalidate portal sessions", async () => {
    const res = await PATCH(request({
      contactId: contact.id,
      administratorPassword: {
        password: "Customer#Portal2026",
        confirmPassword: "Customer#Portal2026",
        acknowledged: true,
      },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, auditRecorded: true })
    expect(bcrypt.hash).toHaveBeenCalledWith("Customer#Portal2026", 12)
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: contact.id, organizationId: "org-1" },
      data: expect.objectContaining({
        portalPasswordHash: "new-password-hash",
        portalVerificationToken: null,
        portalVerificationExpires: null,
        portalLastLoginAt: null,
      }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "portal_password_set_by_admin", details: { source: "manual", actorUserId: "admin-1" } }),
    }))
  })

  it("does not hash a password that fails the shared password policy", async () => {
    const res = await PATCH(request({
      contactId: contact.id,
      administratorPassword: { password: "short", confirmPassword: "short", acknowledged: true },
    }))

    expect(res.status).toBe(400)
    expect(vi.mocked(bcrypt.hash)).not.toHaveBeenCalled()
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("removes only portal access and chat history, preserving the CRM contact", async () => {
    vi.mocked(prisma.aiChatSession.findMany).mockResolvedValue([{ id: "chat-1" }] as never)

    const res = await PATCH(request({ contactId: contact.id, removeFromPortal: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removed: true, auditRecorded: true })
    expect(prisma.aiChatMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ["chat-1"] } } })
    expect(prisma.aiChatSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["chat-1"] } } })
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: contact.id, organizationId: "org-1" },
      data: expect.objectContaining({
        portalAccessEnabled: false,
        portalPasswordHash: null,
        portalVerificationToken: null,
      }),
    }))
  })

  it("reports an audit delivery failure without pretending the access mutation failed", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error("audit unavailable"))
    const res = await PATCH(request({ contactId: contact.id, portalAccessEnabled: false }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, auditRecorded: false })
    expect(prisma.contact.updateMany).toHaveBeenCalled()
  })

  it("does not enable portal access for an inactive CRM contact", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ ...contact, isActive: false, portalAccessEnabled: false } as never)
    const res = await PATCH(request({ contactId: contact.id, portalAccessEnabled: true }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("PORTAL_CONTACT_INACTIVE")
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a bulk enable when any selected CRM contact is inactive or has no email", async () => {
    vi.mocked(prisma.contact.count).mockResolvedValue(1)
    const res = await PATCH(request({ contactIds: ["c1", "c2"], action: "enable" }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("PORTAL_BULK_INELIGIBLE")
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("audits bulk scope and returns the actual updated count", async () => {
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 2 } as never)
    const res = await PATCH(request({ contactIds: ["c1", "c2"], action: "disable" }))
    expect(await res.json()).toEqual({ success: true, updated: 2, auditRecorded: true })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "portal_access_bulk_disabled",
        details: { requested: 2, updated: 2, actorUserId: "admin-1" },
      }),
    }))
  })
})

describe("GET /api/v1/portal-users", () => {
  it("returns recovery expiry, a bounded result scope and write permission", async () => {
    vi.mocked(prisma.contact.findMany)
      .mockResolvedValueOnce([{ ...contact, company: { name: "Acme" } }] as never)
      .mockResolvedValueOnce([{ portalAccessEnabled: true, portalPasswordHash: "hash", portalLastLoginAt: new Date() }] as never)
    const res = await GET(new NextRequest("http://localhost/api/v1/portal-users?search=Jane"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.contacts[0]).toMatchObject({
      id: "contact-1",
      recoveryExpiresAt: contact.portalVerificationExpires.toISOString(),
    })
    expect(json.data.scope).toMatchObject({ shown: 1, truncated: false })
    expect(json.permissions).toEqual({ canWrite: true, role: "admin" })
  })

  it("rejects non-administrators before querying contacts", async () => {
    authState.role = "support"
    const res = await GET(new NextRequest("http://localhost/api/v1/portal-users"))
    expect(res.status).toBe(403)
    expect(prisma.contact.findMany).not.toHaveBeenCalled()
  })
})
