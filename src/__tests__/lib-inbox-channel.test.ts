import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * FB/IG inbox wiring (Slice 2) — ensureInboxChannelForPage. Upserts a ChannelConfig + subscribes the
 * page to the DM webhook, idempotently + fail-soft.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() } },
}))
vi.mock("@/lib/social/meta-subscribe", () => ({ subscribePageToMessages: vi.fn() }))

import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"
import { prisma } from "@/lib/prisma"
import { subscribePageToMessages } from "@/lib/social/meta-subscribe"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(subscribePageToMessages).mockResolvedValue({ success: true })
})

describe("ensureInboxChannelForPage", () => {
  it("creates a ChannelConfig + subscribes when none exists for the page", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
    const r = await ensureInboxChannelForPage("org1", "facebook", "PAGE1", "Nokaut", "PAGE_TOKEN")
    expect(r.created).toBe(true)
    expect(r.subscribed).toBe(true)
    const data = (vi.mocked(prisma.channelConfig.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.channelType).toBe("facebook")
    expect(data.pageId).toBe("PAGE1")
    expect(data.apiKey).toBe("PAGE_TOKEN")
    expect(data.isActive).toBe(true)
    expect(subscribePageToMessages).toHaveBeenCalledWith("PAGE1", "PAGE_TOKEN")
  })

  it("updates (not creates) when a ChannelConfig already exists for the page (idempotent)", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "cc1" } as never)
    const r = await ensureInboxChannelForPage("org1", "facebook", "PAGE2", "Page2", "TOKEN2")
    expect(r.created).toBe(false)
    expect(prisma.channelConfig.update).toHaveBeenCalled()
    expect(prisma.channelConfig.create).not.toHaveBeenCalled()
    expect(subscribePageToMessages).toHaveBeenCalledWith("PAGE2", "TOKEN2")
  })

  it("Instagram SKIPS the direct subscribe (IG ids return #3) — subscribed:true via the linked page", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
    const r = await ensureInboxChannelForPage("org1", "instagram", "IG1", "Kishi", "TOKEN")
    expect(r.created).toBe(true)
    expect(r.subscribed).toBe(true)
    expect(subscribePageToMessages).not.toHaveBeenCalled() // IG never calls subscribed_apps directly
    const data = (vi.mocked(prisma.channelConfig.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect((data.settings as { inboxSubscribed?: boolean }).inboxSubscribed).toBe(true)
  })

  it("is fail-soft on subscribe failure — the channel is still created", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
    vi.mocked(subscribePageToMessages).mockResolvedValueOnce({ success: false, error: "bad token" })
    const r = await ensureInboxChannelForPage("org1", "facebook", "P", "N", "T")
    expect(r.created).toBe(true)
    expect(r.subscribed).toBe(false)
  })

  it("no-ops (no DB) without org/page/token", async () => {
    expect((await ensureInboxChannelForPage("", "facebook", "P", "N", "T")).created).toBe(false)
    expect((await ensureInboxChannelForPage("o", "facebook", "", "N", "T")).created).toBe(false)
    expect((await ensureInboxChannelForPage("o", "facebook", "P", "N", "")).created).toBe(false)
    expect(prisma.channelConfig.findFirst).not.toHaveBeenCalled()
  })
})
