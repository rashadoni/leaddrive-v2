import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    socialConversation: { findFirst: vi.fn() },
  },
}))

import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"
import { prisma } from "@/lib/prisma"

describe("sanitizeOwnedRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(null as any)
  })

  it("returns {} and makes no DB calls when no refs given", async () => {
    const r = await sanitizeOwnedRefs("org-1", {})
    expect(r).toEqual({})
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.company.findFirst).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled()
  })

  it("keeps a leadId that belongs to the org (org-scoped lookup)", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1" } as any)
    const r = await sanitizeOwnedRefs("org-1", { leadId: "lead-1" })
    expect(r).toEqual({ leadId: "lead-1" })
    expect(vi.mocked(prisma.lead.findFirst).mock.calls[0][0]!.where).toEqual({ id: "lead-1", organizationId: "org-1" })
  })

  it("drops a leadId that is NOT in the org (forged/cross-tenant ref)", async () => {
    const r = await sanitizeOwnedRefs("org-1", { leadId: "lead-from-other-org" })
    expect(r.leadId).toBeUndefined()
  })

  it("validates companyId and dealId org-scoped (kept when found)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "co-1" } as any)
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ id: "deal-1" } as any)
    const r = await sanitizeOwnedRefs("org-1", { companyId: "co-1", dealId: "deal-1" })
    expect(r).toEqual({ companyId: "co-1", dealId: "deal-1" })
    expect(vi.mocked(prisma.company.findFirst).mock.calls[0][0]!.where).toEqual({ id: "co-1", organizationId: "org-1" })
    expect(vi.mocked(prisma.deal.findFirst).mock.calls[0][0]!.where).toEqual({ id: "deal-1", organizationId: "org-1" })
  })

  it("keeps only a conversationId that belongs to the org", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "sc-1" } as any)
    const r = await sanitizeOwnedRefs("org-1", { conversationId: "sc-1" })
    expect(r).toEqual({ conversationId: "sc-1" })
    expect(vi.mocked(prisma.socialConversation.findFirst).mock.calls[0][0]!.where).toEqual({
      id: "sc-1",
      organizationId: "org-1",
    })
  })

  it("drops foreign companyId/dealId, keeps valid contactId — each ref independent", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c-9" } as any)
    const r = await sanitizeOwnedRefs("org-1", { contactId: "c-9", companyId: "foreign-co", dealId: "foreign-deal" })
    expect(r).toEqual({ contactId: "c-9" })
  })

  it("only queries the provided refs (omitted ones skipped)", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-2" } as any)
    await sanitizeOwnedRefs("org-1", { leadId: "lead-2" })
    expect(prisma.lead.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.company.findFirst).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled()
  })
})
