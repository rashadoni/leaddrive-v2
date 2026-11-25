import { describe, expect, it } from "vitest"
import { commentHasKeyword, matchCommentKeywordRule, readCommentKeywordRules, type CommentKeywordRule } from "@/lib/inbox/comment-keyword-model"
import { buildCommentsBoard, type CommentRow, type ReplyRow } from "@/lib/inbox/comments-board"
import { facebookCommentEvents } from "@/lib/social/facebook-comments"

/** Which comment carries a rule's word, and when the section calls a comment answered. */
describe("a rule's word in a comment", () => {
  it("is found whatever the case and with or without Azerbaijani letters", () => {
    for (const text of ["GECƏ", "gecə", "Gece", "GECE", "salam, gece!", "🙏 Gecə 🙏"]) {
      expect(commentHasKeyword(text, "GECƏ"), text).toBe(true)
    }
    expect(commentHasKeyword("TAPSIRIQ", "TAPŞIRIQ")).toBe(true)
    expect(commentHasKeyword("tapşırıq göndərin", "TAPŞIRIQ")).toBe(true)
    expect(commentHasKeyword("SAY", "say")).toBe(true)
  })

  it("is a whole word, not a part of another one", () => {
    expect(commentHasKeyword("gecələr işləyirsiniz?", "GECƏ")).toBe(false)
    expect(commentHasKeyword("sayt haradadır", "SAY")).toBe(false)
    expect(commentHasKeyword("🔥🔥", "SAY")).toBe(false)
  })

  // Owner 2026-11-25: reels ask to comment «+».
  it("takes a sign-only keyword such as «+» as a whole token", () => {
    for (const text of ["+", " + ", "+ maraqlıdır", "çox maraqlı +"]) expect(commentHasKeyword(text, "+"), text).toBe(true)
    for (const text of ["5+3", "a+", "++", "salam"]) expect(commentHasKeyword(text, "+"), text).toBe(false)
    expect(commentHasKeyword("++", "++")).toBe(true)
  })

  it("takes a phrase only in its own order", () => {
    expect(commentHasKeyword("mənə pulsuz sınaq lazımdır", "pulsuz sınaq")).toBe(true)
    expect(commentHasKeyword("sınaq pulsuz?", "pulsuz sınaq")).toBe(false)
  })

  it("prefers the page's own rule, and skips a rule that is off or another page's", () => {
    const rule = (id: string, extra: Partial<CommentKeywordRule> = {}): CommentKeywordRule =>
      ({ id, keyword: "GECƏ", message: id, channelConfigId: null, postId: null, postLabel: null, enabled: true, ...extra })
    const rules = [rule("all"), rule("page", { channelConfigId: "ig-1" }), rule("off", { keyword: "SAY", enabled: false }), rule("other", { keyword: "SAY", channelConfigId: "ig-2" })]
    expect(matchCommentKeywordRule(rules, "gece", "ig-1")?.id).toBe("page")
    expect(matchCommentKeywordRule(rules, "gece", "ig-3")?.id).toBe("all")
    expect(matchCommentKeywordRule(rules, "say", "ig-1")).toBeNull()
  })

  // Owner 2026-11-25: «каждая публикация может отличаться».
  it("takes a rule for one post before the page's and everyone's, and never under another post", () => {
    const rule = (id: string, extra: Partial<CommentKeywordRule> = {}): CommentKeywordRule =>
      ({ id, keyword: "+", message: id, channelConfigId: "ig-1", postId: null, postLabel: null, enabled: true, ...extra })
    const rules = [rule("all", { channelConfigId: null }), rule("page"), rule("reel-a", { postId: "111" }), rule("reel-b", { postId: "222" })]
    expect(matchCommentKeywordRule(rules, "+", "ig-1", "111")?.id).toBe("reel-a")
    expect(matchCommentKeywordRule(rules, "+", "ig-1", "222")?.id).toBe("reel-b")
    expect(matchCommentKeywordRule(rules, "+", "ig-1", "333")?.id).toBe("page")
    expect(matchCommentKeywordRule(rules, "+", "ig-1")?.id).toBe("page")
    expect(matchCommentKeywordRule(rules, "+", "ig-9", "111")?.id).toBe("all")
    expect(matchCommentKeywordRule([rule("reel-a", { postId: "111" })], "+", "ig-1", "333")).toBeNull()
  })

  it("drops stored rules it cannot trust rather than half-applying them", () => {
    expect(readCommentKeywordRules({ commentKeywordRules: [
      { id: "ok", keyword: " GECƏ ", message: "Salam" },
      { id: "", keyword: "x", message: "y" },
      { id: "no-message", keyword: "x", message: " " },
      { id: "long", keyword: "x".repeat(41), message: "y" },
      "junk",
    ] })).toEqual([{ id: "ok", keyword: "GECƏ", message: "Salam", channelConfigId: null, postId: null, postLabel: null, enabled: true }])
    expect(readCommentKeywordRules(null)).toEqual([])
  })
})

describe("the comments board", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 22, 10, minutes))
  const row = (id: string, mediaId: string, minutes: number, extra: Record<string, unknown> = {}): CommentRow => ({
    id, conversationId: `conv-${id}`, channelConfigId: "ig-1", from: `igsid-${id}`, body: `text ${id}`, createdAt: at(minutes),
    metadata: { igComment: { commentId: `c-${id}`, mediaId, mediaProductType: "REELS", username: id, caption: null, permalink: null, imageUrl: null, ...extra } },
  })
  const reply = (id: string, commentId: string, mode: string, status = "sent", extra: Record<string, unknown> = {}): ReplyRow => ({
    id, body: `answer ${id}`, status, createdAt: at(30), metadata: { igCommentReply: { commentId, mode }, ...extra },
  })
  const build = (comments: CommentRow[], replies: ReplyRow[] = []) => buildCommentsBoard({
    comments, replies, channelNames: new Map([["ig-1", "@leaddrive.az"]]), rules: [], now: at(60).getTime(),
  })

  it("groups by post, newest post and newest comment first", () => {
    const posts = build([row("a", "reel-1", 1), row("b", "reel-2", 5), row("c", "reel-1", 9)])
    expect(posts.map((p) => [p.key, p.total, p.comments.map((c) => c.id)])).toEqual([
      ["ig-1:reel-1", 2, ["c", "a"]],
      ["ig-1:reel-2", 1, ["b"]],
    ])
    expect(posts[0].channelName).toBe("@leaddrive.az")
  })

  it("takes the post's caption from whichever comment has it", () => {
    const posts = build([row("a", "reel-1", 9), row("b", "reel-1", 1, { caption: "GECƏ yazın", permalink: "https://www.instagram.com/reel/x/" })])
    expect(posts[0]).toMatchObject({ caption: "GECƏ yazın", permalink: "https://www.instagram.com/reel/x/" })
  })

  it("calls a comment answered by a delivered answer or a spent private reply, not by a failed send", () => {
    const posts = build(
      [row("public", "r", 1), row("failed", "r", 2), row("spent", "r", 3, { privateReplyAt: at(4).toISOString() }), row("waiting", "r", 5)],
      [reply("r1", "c-public", "public", "sent", { authorType: "operator", authorName: "Leyla" }), reply("r2", "c-failed", "private", "failed")],
    )
    const answered = Object.fromEntries(posts[0].comments.map((c) => [c.id, c.answered]))
    expect(answered).toEqual({ public: true, failed: false, spent: true, waiting: false })
    expect(posts[0].unanswered).toBe(2)
    expect(posts[0].comments.find((c) => c.id === "public")!.replies[0]).toMatchObject({ mode: "public", authorName: "Leyla", fromApp: false })
    expect(posts[0].comments.find((c) => c.id === "spent")!.privateReplyAvailable).toBe(false)
  })

  it("ignores a row that is not a comment", () => {
    expect(build([{ ...row("a", "r", 1), metadata: {} }])).toEqual([])
  })
})

describe("what a Page's `feed` webhook carries", () => {
  const entry = (value: Record<string, unknown>, field = "feed") => ({ id: "page", changes: [{ field, value }] })

  it("reads a comment directly under the post as having no parent", () => {
    const [event] = facebookCommentEvents(entry({
      item: "comment", verb: "add", comment_id: "c1", post_id: "page_1", parent_id: "page_1", message: "Salam",
      created_time: 1795412400, from: { id: "u1", name: "Fərid" }, post: { permalink_url: "https://www.facebook.com/x" },
    }))
    expect(event).toMatchObject({ commentId: "c1", postId: "page_1", parentId: null, fromId: "u1", fromName: "Fərid", text: "Salam", permalink: "https://www.facebook.com/x" })
    expect(event.commentedAt.toISOString()).toBe(new Date(1795412400 * 1000).toISOString())
  })

  it("keeps the parent of an answer to a comment, and takes a comment without an author", () => {
    const [event] = facebookCommentEvents(entry({ item: "comment", verb: "add", comment_id: "c2", post_id: "page_1", parent_id: "c1", message: "x" }))
    expect(event).toMatchObject({ parentId: "c1", fromId: null, fromName: null })
  })

  it("ignores posts, likes and other fields", () => {
    expect(facebookCommentEvents(entry({ item: "status", verb: "add", post_id: "p" }))).toEqual([])
    expect(facebookCommentEvents(entry({ item: "reaction", verb: "add", post_id: "p" }))).toEqual([])
    expect(facebookCommentEvents(entry({ item: "comment", comment_id: "c" }, "mention"))).toEqual([])
    expect(facebookCommentEvents({ id: "page", messaging: [{}] })).toEqual([])
  })
})
