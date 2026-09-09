import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
    socialMention: {
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { deliverSocialLeadToWhatsAppGroup } from "@/lib/social/whatsapp-group-delivery"

const findChannel = vi.mocked(prisma.channelConfig.findFirst)
const createActivity = vi.mocked(prisma.activity.create)
const updateMention = vi.mocked(prisma.socialMention.updateMany)

const input = {
  organizationId: "org-1",
  leadId: "lead-1",
  mentionId: "mention-1",
  payload: {
    name: "Aysel",
    username: "chatwoot:777",
    phone: "+994501112233",
    messageText: "Nomrem 050 111 22 33",
    videoLink: "https://www.tiktok.com/@brand/video/1",
    date: "2026-06-29T10:00:00.000Z",
    campaign: null,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  createActivity.mockResolvedValue({ id: "activity-1" })
  updateMention.mockResolvedValue({ count: 1 })
})

describe("deliverSocialLeadToWhatsAppGroup", () => {
  it("builds a dry-run sent result when a social lead group is configured", async () => {
    findChannel.mockResolvedValue({
      settings: {
        socialLeadGroup: { id: "120363-group@g.us", name: "TikTok leads" },
      },
    })

    const result = await deliverSocialLeadToWhatsAppGroup(input)

    expect(result).toEqual({
      status: "sent",
      dryRun: true,
      destination: { id: "120363-group@g.us", name: "TikTok leads" },
      payload: input.payload,
    })
    expect(createActivity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "note",
        subject: "WhatsApp group delivery dry-run",
        relatedType: "lead",
        relatedId: "lead-1",
      }),
    })
    expect(updateMention).toHaveBeenCalledWith({
      where: { id: "mention-1", organizationId: "org-1" },
      data: expect.objectContaining({
        whatsappGroupStatus: "dry_run_sent",
        whatsappGroupDestination: { id: "120363-group@g.us", name: "TikTok leads" },
        whatsappGroupLastError: null,
        whatsappGroupDeliveredAt: expect.any(Date),
      }),
    })
  })

  it("records a dry-run failure when the group destination is missing", async () => {
    findChannel.mockResolvedValue({ settings: {} })

    const result = await deliverSocialLeadToWhatsAppGroup(input)

    expect(result).toEqual({
      status: "failed",
      dryRun: true,
      error: "WhatsApp group destination is not configured",
      payload: input.payload,
    })
    expect(createActivity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: "WhatsApp group delivery failed",
        relatedType: "lead",
        relatedId: "lead-1",
      }),
    })
    expect(updateMention).toHaveBeenCalledWith({
      where: { id: "mention-1", organizationId: "org-1" },
      data: expect.objectContaining({
        whatsappGroupStatus: "failed",
        whatsappGroupDestination: {},
        whatsappGroupLastError: "WhatsApp group destination is not configured",
        whatsappGroupDeliveredAt: expect.any(Date),
      }),
    })
  })
})
