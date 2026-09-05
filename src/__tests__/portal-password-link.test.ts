/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { update: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/one-time-token", () => ({
  generateOneTimeToken: vi.fn(() => ({ token: "plain-token", tokenHash: "hashed-token" })),
}))

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/email-reply-address", () => ({ buildReplyTo: vi.fn(() => "reply@example.com") }))

import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { issuePortalPasswordLink } from "@/lib/portal-password-link"

const contact = {
  id: "contact-1",
  organizationId: "org-1",
  fullName: "Jane Doe",
  email: "jane@example.com",
  portalPasswordHash: "existing-hash",
  portalVerificationToken: "previous-token",
  portalVerificationExpires: new Date("2026-09-01T12:00:00Z"),
  organization: { name: "Acme" },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"))
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ name: "Acme", settings: {} } as any)
  vi.mocked(prisma.contact.update).mockResolvedValue({} as any)
  vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as any)
})

afterEach(() => vi.useRealTimers())

describe("issuePortalPasswordLink", () => {
  it("returns the exact 24-hour expiry and stores only the token digest", async () => {
    const result = await issuePortalPasswordLink(contact)
    expect(result).toEqual({ ok: true, mode: "reset", expiresAt: "2026-09-06T12:00:00.000Z" })
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: {
        portalVerificationToken: "hashed-token",
        portalVerificationExpires: new Date("2026-09-06T12:00:00.000Z"),
      },
    })
    expect(JSON.stringify(vi.mocked(prisma.contact.update).mock.calls)).not.toContain("plain-token")
  })

  it("identifies first-time activation separately from password reset", async () => {
    const result = await issuePortalPasswordLink({ ...contact, portalPasswordHash: null, preferredLanguage: "az" })
    expect(result).toMatchObject({ ok: true, mode: "activation" })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Acme — portal girişini qurun",
      text: expect.stringContaining("Bu keçid 24 saat etibarlıdır"),
    }))
  })

  it("restores the previous link when the email provider definitely rejects delivery", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false } as any)
    expect(await issuePortalPasswordLink(contact)).toEqual({ ok: false, reason: "delivery_failed" })
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", portalVerificationToken: "hashed-token" },
      data: {
        portalVerificationToken: "previous-token",
        portalVerificationExpires: contact.portalVerificationExpires,
      },
    })
  })
})
