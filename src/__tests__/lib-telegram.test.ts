import { beforeEach, describe, expect, it, vi } from "vitest"

const channelConfigFindFirst = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: channelConfigFindFirst,
    },
  },
}))

import { resolveTelegramSendTarget } from "@/lib/telegram"

beforeEach(() => {
  vi.clearAllMocks()
  channelConfigFindFirst.mockResolvedValue({
    id: "tg_cfg_1",
    botToken: "bot-token",
    settings: { chatId: 123456 },
  })
})

describe("resolveTelegramSendTarget", () => {
  it("keeps the historical inbox fallback to ChannelConfig.settings.chatId for non-numeric targets", async () => {
    const target = await resolveTelegramSendTarget({
      organizationId: "org_1",
      to: "@customer",
      channelConfigId: "tg_cfg_1",
    })

    expect(target).toMatchObject({
      success: true,
      botToken: "bot-token",
      chatId: "123456",
      metadataChatId: "123456",
    })
  })

  it("lets broadcasts keep an explicit Telegram handle instead of falling back to settings.chatId", async () => {
    const target = await resolveTelegramSendTarget({
      organizationId: "org_1",
      to: "@lead_user",
      channelConfigId: "tg_cfg_1",
      preferExplicitTo: true,
    })

    expect(target).toMatchObject({
      success: true,
      botToken: "bot-token",
      chatId: "@lead_user",
    })
    if (target.success) expect(target.metadataChatId).toBeUndefined()
  })
})
