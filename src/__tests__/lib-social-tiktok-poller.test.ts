import { beforeEach, describe, expect, it, vi } from "vitest"

const { decryptToken, encryptToken } = vi.hoisted(() => ({
  decryptToken: vi.fn(() => "access-token::refresh-token"),
  encryptToken: vi.fn((value: string) => `encrypted:${value}`),
}))

vi.mock("@/lib/secure-token", () => ({ decryptToken, encryptToken }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    socialMention: {
      upsert: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { pollTikTokAccount } from "@/lib/social/tiktok-poller"

const findAccount = vi.mocked(prisma.socialAccount.findUnique)
const updateAccount = vi.mocked(prisma.socialAccount.update)
const upsertMention = vi.mocked(prisma.socialMention.upsert)

beforeEach(() => {
  vi.clearAllMocks()
  findAccount.mockResolvedValue({
    id: "acc-1",
    organizationId: "org-1",
    platform: "tiktok",
    handle: "brand",
    displayName: "Brand",
    accessToken: "encrypted-token",
    tokenExpiresAt: new Date(Date.now() + 3600000),
    isActive: true,
  })
  updateAccount.mockResolvedValue({ id: "acc-1" })
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        videos: [
          {
            id: "video-1",
            title: "Do not turn me into a mention",
            create_time: 1_719_600_000,
            view_count: 100,
            like_count: 10,
            comment_count: 3,
            share_count: 1,
          },
        ],
      },
    }),
  })) as unknown as typeof fetch
})

describe("pollTikTokAccount", () => {
  it("does not create SocialMention rows from TikTok video titles", async () => {
    const result = await pollTikTokAccount("acc-1")

    expect(result).toEqual({
      ingested: 0,
      error: "TikTok Display API can list videos but cannot read comment bodies; configure a verified TikTok Business API route or approved provider/webhook",
    })
    expect(upsertMention).not.toHaveBeenCalled()
    expect(updateAccount).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { lastPolledAt: expect.any(Date) },
    })
  })
})
