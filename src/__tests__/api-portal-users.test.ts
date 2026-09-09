import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authState = vi.hoisted(() => ({ role: "admin" }))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (req: NextRequest, auth: { orgId: string; role: string }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", role: authState.role }),
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
  },
}))

vi.mock("@/lib/portal-password-link", () => ({
  issuePortalPasswordLink: vi.fn(),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn() },
}))

import { PATCH } from "@/app/api/v1/portal-users/route"
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
  vi.mocked(issuePortalPasswordLink).mockResolvedValue({ ok: true, mode: "reset" })
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
    expect(await res.json()).toEqual({ success: true, data: { mode: "reset" } })
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
    expect(await res.json()).toEqual({ success: true, data: { credentialsRevoked: true } })
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
    expect(await res.json()).toEqual({ success: true })
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
      data: expect.objectContaining({ action: "portal_password_set_by_admin", details: { source: "manual" } }),
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
    expect(await res.json()).toEqual({ success: true, removed: true })
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
})
