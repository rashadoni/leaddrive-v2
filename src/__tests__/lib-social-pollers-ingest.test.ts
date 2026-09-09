import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PR: comments coverage — every legacy poller must route items through ingestMention
 * (real sourceType + scenario keyword matching + clustering + workflow triggers)
 * instead of a raw prisma upsert that left rows as sourceType="unknown".
 */

const { ingestMention, ingestMentionWithResult } = vi.hoisted(() => ({
  ingestMention: vi.fn(async () => true),
  ingestMentionWithResult: vi.fn(async () => ({ id: "mention-1", created: true })),
}))
// Full factory (no importOriginal): the real ingest-mention pulls workflow-engine →
// next-auth, which does not resolve under vitest. findMatchedKeyword comes from its
// real dependency-free home so the tests exercise production matching semantics.
vi.mock("@/lib/social/ingest-mention", async () => {
  const { findMatchedKeyword } = await import("@/lib/social/keyword-match")
  return { ingestMention, ingestMentionWithResult, findMatchedKeyword }
})

const { decryptToken, encryptToken } = vi.hoisted(() => ({
  decryptToken: vi.fn(() => "access-token::refresh-token"),
  encryptToken: vi.fn((value: string) => `encrypted:${value}`),
}))
vi.mock("@/lib/secure-token", () => ({ decryptToken, encryptToken }))

vi.mock("@/lib/sentiment", () => ({ classifySentiment: vi.fn(async () => "neutral") }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    socialMention: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    socialConnectionCursor: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { pollYouTubeAccount } from "@/lib/social/youtube-poller"
import { pollTwitterAccount } from "@/lib/social/twitter-poller"
import { pollVkAccount } from "@/lib/social/vk-poller"
import { scanTelegramForOrg } from "@/lib/social/telegram-scanner"

const findAccount = vi.mocked(prisma.socialAccount.findUnique)
const findAccounts = vi.mocked(prisma.socialAccount.findMany)
const updateAccount = vi.mocked(prisma.socialAccount.update)
const findMention = vi.mocked(prisma.socialMention.findUnique)
const upsertMention = vi.mocked(prisma.socialMention.upsert)
const findCursor = vi.mocked(prisma.socialConnectionCursor.findUnique)
const upsertCursor = vi.mocked(prisma.socialConnectionCursor.upsert)

function account(platform: string, extra: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    organizationId: "org-1",
    platform,
    handle: platform === "youtube" ? "UCchannel123" : "brand",
    displayName: "Brand",
    keywords: ["BrandName"],
    accessToken: "encrypted-token",
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    isActive: true,
    ...extra,
  }
}

function fetchJson(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => payload, text: async () => "" })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  ingestMention.mockResolvedValue(true)
  ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
  updateAccount.mockResolvedValue({ id: "acc-1" } as never)
  upsertMention.mockResolvedValue({ id: "sentinel" } as never)
  findCursor.mockResolvedValue({ cursorValue: "0" } as never)
  upsertCursor.mockResolvedValue({ id: "cursor-1" } as never)
})

describe("youtube poller → ingestMention", () => {
  it("ingests owned-video comments as sourceType=comment with a per-comment deep link", async () => {
    findAccount.mockResolvedValue(account("youtube") as never)
    global.fetch = fetchJson({
      items: [{
        id: "thread-1",
        snippet: {
          videoId: "vid42",
          topLevelComment: { snippet: {
            textDisplay: "Love BrandName products!",
            authorDisplayName: "Fan",
            publishedAt: "2026-07-01T10:00:00Z",
            likeCount: 2,
          } },
        },
      }],
    })

    const result = await pollYouTubeAccount("acc-1")

    expect(result).toEqual({ ingested: 1 })
    expect(ingestMention).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "youtube",
      externalId: "thread-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { videoId: "vid42" },
      matchedTerm: "BrandName",
      url: "https://www.youtube.com/watch?v=vid42&lc=thread-1",
    }))
  })

  it("follows every nextPageToken before advancing the account watermark", async () => {
    findAccount.mockResolvedValue(account("youtube") as never)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nextPageToken: "page-2",
          items: [{
            id: "thread-1",
            snippet: { videoId: "vid42", topLevelComment: { snippet: { textDisplay: "BrandName first", publishedAt: "2026-07-02T10:00:00Z" } } },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            id: "thread-2",
            snippet: { videoId: "vid42", topLevelComment: { snippet: { textDisplay: "BrandName second", publishedAt: "2026-07-01T10:00:00Z" } } },
          }],
        }),
      })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(pollYouTubeAccount("acc-1")).resolves.toEqual({ ingested: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("maxResults")).toBe("100")
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("pageToken")).toBe("page-2")
    expect(updateAccount).toHaveBeenCalledOnce()
  })

  it("stops at the prior successful watermark and skips older comments", async () => {
    findAccount.mockResolvedValue(account("youtube", { lastPolledAt: new Date("2026-07-02T00:00:00Z") }) as never)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        nextPageToken: "older-page",
        items: [
          { id: "new", snippet: { videoId: "vid", topLevelComment: { snippet: { textDisplay: "BrandName new", publishedAt: "2026-07-03T00:00:00Z" } } } },
          { id: "old", snippet: { videoId: "vid", topLevelComment: { snippet: { textDisplay: "BrandName old", publishedAt: "2026-07-01T00:00:00Z" } } } },
        ],
      }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(pollYouTubeAccount("acc-1")).resolves.toEqual({ ingested: 1 })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(ingestMention).toHaveBeenCalledOnce()
    expect(ingestMention).toHaveBeenCalledWith(expect.objectContaining({ externalId: "new" }))
  })

  it("keeps the old watermark when a later page fails", async () => {
    findAccount.mockResolvedValue(account("youtube") as never)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ nextPageToken: "page-2", items: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 503 }) as unknown as typeof fetch

    await expect(pollYouTubeAccount("acc-1")).resolves.toEqual({ ingested: 0, error: "threads failed 503" })
    expect(updateAccount).not.toHaveBeenCalled()
  })
})

describe("twitter poller → ingestMention", () => {
  it("ingests search results as sourceType=mention with the matched keyword", async () => {
    findAccount.mockResolvedValue(account("twitter") as never)
    global.fetch = fetchJson({
      data: [{ id: "tw-1", text: "BrandName is great", author_id: "u1", created_at: "2026-07-01T10:00:00Z", public_metrics: { like_count: 3 } }],
      includes: { users: [{ id: "u1", username: "fan", name: "Fan" }] },
    })

    const result = await pollTwitterAccount("acc-1")

    expect(result).toEqual({
      ingested: 1,
      found: 1,
      duplicates: 0,
      ignored: 0,
      providerRequestDispatched: true,
      dispatchUnknown: false,
    })
    // Official acquisition does not make a stranger's tweet owned content.
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "twitter",
      externalId: "tw-1",
      sourceType: "mention",
      sourceProvider: "official_api",
      matchedTerm: "BrandName",
      url: "https://twitter.com/fan/status/tw-1",
    }))
  })
})

describe("vk poller → ingestMention", () => {
  it("ingests public posts as sourceType=post", async () => {
    findAccount.mockResolvedValue(account("vkontakte") as never)
    process.env.VK_SERVICE_TOKEN = "vk-token"
    global.fetch = fetchJson({
      response: { items: [{ id: 7, owner_id: -100, text: "News about BrandName", date: 1_719_600_000, views: { count: 5 } }] },
    })

    const result = await pollVkAccount("acc-1")

    expect(result).toEqual({ ingested: 1 })
    expect(ingestMention).toHaveBeenCalledWith(expect.objectContaining({
      platform: "vkontakte",
      externalId: "-100_7",
      sourceType: "post",
      sourceProvider: "manual",
      matchedTerm: "BrandName",
      url: "https://vk.com/wall-100_7",
    }))
  })
})

describe("telegram scanner → ingestMention", () => {
  it("ingests keyword-matched channel posts and persists a connection cursor instead of a fake mention", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tg-token"
    findMention.mockResolvedValue({ reach: 0 } as never) // offset row
    findAccounts.mockResolvedValue([account("telegram", { handle: "@brandchannel" })] as never)
    global.fetch = fetchJson({
      ok: true,
      result: [{
        update_id: 10,
        channel_post: { message_id: 5, date: 1_719_600_000, text: "BrandName launch!", chat: { id: -1, title: "Brand Channel", username: "brandchannel" } },
      }, {
        update_id: 11,
        channel_post: { message_id: 6, date: 1_719_600_001, text: "off-topic post", chat: { id: -1, title: "Brand Channel", username: "brandchannel" } },
      }],
    })

    const result = await scanTelegramForOrg("org-1")

    expect(result).toEqual({ ingested: 1 })
    expect(ingestMention).toHaveBeenCalledTimes(1)
    expect(ingestMention).toHaveBeenCalledWith(expect.objectContaining({
      platform: "telegram",
      externalId: "-1_5",
      sourceType: "post",
      sourceProvider: "native",
      matchedTerm: "BrandName",
      url: "https://t.me/brandchannel/5",
    }))
    expect(upsertMention).not.toHaveBeenCalled()
    expect(upsertCursor).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ cursorValue: "12", adapterKey: "TELEGRAM_BOT_API" }),
    }))
  })
})
