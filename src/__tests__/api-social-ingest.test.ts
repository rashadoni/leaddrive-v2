import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { classifySentiment, ingestMentionWithResult, findMatchedKeyword, withTenantFence } = vi.hoisted(() => ({
  classifySentiment: vi.fn(async () => "positive"),
  ingestMentionWithResult: vi.fn(async () => ({ id: "m-1", created: true })),
  findMatchedKeyword: vi.fn(() => "contact"),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: (req: NextRequest, context: { orgId: string }) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: "org-1" }),
}))

vi.mock("@/lib/sentiment", () => ({
  classifySentiment,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult,
  findMatchedKeyword,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: {
      findFirst: vi.fn(),
    },
  },
}))

import { POST } from "@/app/api/v1/social/ingest/route"
import { prisma } from "@/lib/prisma"

const findAccount = vi.mocked(prisma.socialAccount.findFirst)

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/social/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  classifySentiment.mockResolvedValue("positive")
  ingestMentionWithResult.mockResolvedValue({ id: "m-1", created: true })
  findMatchedKeyword.mockReturnValue("contact")
  findAccount.mockResolvedValue({ id: "acc-1", keywords: ["contact"] })
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
})

describe("POST /api/v1/social/ingest", () => {
  it("routes payloads through the workflow-aware ingest helper", async () => {
    const res = await POST(request({
      platform: "tiktok",
      externalId: "cw-555",
      sourceType: "comment",
      sourceProvider: "chatwoot",
      sourceMetadata: { chatwootConversationId: "42" },
      accountHandle: "@brand",
      text: "Elaqe ucun +994501112233",
      authorName: "Aysel",
      authorHandle: "aysel",
      authorAvatar: "https://cdn.example/avatar.jpg",
      url: "https://www.tiktok.com/@brand/video/1",
      reach: 2,
      engagement: 3,
      publishedAt: "2026-06-29T10:00:00.000Z",
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      data: { ingested: 1, results: [{ id: "m-1", externalId: "cw-555", created: true }] },
    })
    expect(findAccount).toHaveBeenCalledWith({
      where: { organizationId: "org-1", platform: "tiktok", handle: "@brand" },
      select: { id: true, keywords: true },
    })
    // The HTTP boundary must not spend AI tokens before the unified relevance
    // gate accepts the observation. Sentiment enrichment happens inside ingest.
    expect(classifySentiment).not.toHaveBeenCalled()
    expect(findMatchedKeyword).toHaveBeenCalledWith("Elaqe ucun +994501112233", ["contact"])
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      accountId: "acc-1",
      platform: "tiktok",
      externalId: "cw-555",
      sourceType: "comment",
      sourceProvider: "chatwoot",
      sourceMetadata: { chatwootConversationId: "42" },
      authorAvatar: "https://cdn.example/avatar.jpg",
      matchedTerm: "contact",
      sentiment: null,
      reach: 2,
      engagement: 3,
    }))
  })

  it("keeps explicit sentiment and reports duplicate helper results", async () => {
    ingestMentionWithResult.mockResolvedValue({ id: "m-existing", created: false })

    const res = await POST(request({
      platform: "instagram",
      externalId: "ig-1",
      text: "Already classified",
      sentiment: "neutral",
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(classifySentiment).not.toHaveBeenCalled()
    expect(json.data.results).toEqual([{ id: "m-existing", externalId: "ig-1", created: false }])
  })

  it("rejects the entire batch before lookup or ingest when clean-slate collection is blocked", async () => {
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const res = await POST(request({
      platform: "instagram",
      externalId: "ig-blocked",
      accountHandle: "@brand",
      text: "Must not persist",
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "social_monitoring_collection_blocked" })
    expect(findAccount).not.toHaveBeenCalled()
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })
})
