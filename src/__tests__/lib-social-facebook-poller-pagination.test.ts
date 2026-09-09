import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  decryptToken: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMention: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
  cursorFindUnique: vi.fn(),
  cursorFindMany: vi.fn(),
  cursorUpsert: vi.fn(),
  cursorDeleteMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    socialConnectionCursor: {
      findUnique: mocks.cursorFindUnique,
      findMany: mocks.cursorFindMany,
      upsert: mocks.cursorUpsert,
      deleteMany: mocks.cursorDeleteMany,
    },
  },
}))

vi.mock("@/lib/secure-token", () => ({ decryptToken: mocks.decryptToken }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mocks.findMatchedKeyword,
  ingestMention: mocks.ingestMention,
}))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: mocks.parentMatchContextsForComments,
}))

import { pollFacebookAccount, pollInstagramAccount } from "@/lib/social/facebook-poller"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function installInMemoryCursorStore() {
  const rows = new Map<string, string>()
  mocks.cursorFindMany.mockImplementation(async (input: { where?: { cursorKey?: { startsWith?: string } } }) => {
    const prefix = input.where?.cursorKey?.startsWith ?? ""
    return Array.from(rows.entries())
      .filter(([cursorKey]) => cursorKey.startsWith(prefix))
      .map(([cursorKey, cursorValue]) => ({ cursorKey, cursorValue }))
  })
  mocks.cursorUpsert.mockImplementation(async (input: {
    create: { cursorKey: string; cursorValue: string }
    update: { cursorValue: string }
  }) => {
    rows.set(input.create.cursorKey, input.update.cursorValue)
    return { id: input.create.cursorKey }
  })
  mocks.cursorDeleteMany.mockImplementation(async (input: {
    where?: { cursorKey?: string | { startsWith?: string } }
  }) => {
    const selector = input.where?.cursorKey
    let count = 0
    for (const key of Array.from(rows.keys())) {
      const matches = typeof selector === "string"
        ? key === selector
        : typeof selector?.startsWith === "string" && key.startsWith(selector.startsWith)
      if (matches) {
        rows.delete(key)
        count += 1
      }
    }
    return { count }
  })
  return rows
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mocks.findUnique.mockResolvedValue({
    id: "account-1",
    organizationId: "org-1",
    platform: "instagram",
    handle: "ig-business-1",
    accessToken: "encrypted",
    keywords: ["brand"],
  })
  mocks.update.mockResolvedValue({ id: "account-1" })
  mocks.decryptToken.mockReturnValue("plain-token")
  mocks.findMatchedKeyword.mockReturnValue(null)
  mocks.ingestMention.mockResolvedValue(true)
  mocks.parentMatchContextsForComments.mockResolvedValue(new Map())
  mocks.cursorFindUnique.mockResolvedValue(null)
  mocks.cursorFindMany.mockResolvedValue([])
  mocks.cursorUpsert.mockResolvedValue({ id: "cursor-1" })
  mocks.cursorDeleteMany.mockResolvedValue({ count: 0 })
})

describe("legacy Meta account comment polling", () => {
  it("rescans a durable negative Facebook parent and keeps the cycle watermark at its cutoff", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"))
      const cursorRows = installInMemoryCursorStore()
      const accountState = {
        id: "account-1",
        organizationId: "org-1",
        platform: "facebook",
        handle: "brand-page",
        accessToken: "encrypted",
        keywords: ["brand"],
        lastPolledAt: null as Date | null,
      }
      mocks.findUnique.mockImplementation(async () => ({ ...accountState }))
      mocks.update.mockImplementation(async (input: { data?: { lastPolledAt?: Date } }) => {
        if (input.data?.lastPolledAt) accountState.lastPolledAt = input.data.lastPolledAt
        return { ...accountState }
      })
      const parentContext = {
        parentMentionId: "negative-parent",
        matchedTerm: "brand",
        subjectIds: ["subject-1"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-1"],
      }
      mocks.parentMatchContextsForComments.mockResolvedValue(new Map([["post-1", parentContext]]))
      let cycle = 1
      const parentUrls: URL[] = []
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith("/me/posts")) {
          parentUrls.push(url)
          return jsonResponse({
            data: cycle === 1
              ? [{ id: "post-1", permalink_url: "https://facebook.com/post-1" }]
              : [{ id: "post-2", permalink_url: "https://facebook.com/post-2" }],
          })
        }
        if (url.pathname.endsWith("/post-1/comments")) {
          return jsonResponse({
            data: cycle === 1
              ? [{ id: "comment-before-cutoff", message: "first" }]
              : [
                  { id: "comment-before-cutoff", message: "first" },
                  { id: "comment-after-cutoff", message: "late on old negative post" },
                ],
          })
        }
        if (url.pathname.endsWith("/post-2/comments")) {
          return jsonResponse({ data: [{ id: "comment-new-parent", message: "new parent comment" }] })
        }
        if (url.pathname.endsWith("/me/tagged")) return jsonResponse({ data: [] })
        return jsonResponse({}, 404)
      }))

      const first = await pollFacebookAccount("account-1")
      const firstUntil = Number(parentUrls[0]?.searchParams.get("until"))
      expect(first).toMatchObject({ ingested: 1 })
      expect(accountState.lastPolledAt).toEqual(new Date(firstUntil * 1_000))
      expect(cursorRows.get("legacy:facebook:watch:post-1")).toBe(JSON.stringify({ url: "https://facebook.com/post-1" }))

      vi.setSystemTime(new Date("2026-08-01T10:01:00.000Z"))
      cycle = 2
      const second = await pollFacebookAccount("account-1")

      expect(parentUrls[1]?.searchParams.get("since")).toBe(String(firstUntil))
      expect(parentUrls[1]?.searchParams.get("until")).toBe(String(firstUntil + 60))
      expect(second).toMatchObject({ ingested: 3 })
      expect(mocks.ingestMention).toHaveBeenCalledWith(expect.objectContaining({
        externalId: "c:comment-after-cutoff",
        postExternalId: "post-1",
        parentMatchContext: parentContext,
      }))
      expect(mocks.ingestMention).toHaveBeenCalledWith(expect.objectContaining({
        externalId: "c:comment-new-parent",
        postExternalId: "post-2",
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it("paginates Instagram comments and nested replies with durable parent context", async () => {
    const parentContext = {
      parentMentionId: "parent-instagram",
      matchedTerm: "brand",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    mocks.parentMatchContextsForComments.mockResolvedValue(new Map([["media-1", parentContext]]))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/ig-business-1/media")) {
        return jsonResponse({
          data: [{ id: "media-1", permalink: "https://instagram.com/p/media-1", timestamp: "2026-08-01T00:00:00Z" }],
        })
      }
      if (url.includes("/comment-1/replies")) {
        expect(url).not.toContain("access_token")
        return jsonResponse({ data: [{ id: "reply-2", text: "second reply", parent_id: "comment-1" }] })
      }
      if (url.includes("/media-1/comments") && url.includes("after=top-page-2")) {
        expect(url).not.toContain("access_token")
        return jsonResponse({ data: [{ id: "comment-2", text: "second top-level comment" }] })
      }
      if (url.includes("/media-1/comments")) {
        return jsonResponse({
          data: [{
            id: "comment-1",
            text: "first top-level comment",
            replies: {
              data: [{ id: "reply-1", text: "first reply" }],
              paging: {
                next: "https://graph.facebook.com/v21.0/comment-1/replies?after=reply-page-2&access_token=secret",
              },
            },
          }],
          paging: {
            next: "https://graph.facebook.com/v21.0/media-1/comments?after=top-page-2&access_token=secret",
          },
        })
      }
      if (url.includes("/ig-business-1/tags")) return jsonResponse({ data: [] })
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollInstagramAccount("account-1")

    expect(result).toMatchObject({
      ingested: 4,
      commentCoverage: {
        pages: 4,
        records: 4,
        replies: 2,
        capped: false,
        complete: true,
      },
    })
    expect(mocks.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "instagram",
      ["https://instagram.com/p/media-1"],
      ["media-1"],
    )
    expect(mocks.ingestMention).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "c:reply-1",
      sourceType: "reply",
      contentKind: "REPLY",
      postExternalId: "media-1",
      replyToExternalId: "comment-1",
      parentMatchContext: parentContext,
    }))
    expect(mocks.ingestMention).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "c:reply-2",
      contentKind: "REPLY",
      replyToExternalId: "comment-1",
    }))
  })

  it("reports partial coverage and keeps the watermark when pagination is unsafe", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/ig-business-1/media")) {
        return jsonResponse({ data: [{ id: "media-1", permalink: "https://instagram.com/p/media-1" }] })
      }
      if (url.includes("/media-1/comments")) {
        return jsonResponse({
          data: [{ id: "comment-1", text: "first comment" }],
          paging: { next: "https://attacker.example/comments?after=next&access_token=secret" },
        })
      }
      if (url.includes("/ig-business-1/tags")) return jsonResponse({ data: [] })
      return jsonResponse({}, 404)
    }))

    const result = await pollInstagramAccount("account-1")

    expect(result).toMatchObject({
      ingested: 1,
      error: "meta_comments_pagination_url_rejected",
      partialCoverage: true,
      commentCoverage: { capped: true, complete: false },
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("does not report complete coverage or advance the watermark after ingest failure", async () => {
    mocks.ingestMention.mockRejectedValueOnce(new Error("database unavailable"))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/ig-business-1/media")) {
        return jsonResponse({ data: [{ id: "media-1", permalink: "https://instagram.com/p/media-1" }] })
      }
      if (url.includes("/media-1/comments")) {
        return jsonResponse({ data: [{ id: "comment-1", text: "persist me" }] })
      }
      if (url.includes("/ig-business-1/tags")) return jsonResponse({ data: [] })
      return jsonResponse({}, 404)
    }))

    const result = await pollInstagramAccount("account-1")

    expect(result).toMatchObject({
      ingested: 0,
      error: "meta_comment_ingest_failed",
      partialCoverage: true,
      commentCoverage: { complete: false },
    })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.cursorUpsert).not.toHaveBeenCalled()
    expect(mocks.cursorDeleteMany).not.toHaveBeenCalled()
  })

  it("drains comment cursors before advancing a capped parent cursor", async () => {
    const cursorRows = installInMemoryCursorStore()
    const parentStarts: string[] = []
    const commentStarts: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/ig-business-1/media")) {
        parentStarts.push(url.searchParams.get("after") ?? "start")
        const after = url.searchParams.get("after")
        if (after === "parent-11") return jsonResponse({ data: [] })
        const page = after ? Number(after.replace("parent-", "")) : 1
        return jsonResponse({
          data: page === 1
            ? [{ id: "media-1", permalink: "https://instagram.com/p/media-1", timestamp: "2026-08-01T00:00:00Z" }]
            : [],
          paging: {
            next: `https://graph.facebook.com/v21.0/ig-business-1/media?after=parent-${page + 1}&access_token=provider-secret`,
          },
        })
      }
      if (url.pathname.endsWith("/media-1/comments")) {
        const after = url.searchParams.get("after")
        commentStarts.push(after ?? "start")
        const page = after ? Number(after.replace("comment-", "")) : 1
        return jsonResponse({
          data: [{ id: `comment-${page}`, text: `comment page ${page}` }],
          ...(page < 11 ? {
            paging: {
              next: `https://graph.facebook.com/v21.0/media-1/comments?after=comment-${page + 1}&access_token=provider-secret`,
            },
          } : {}),
        })
      }
      if (url.pathname.endsWith("/ig-business-1/tags")) return jsonResponse({ data: [] })
      return jsonResponse({}, 404)
    }))

    const first = await pollInstagramAccount("account-1")
    expect(first).toMatchObject({
      ingested: 10,
      error: "meta_comments_max_pages",
      partialCoverage: true,
    })
    expect(parentStarts[0]).toBe("start")
    expect(cursorRows.has("legacy:instagram:parents")).toBe(false)
    expect(cursorRows.get("legacy:instagram:top:media-1")).toContain("after=comment-11")
    expect(mocks.update).not.toHaveBeenCalled()

    const second = await pollInstagramAccount("account-1")
    expect(second).toMatchObject({
      ingested: 1,
      error: "meta_comments_max_pages",
      partialCoverage: true,
    })
    expect(parentStarts[10]).toBe("start")
    expect(commentStarts[10]).toBe("comment-11")
    expect(cursorRows.get("legacy:instagram:parents")).toContain("after=parent-11")
    expect(mocks.update).not.toHaveBeenCalled()

    const third = await pollInstagramAccount("account-1")
    expect(third).toMatchObject({ ingested: 0 })
    expect(third.error).toBeUndefined()
    expect(parentStarts.at(-1)).toBe("parent-11")
    expect(cursorRows.size).toBe(0)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.ingestMention).toHaveBeenCalledTimes(11)
    expect(Array.from(cursorRows.values()).join(" ")).not.toContain("provider-secret")
  })
})
