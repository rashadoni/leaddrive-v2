import { beforeEach, describe, expect, it, vi } from "vitest"

import { youtubeReplyPublisher } from "@/lib/social/publishers/youtube"

const input = {
  externalId: "reply-comment-id",
  sourceType: "reply",
  sourceMetadata: { topLevelCommentId: "top-level-id", youtubeCanReply: true },
  replyText: "Thanks for your feedback",
  senderAccount: {
    id: "youtube-account",
    platform: "youtube",
    handle: "UCbrand",
    displayName: "Brand Channel",
    accessToken: "access-token::refresh-token",
    // Заведомо далёкий срок — публикатор сверяется с реальным «сейчас»,
    // и фикстура с близкой датой протухала в день её наступления.
    tokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("YouTube reply publisher", () => {
  it("replies to the top-level thread parent with youtube.force-ssl OAuth", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access-token", "Content-Type": "application/json" })
      expect(JSON.parse(String(init?.body))).toEqual({
        snippet: { parentId: "top-level-id", textOriginal: "Thanks for your feedback" },
      })
      return new Response(JSON.stringify({ id: "youtube-reply-id" }), { status: 200 })
    }))

    await expect(youtubeReplyPublisher.publishReply(input)).resolves.toEqual({ ok: true, externalReplyId: "youtube-reply-id" })
  })

  it("treats permission and canReply failures as definite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { errors: [{ reason: "operationNotSupported" }] },
    }), { status: 400 })))

    await expect(youtubeReplyPublisher.publishReply(input)).resolves.toEqual({
      ok: false,
      error: "operationNotSupported",
      retriable: false,
    })
  })
})
