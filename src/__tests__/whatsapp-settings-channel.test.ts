import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-rls", () => ({ withRls: (handler: (req: NextRequest, auth: {orgId: string}) => unknown) => (req: NextRequest) => handler(req, { orgId: "org_1" }) }))
vi.mock("@/lib/prisma", () => ({ prisma: {
  channelConfig: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  channelMessage: { findMany: vi.fn() },
  whatsAppTemplate: { findMany: vi.fn(), upsert: vi.fn() },
} }))
import { prisma } from "@/lib/prisma"
import { selectWhatsAppSettingsChannel, selectWhatsAppAutomationChannel } from "@/lib/channels/whatsapp-settings-channel"
import { GET as channels } from "@/app/api/v1/whatsapp/channels/route"
import { GET as templates, POST as sync } from "@/app/api/v1/whatsapp/templates/route"
import { GET as settings, PUT as save } from "@/app/api/v1/whatsapp/notification-settings/route"
import { POST as validate } from "@/app/api/v1/whatsapp/validate/route"

const row = { id: "wa_b", organizationId: "org_1", channelType: "whatsapp", isActive: true,
  accessToken: "fixture-only", phoneNumberId: "222", businessAccountId: "waba_b", settings: {},
  lastValidatedAt: null, lastTemplateSyncAt: null, displayName: "Business B" }
function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/whatsapp/${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ id: "wa_a" }, { id: "wa_b" }] as never)
  vi.mocked(prisma.channelConfig.findFirst).mockImplementation(async (query: unknown) => {
    const where = (query as { where?: { id?: string; organizationId?: string } })?.where
    return where?.id === "wa_b" && where.organizationId === "org_1" ? row as never : null
  })
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([])
  vi.mocked(prisma.whatsAppTemplate.findMany).mockResolvedValue([])
  vi.mocked(prisma.whatsAppTemplate.upsert).mockResolvedValue({ id: "tpl" } as never)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
})

describe("explicit WhatsApp settings channel", () => {
  it("requires selection for multiple active business numbers", async () => {
    expect(await selectWhatsAppSettingsChannel("org_1")).toMatchObject({ id: null, error: "whatsapp_channel_required" })
    for (const action of [sync, validate]) expect((await action(req("templates", "POST"))).status).toBe(409)
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it("will not fall back for a foreign, inactive or deleted selected channel", async () => {
    expect(await selectWhatsAppSettingsChannel("org_1", "foreign")).toMatchObject({ id: null })
    expect((await sync(req("templates?channelConfigId=foreign", "POST"))).status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it("only auto-selects the sole active channel", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ id: "wa_b" }] as never)
    expect(await selectWhatsAppSettingsChannel("org_1")).toMatchObject({ id: "wa_b" })
  })
  it("returns a safe channel inventory without credentials", async () => {
    await channels(req("channels"))
    expect(prisma.channelConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org_1", channelType: "whatsapp", isActive: true },
      select: { id: true, configName: true, displayName: true, phoneNumberId: true },
    }))
  })
  it("filters cached templates to the selected tenant/channel", async () => {
    expect((await templates(req("templates?channelConfigId=wa_b"))).status).toBe(200)
    expect(prisma.whatsAppTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org_1", channelConfigId: "wa_b" } }))
  })
  it("syncs the selected WABA and keys identical names by channel", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mt", name: "welcome", language: "en", status: "APPROVED", components: [] }] }), { status: 200 }))
    const res = await sync(req("templates?channelConfigId=wa_b", "POST"))
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/waba_b/message_templates"), expect.anything())
    expect(prisma.whatsAppTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId_channelConfigId_name_language: { organizationId: "org_1", channelConfigId: "wa_b", name: "welcome", language: "en" } } }))
  })
  it("preserves a provider permission error without marking sync successful", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "(#200) Permission denied" } }), { status: 403 }))
    const res = await sync(req("templates?channelConfigId=wa_b", "POST"))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain("#200")
    expect(prisma.channelConfig.update).not.toHaveBeenCalled()
  })
  it("saves explicit off values on the selected channel, retaining unrelated settings", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ ...row, settings: { replyMode: "ai", whatsappSurveyTemplate: "old" } } as never)
    const res = await save(req("notification-settings?channelConfigId=wa_b", "PUT", { whatsappTicketStatusTemplates: {}, whatsappSurveyTemplate: "", whatsappJourneyDefaultTemplate: "" }))
    expect(res.status).toBe(200)
    expect(prisma.channelConfig.update).toHaveBeenCalledWith({ where: { id: "wa_b" }, data: { settings: { replyMode: "ai", whatsappTicketStatusTemplates: {}, whatsappSurveyTemplate: "", whatsappJourneyDefaultTemplate: "" } } })
  })
  it("exposes the legacy plain-text fallback instead of calling it disabled", async () => {
    expect((await (await settings(req("notification-settings?channelConfigId=wa_b"))).json()).legacyFallbackEnabled).toBe(true)
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ ...row, settings: { whatsappTicketStatusTemplates: {}, whatsappSurveyTemplate: "" } } as never)
    expect((await (await settings(req("notification-settings?channelConfigId=wa_b"))).json()).legacyFallbackEnabled).toBe(false)
  })
})

describe("automation sender isolation", () => {
  it("uses the exact business number with inbound history", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ channelConfigId: "wa_b" }] as never)
    expect(await selectWhatsAppAutomationChannel("org_1", "+994501234567")).toMatchObject({ id: "wa_b" })
    expect(prisma.channelMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org_1", OR: expect.arrayContaining([{ from: { in: ["994501234567", "+994501234567"] } }]) }) }))
  })
  it("does not choose among two receiving numbers", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([{ channelConfigId: "wa_a" }, { channelConfigId: "wa_b" }] as never)
    expect(await selectWhatsAppAutomationChannel("org_1", "+994501234567")).toMatchObject({ id: null, error: "whatsapp_channel_required" })
  })
})
