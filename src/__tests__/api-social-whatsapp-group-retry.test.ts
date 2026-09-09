import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findFirst: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/social/whatsapp-group-delivery", () => ({
  deliverSocialLeadToWhatsAppGroup: vi.fn(),
}))

import { POST } from "@/app/api/v1/social/mentions/[id]/whatsapp-group/retry/route"
import { prisma } from "@/lib/prisma"
import { deliverSocialLeadToWhatsAppGroup } from "@/lib/social/whatsapp-group-delivery"

const findMention = vi.mocked(prisma.socialMention.findFirst)
const findLead = vi.mocked(prisma.lead.findFirst)
const deliver = vi.mocked(deliverSocialLeadToWhatsAppGroup)

const baseMention = {
  id: "mention-1",
  organizationId: "org-1",
  platform: "tiktok",
  authorName: "Aysel",
  authorHandle: "aysel",
  text: "Nomrem 050 111 22 33",
  url: "https://www.tiktok.com/@brand/video/1",
  sourceMetadata: { campaignName: "Summer" },
  matchedTerm: "brand",
  leadId: "lead-1",
  whatsappGroupStatus: "failed",
  publishedAt: new Date("2026-06-29T10:00:00.000Z"),
  createdAt: new Date("2026-06-29T10:05:00.000Z"),
}

function req() {
  return new NextRequest("http://localhost/api/v1/social/mentions/mention-1/whatsapp-group/retry", {
    method: "POST",
  })
}

const params = { params: Promise.resolve({ id: "mention-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  findMention.mockResolvedValue(baseMention)
  findLead.mockResolvedValue({
    id: "lead-1",
    contactName: "Aysel M.",
    phone: "+994501112233",
    phoneWhatsApp: null,
  })
  deliver.mockResolvedValue({
    status: "sent",
    dryRun: true,
    destination: { id: "120363-group@g.us", name: "TikTok leads" },
    payload: {
      name: "Aysel M.",
      username: "aysel",
      phone: "+994501112233",
      messageText: "Nomrem 050 111 22 33",
      videoLink: "https://www.tiktok.com/@brand/video/1",
      date: "2026-06-29T10:00:00.000Z",
      campaign: "Summer",
    },
  })
})

describe("POST /api/v1/social/mentions/[id]/whatsapp-group/retry", () => {
  it("retries a failed WhatsApp lead delivery through the dry-run adapter", async () => {
    const res = await POST(req(), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe("sent")
    expect(deliver).toHaveBeenCalledWith({
      organizationId: "org-1",
      leadId: "lead-1",
      mentionId: "mention-1",
      payload: {
        name: "Aysel M.",
        username: "aysel",
        phone: "+994501112233",
        messageText: "Nomrem 050 111 22 33",
        videoLink: "https://www.tiktok.com/@brand/video/1",
        date: "2026-06-29T10:00:00.000Z",
        campaign: "Summer",
      },
    })
  })

  it("rejects retry for non-failed deliveries", async () => {
    findMention.mockResolvedValueOnce({
      ...baseMention,
      whatsappGroupStatus: "dry_run_sent",
    })

    const res = await POST(req(), params)

    expect(res.status).toBe(409)
    expect(deliver).not.toHaveBeenCalled()
  })

  it("requires a linked lead with a phone number", async () => {
    findLead.mockResolvedValueOnce({
      id: "lead-1",
      contactName: "Aysel M.",
      phone: null,
      phoneWhatsApp: null,
    })

    const res = await POST(req(), params)

    expect(res.status).toBe(409)
    expect(deliver).not.toHaveBeenCalled()
  })
})
