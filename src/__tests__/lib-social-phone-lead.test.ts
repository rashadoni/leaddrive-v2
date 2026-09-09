import { beforeEach, describe, expect, it, vi } from "vitest"

const { matchInboundLeadId } = vi.hoisted(() => ({
  matchInboundLeadId: vi.fn(),
}))
const { deliverSocialLeadToWhatsAppGroup } = vi.hoisted(() => ({
  deliverSocialLeadToWhatsAppGroup: vi.fn(async () => ({ status: "sent", dryRun: true })),
}))

vi.mock("@/lib/inbound-lead-match", () => ({
  matchInboundLeadId,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    lead: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/unified-profile/profile-builder", () => ({ refreshProfileForSource: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/social/whatsapp-group-delivery", () => ({ deliverSocialLeadToWhatsAppGroup }))

import { logAudit, prisma } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { processSocialPhoneLead } from "@/lib/social/phone-lead"

const updateMention = vi.mocked(prisma.socialMention.updateMany)
const findMentionForClaim = vi.mocked(prisma.socialMention.findFirst)
const findMention = vi.mocked(prisma.socialMention.findUnique)
const createLead = vi.mocked(prisma.lead.create)
const deleteLead = vi.mocked(prisma.lead.delete)
const createActivity = vi.mocked(prisma.activity.create)
const audit = vi.mocked(logAudit)
const workflows = vi.mocked(executeWorkflows)

const input = {
  organizationId: "org-1",
  mentionId: "mention-1",
  platform: "tiktok",
  phone: "+994501112233",
  authorName: "Aysel",
  authorHandle: "chatwoot:777",
  text: "Nomrem 050 111 22 33",
  url: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  matchInboundLeadId.mockResolvedValue(undefined)
  findMentionForClaim.mockResolvedValue({ sourceMetadata: { chatwootConversationId: "777" } })
  updateMention.mockResolvedValue({ count: 1 })
  createLead.mockResolvedValue({
    id: "lead-1",
    organizationId: "org-1",
    contactName: "Aysel",
    companyName: null,
    phone: "+994501112233",
    phoneWhatsApp: "+994501112233",
    source: "social:tiktok",
  })
  createActivity.mockResolvedValue({ id: "activity-1" })
  deleteLead.mockResolvedValue({ id: "lead-1" })
})

describe("processSocialPhoneLead", () => {
  it("rejects lead creation when the supplied phone is invalid", async () => {
    await expect(processSocialPhoneLead({ ...input, phone: "" })).rejects.toThrow("phone-required")
    expect(createLead).not.toHaveBeenCalled()
  })

  it("creates and links a new lead when no duplicate phone exists", async () => {
    const result = await processSocialPhoneLead(input)

    expect(result).toEqual({ status: "lead_created", leadId: "lead-1" })
    expect(createLead).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        contactName: "Aysel",
        phone: "+994501112233",
        phoneWhatsApp: "+994501112233",
        source: "social:tiktok",
      }),
    })
    expect(updateMention).toHaveBeenCalledWith({
      where: { id: "mention-1", organizationId: "org-1", leadId: null },
      data: expect.objectContaining({
        leadId: "lead-1",
        status: "converted_to_lead",
        sourceMetadata: expect.objectContaining({
          chatwootConversationId: "777",
          phoneLead: expect.objectContaining({
            phone: "+994501112233",
            normalizedPhone: "+994501112233",
            leadId: "lead-1",
            status: "lead_created",
          }),
        }),
      }),
    })
    expect(audit).toHaveBeenCalledWith("org-1", "create", "lead", "lead-1", "Aysel")
    expect(workflows).toHaveBeenCalledWith("org-1", "lead", "created", expect.objectContaining({ id: "lead-1" }))
    expect(deliverSocialLeadToWhatsAppGroup).toHaveBeenCalledWith({
      organizationId: "org-1",
      leadId: "lead-1",
      mentionId: "mention-1",
      payload: expect.objectContaining({
        name: "Aysel",
        username: "chatwoot:777",
        phone: "+994501112233",
        messageText: "Nomrem 050 111 22 33",
      }),
    })
  })

  it("links duplicate phone mentions to an existing lead without creating a new lead", async () => {
    matchInboundLeadId.mockResolvedValue("lead-existing")

    const result = await processSocialPhoneLead(input)

    expect(result).toEqual({ status: "duplicate_linked", leadId: "lead-existing" })
    expect(createLead).not.toHaveBeenCalled()
    expect(updateMention).toHaveBeenCalledWith({
      where: { id: "mention-1", organizationId: "org-1", leadId: null },
      data: expect.objectContaining({
        leadId: "lead-existing",
        status: "converted_to_lead",
        sourceMetadata: expect.objectContaining({
          phoneLead: expect.objectContaining({
            leadId: "lead-existing",
            status: "duplicate_linked",
          }),
        }),
      }),
    })
    expect(createActivity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "note",
        relatedType: "lead",
        relatedId: "lead-existing",
      }),
    })
    expect(deliverSocialLeadToWhatsAppGroup).not.toHaveBeenCalled()
  })

  it("deletes an orphan lead if another process linked the mention first", async () => {
    updateMention.mockResolvedValue({ count: 0 })
    findMention.mockResolvedValue({ leadId: "winner-lead" })

    const result = await processSocialPhoneLead(input)

    expect(result).toEqual({ status: "already_linked", leadId: "winner-lead" })
    expect(deleteLead).toHaveBeenCalledWith({ where: { id: "lead-1" } })
    expect(audit).not.toHaveBeenCalled()
    expect(workflows).not.toHaveBeenCalled()
  })
})
