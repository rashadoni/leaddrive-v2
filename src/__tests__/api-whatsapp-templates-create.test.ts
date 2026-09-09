import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/v1/whatsapp/templates/route"
import { prisma } from "@/lib/prisma"

const originalFetch = global.fetch
type RlsHandler = (req: NextRequest, auth: { orgId: string }, ctx?: unknown) => unknown

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: RlsHandler) => (req: NextRequest, ctx?: unknown) => handler(req, { orgId: "org_1" }, ctx),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    whatsAppTemplate: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/whatsapp/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
    id: "cfg_wa",
    organizationId: "org_1",
    accessToken: "token_1",
    apiKey: null,
    phoneNumberId: "phone_1",
    phoneNumber: null,
    businessAccountId: "waba_1",
    webhookUrl: null,
    verifyToken: "verify",
    appSecret: "secret",
    displayName: "LeadDrive",
  } as never)
  vi.mocked(prisma.whatsAppTemplate.upsert).mockResolvedValue({
    id: "tpl_1",
    name: "campaign_update_az",
    language: "az",
    category: "MARKETING",
    status: "PENDING",
    metaTemplateId: "meta_tpl_1",
  } as never)
  vi.mocked(prisma.channelConfig.update).mockResolvedValue({ id: "cfg_wa" } as never)
  global.fetch = vi.fn(async () => (
    new Response(JSON.stringify({ id: "meta_tpl_1", status: "PENDING" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )) as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe("POST /api/v1/whatsapp/templates create", () => {
  it("submits a WhatsApp template to Meta with positional variable examples", async () => {
    const res = await POST(req({
      action: "create",
      name: "Campaign Update AZ",
      language: "az",
      category: "MARKETING",
      bodyText: "Salam! {{1}} kampaniyası haqqında yeniliklərimiz var.",
      footerText: "LeadDrive",
      sampleValues: ["Yay təklifi"],
    }))

    expect(res.status).toBe(201)
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/waba_1/message_templates",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token_1",
          "Content-Type": "application/json",
        }),
      }),
    )

    const [, init] = vi.mocked(global.fetch).mock.calls[0]
    const metaPayload = JSON.parse(String(init?.body))
    expect(metaPayload).toEqual({
      name: "campaign_update_az",
      language: "az",
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text: "Salam! {{1}} kampaniyası haqqında yeniliklərimiz var.",
          example: { body_text: [["Yay təklifi"]] },
        },
        { type: "FOOTER", text: "LeadDrive" },
      ],
    })
    expect(prisma.whatsAppTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        organizationId: "org_1",
        channelConfigId: "cfg_wa",
        metaTemplateId: "meta_tpl_1",
        name: "campaign_update_az",
        language: "az",
        status: "PENDING",
        category: "MARKETING",
        variables: ["1"],
      }),
    }))
  })

  it("returns 400 for malformed JSON before calling Meta", async () => {
    const res = await POST(req("{bad json"))

    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
