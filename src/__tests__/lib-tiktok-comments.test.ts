/**
 * Comments under owned TikTok videos: what we read from TikTok, what is worth a row, and how the
 * board shows it.
 *
 * The point of the section is that TikTok direct messages are shut — the platform stopped issuing
 * the Business Messaging permission — so the two rules that make TikTok different from Instagram and
 * Facebook are checked here: a comment is never «answerable in Direct», and a keyword rule, whose
 * whole job is to write privately, is not offered against it.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildTikTokPosts, type TikTokCommentRow } from "@/lib/inbox/comments-board"
import { mergeOwnerReply, worthStoring } from "@/lib/inbox/tiktok-comment-ingest"
import { storedTikTokReplies, type StoredTikTokReply } from "@/lib/inbox/tiktok-comment-reply"
import { commentTime, listOwnedVideos, parseComment, replyToVideoComment, type TikTokComment } from "@/lib/social/tiktok-comment-api"

vi.mock("@/lib/social/tiktok-business-token", () => ({
  businessAccessToken: vi.fn(async () => ({ token: "tok", error: null })),
}))

const comment = (over: Partial<TikTokComment> = {}): TikTokComment => ({
  commentId: "c1",
  parentId: null,
  username: "aysel",
  displayName: "Aysel",
  text: "Qiyməti neçədir?",
  createdAt: new Date("2026-11-26T10:00:00Z"),
  likes: 0,
  owner: false,
  replies: [],
  ...over,
})

const row = (over: Partial<TikTokCommentRow> = {}): TikTokCommentRow => ({
  id: "row-1",
  socialAccountId: "acc-1",
  accountName: "Gobustone",
  commentId: "c1",
  videoId: "v1",
  parentId: null,
  username: "aysel",
  displayName: "Aysel",
  body: "Qiyməti neçədir?",
  commentedAt: new Date("2026-11-26T10:00:00Z"),
  caption: "Yeni kolleksiya",
  permalink: "https://www.tiktok.com/@brand/video/1",
  replies: [],
  ...over,
})

describe("what TikTok sends", () => {
  it("reads a comment, its author and the moment it was written", () => {
    const parsed = parseComment({
      comment_id: "c9", parent_comment_id: "c1", username: "aysel", display_name: "Aysel",
      text: "Salam", create_time: 1795687200, likes: 3, owner: false,
      reply_list: [{ comment_id: "c10", text: "Salam!", owner: true, create_time: "1795687260" }],
    })
    expect(parsed).toMatchObject({ commentId: "c9", parentId: "c1", username: "aysel", likes: 3, owner: false })
    expect(parsed!.createdAt.toISOString()).toBe("2026-11-26T10:00:00.000Z")
    // A reply the account itself wrote is carried along; the ingest files it as an answer.
    expect(parsed!.replies[0]).toMatchObject({ commentId: "c10", owner: true })
  })

  it("keeps a comment whose time is unreadable, because «when» is only its place in the list", () => {
    const now = Date.parse("2026-11-26T12:00:00Z")
    expect(commentTime(undefined, now).toISOString()).toBe("2026-11-26T12:00:00.000Z")
    expect(commentTime(0, now).toISOString()).toBe("2026-11-26T12:00:00.000Z")
    expect(commentTime("1795687200", now).toISOString()).toBe("2026-11-26T10:00:00.000Z")
    // Without a comment id there is nothing to answer, so there is no row either.
    expect(parseComment({ text: "no id" })).toBeNull()
  })
})

describe("what is worth a row", () => {
  it("stores a customer's words and skips our own and the noise", () => {
    expect(worthStoring(comment())).toBe(true)
    // The account's own comment is an answer, not a question.
    expect(worthStoring(comment({ owner: true }))).toBe(false)
    expect(worthStoring(comment({ text: "   " }))).toBe(false)
    // Only @names and emojis: hundreds of these under a giveaway.
    expect(worthStoring(comment({ text: "@leyla @nigar 🔥🔥" }))).toBe(false)
    expect(worthStoring(comment({ text: "@leyla var?" }))).toBe(true)
  })
})

describe("our own answer meeting itself on the next poll", () => {
  const stored = (over: Partial<StoredTikTokReply> = {}): StoredTikTokReply =>
    ({ id: "local:1", text: "Salam, yazın zəhmət olmasa", at: "2026-11-26T10:05:00.000Z", authorName: "Nigar", fromApp: false, ...over })

  it("claims the local copy instead of showing the same answer twice", () => {
    const merged = mergeOwnerReply([stored()], { id: "tt-77", text: "Salam, yazın zəhmət olmasa", at: "2026-11-26T10:06:00.000Z", authorName: null, fromApp: true })
    expect(merged).toHaveLength(1)
    // TikTok's id wins, but the person who pressed «Ответить» keeps the credit.
    expect(merged![0]).toMatchObject({ id: "tt-77", authorName: "Nigar", fromApp: false })
  })

  it("adds an answer typed in the TikTok app, and ignores one already stored", () => {
    const fromApp = { id: "tt-80", text: "Sabah açığıq", at: "2026-11-26T11:00:00.000Z", authorName: null, fromApp: true }
    expect(mergeOwnerReply([stored()], fromApp)).toHaveLength(2)
    expect(mergeOwnerReply([stored(), fromApp], fromApp)).toBeNull()
  })

  it("reads only what looks like an answer", () => {
    expect(storedTikTokReplies([{ id: "a", text: "hi", at: "2026-11-26T10:00:00.000Z" }])).toHaveLength(1)
    expect(storedTikTokReplies([{ id: 5, text: "hi", at: "x" }, null, "nope"])).toEqual([])
    expect(storedTikTokReplies("not a list")).toEqual([])
  })
})

describe("TikTok posts on the board", () => {
  it("groups a video's comments and names the post by the account", () => {
    const posts = buildTikTokPosts({ comments: [
      row({ id: "r1", commentId: "c1", commentedAt: new Date("2026-11-26T10:00:00Z") }),
      row({ id: "r2", commentId: "c2", body: "Çatdırılma var?", commentedAt: new Date("2026-11-26T11:00:00Z"), username: null, displayName: "Leyla" }),
      row({ id: "r3", commentId: "c3", videoId: "v2", caption: "İkinci video", commentedAt: new Date("2026-11-26T09:00:00Z") }),
    ] })

    expect(posts.map((p) => p.key)).toEqual(["tiktok:acc-1:v1", "tiktok:acc-1:v2"])
    const [first] = posts
    expect(first).toMatchObject({ platform: "tiktok", channelName: "Gobustone", channelConfigId: null, isReel: true, total: 2, unanswered: 2 })
    // Newest comment first, and a nameless author is shown by whatever TikTok gave.
    expect(first.comments.map((c) => c.author)).toEqual(["Leyla", "@aysel"])
  })

  it("never offers a private answer and never promises a keyword message", () => {
    const [post] = buildTikTokPosts({ comments: [row()] })
    const [only] = post.comments
    // Both are the same fact: TikTok direct messages need a permission we do not have.
    expect(only.privateReplyAvailable).toBe(false)
    expect(only.conversationId).toBeNull()
    expect(only.keyword).toBeNull()
  })

  it("counts a comment as answered once an answer is stored under it", () => {
    const answered = row({ replies: [{ id: "tt-9", text: "Salam", at: "2026-11-26T10:30:00.000Z", authorName: "Nigar", fromApp: false }] })
    const [post] = buildTikTokPosts({ comments: [answered] })
    expect(post).toMatchObject({ total: 1, unanswered: 0 })
    expect(post.comments[0].answered).toBe(true)
    expect(post.comments[0].replies[0]).toMatchObject({ mode: "public", authorName: "Nigar", keyword: null })
  })
})

describe("talking to TikTok", () => {
  const account = { id: "acc-1", accessToken: "enc", tokenExpiresAt: null }
  afterEach(() => { vi.unstubAllGlobals() })

  it("asks for the account's videos with the account's own token", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, json: async () => ({ code: 0, data: { videos: [
      { item_id: "v1", caption: "Yeni", share_url: "https://tiktok.com/@b/video/1", comments: 4 },
      { caption: "no id" },
    ] } }) }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await listOwnedVideos({ account, businessId: "open-1", limit: 10 })

    expect(result.ok && result.data).toEqual([{ videoId: "v1", caption: "Yeni", shareUrl: "https://tiktok.com/@b/video/1", commentCount: 4 }])
    const url = new URL(fetchMock.mock.calls[0][0] as unknown as string)
    expect(url.pathname).toBe("/open_api/v1.3/business/video/list/")
    expect(url.searchParams.get("business_id")).toBe("open-1")
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["Access-Token"]).toBe("tok")
  })

  it("posts a reply under the video and keeps TikTok's refusal in TikTok's words", async () => {
    const ok = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, json: async () => ({ code: 0, data: { comment_id: "tt-100" } }) }))
    vi.stubGlobal("fetch", ok)
    const sent = await replyToVideoComment({ account, businessId: "open-1", videoId: "v1", commentId: "c1", text: "Salam" })
    expect(sent).toEqual({ ok: true, data: { commentId: "tt-100" } })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).pathname).toBe("/open_api/v1.3/business/comment/reply/create/")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ business_id: "open-1", video_id: "v1", comment_id: "c1", text: "Salam" })

    // TikTok answers 200 with its own code; «not eligible» must not read as «sent».
    const refused = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, json: async () => ({ code: 40002, message: "User is not eligible for the Advanced Access tier" }) }))
    vi.stubGlobal("fetch", refused)
    const failed = await replyToVideoComment({ account, businessId: "open-1", videoId: "v1", commentId: "c1", text: "Salam" })
    expect(failed).toEqual({ ok: false, code: 40002, message: "User is not eligible for the Advanced Access tier" })
  })
})
