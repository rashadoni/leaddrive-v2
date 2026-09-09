import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { findFirst: vi.fn(), findMany: vi.fn() },
  socialConnectionCursor: { findUnique: vi.fn(), upsert: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  ingestMention: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({ decryptToken: deps.decryptToken }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: deps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: deps.ingestMentionWithResult,
  ingestMention: deps.ingestMention,
}))

import { runTelegramDiscussionCollector } from "@/lib/social/telegram-scanner"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-telegram",
  organizationId: "org-1",
  platform: "telegram",
  sourceType: "page",
  ownership: "owned",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 60,
  handle: "brandchannel",
  keywords: ["brand"],
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: { socialAccountId: "account-1", discussionChatIds: [-100200] },
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "READ_THREAD",
    adapterKey: "TELEGRAM_BOT_API",
    acquisitionMode: "OFFICIAL_API",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mockPrisma.socialAccount.findFirst.mockResolvedValue({
    id: "account-1",
    organizationId: "org-1",
    handle: "brandchannel",
    accessToken: "encrypted-token",
    keywords: ["brand"],
    isActive: true,
  })
  mockPrisma.socialConnectionCursor.findUnique.mockResolvedValue({ cursorValue: "10" })
  mockPrisma.socialConnectionCursor.upsert.mockResolvedValue({ id: "cursor-1" })
  deps.decryptToken.mockReturnValue("telegram-bot-token")
  deps.classifySentiment.mockResolvedValue("neutral")
  deps.findMatchedKeyword.mockImplementation((text: string) => text.toLowerCase().includes("brand") ? "brand" : null)
  deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string }) => ({ id: `mention-${input.externalId}`, created: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Telegram channel and discussion scanner", () => {
  it("uses a connection cursor and accepts only delivered owned/discussion updates", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toContain("bottelegram-bot-token/getUpdates")
      expect(url.searchParams.get("offset")).toBe("10")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 10,
            channel_post: { message_id: 50, date: 1782209400, text: "Owned channel post", chat: { id: -100100, type: "channel", username: "brandchannel", title: "Brand" } },
          },
          {
            update_id: 11,
            message: {
              message_id: 70,
              date: 1782209401,
              text: "brand discussion reply",
              chat: { id: -100200, type: "supergroup", username: "brandtalk", title: "Brand discussion" },
              reply_to_message: { message_id: 69, date: 1782209300, text: "parent", chat: { id: -100200 } },
            },
          },
          {
            update_id: 12,
            message: { message_id: 80, date: 1782209402, text: "unrelated group", chat: { id: -100999, type: "supergroup", username: "other" } },
          },
        ],
      }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runTelegramDiscussionCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 2,
      ignoredCount: 1,
      rawStats: expect.objectContaining({ offsetBefore: 10, offsetAfter: 13, coverageClass: "COMPLETE_FOR_DELIVERED_UPDATES" }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "-100200_70",
      contentKind: "REPLY",
      parentExternalId: "-100200_69",
      canonicalUrl: "https://t.me/brandtalk/70",
      observation: expect.objectContaining({ requireMatchedTerm: true, adapterKey: "TELEGRAM_BOT_API" }),
    }))
    expect(mockPrisma.socialConnectionCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ cursorValue: "13" }),
      update: expect.objectContaining({ cursorValue: "13", cursorVersion: { increment: 1 } }),
    }))
    expect(deps.ingestMention).not.toHaveBeenCalled()
  })
})
