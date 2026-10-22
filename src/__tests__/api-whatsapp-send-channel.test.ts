import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: (req: NextRequest, auth: { orgId: string }) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: "org-1" }),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { findFirst: vi.fn(), findMany: vi.fn() } } }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), sendWhatsAppTemplate: vi.fn() }))
vi.mock("@/lib/verify-owned-refs", () => ({ sanitizeOwnedRefs: vi.fn(async () => ({})) }))

import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp"
import { POST as testMessage } from "@/app/api/v1/whatsapp/test/route"
import { POST as sendMessage } from "@/app/api/v1/whatsapp/send/route"

type Channel = { id: string; organizationId: string; channelType: string; isActive: boolean }
let channels: Channel[]
function matching(query: unknown) {
  const where = (query as { where: Partial<Channel> }).where
  return channels.filter(row => Object.entries(where).every(([key, value]) => row[key as keyof Channel] === value))
}
beforeEach(() => {
  vi.clearAllMocks()
  channels = [
    { id: "wa-a", organizationId: "org-1", channelType: "whatsapp", isActive: true },
    { id: "wa-b", organizationId: "org-1", channelType: "whatsapp", isActive: true },
    { id: "wa-foreign", organizationId: "org-2", channelType: "whatsapp", isActive: true },
    { id: "wa-disabled", organizationId: "org-1", channelType: "whatsapp", isActive: false },
  ]
  vi.mocked(prisma.channelConfig.findFirst).mockImplementation(async (query: unknown) => matching(query)[0] as never || null)
  vi.mocked(prisma.channelConfig.findMany).mockImplementation(async (query: unknown) => matching(query).slice(0, 2) as never)
  vi.mocked(sendWhatsAppMessage).mockResolvedValue({ success: true, messageId: "wamid.fixture" })
  vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ success: true, messageId: "wamid.fixture" })
})

const scenarios = [
  { name: "test template", route: testMessage, path: "test", payload: { templateName: "welcome", languageCode: "ru" }, sender: sendWhatsAppMessage },
  { name: "template send", route: sendMessage, path: "send", payload: { templateName: "welcome", languageCode: "ru" }, sender: sendWhatsAppTemplate },
  { name: "text send", route: sendMessage, path: "send", payload: { message: "Fixture message" }, sender: sendWhatsAppMessage },
]

describe.each(scenarios)("WhatsApp $name sender isolation", ({ route, path, payload, sender }) => {
  async function send(channelConfigId?: string) {
    return route(new NextRequest(`http://localhost/api/v1/whatsapp/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+994501234567", ...payload, ...(channelConfigId === undefined ? {} : { channelConfigId }) }),
    }))
  }

  it("passes the explicitly selected second number to the actual sending boundary", async () => {
    expect((await send("wa-b")).status).toBe(200)
    expect(sender).toHaveBeenCalledOnce()
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", channelConfigId: "wa-b" }))
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
  })

  it("preserves single-number requests by selecting the sole active owned sender", async () => {
    channels = channels.filter(row => row.id !== "wa-a")
    expect((await send()).status).toBe(200)
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ channelConfigId: "wa-b" }))
  })

  it("returns 409 without sending when the sender is ambiguous", async () => {
    const response = await send()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "whatsapp_channel_required" })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it.each(["wa-foreign", "wa-disabled", "wa-deleted"])("rejects %s without falling back to another active number", async id => {
    expect((await send(id)).status).toBe(404)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
  })

  it("rejects an explicitly empty sender instead of silently selecting a default", async () => {
    expect((await send("")).status).toBe(400)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })
})
