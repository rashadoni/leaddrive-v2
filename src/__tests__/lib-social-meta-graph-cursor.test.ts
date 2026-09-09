import { describe, expect, it } from "vitest"
import {
  META_GRAPH_CURSOR_COMPLETE,
  applyMetaGraphQuarantines,
  metaGraphReplyCursorKey,
  metaGraphStoredTargets,
  metaGraphTargetCursorKey,
  metaGraphTopCursorKey,
  planMetaGraphCommentCursorUpdates,
} from "@/lib/social/meta-graph-cursor"
import type { MetaGraphThreadResult } from "@/lib/social/meta-graph-pagination"

type Target = { id: string }
type Comment = { id: string; replies?: { data?: Comment[]; paging?: { next?: string } } }

function emptyThreadResult(overrides: Partial<MetaGraphThreadResult<Target, Comment>> = {}): MetaGraphThreadResult<Target, Comment> {
  return {
    records: [],
    topLevelResults: [],
    replyResults: [],
    pages: 0,
    replies: 0,
    capped: false,
    error: null,
    attemptedTargets: 0,
    ...overrides,
  }
}

const prefix = "source:source-1:facebook:"
const initialCursor = (target: Target) => `https://graph.facebook.com/v21.0/${target.id}/comments`
const initialReplyCursor = (comment: Comment) => `https://graph.facebook.com/v21.0/${comment.id}/comments`

describe("Meta Graph durable comment cursor planning", () => {
  it("rotates to the first untouched parent after a capped run", () => {
    const first = { id: "post-a" }
    const second = { id: "post-b" }
    const result = emptyThreadResult({
      topLevelResults: [{
        target: first,
        result: { items: [], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      attemptedTargets: 1,
      capped: true,
      error: "meta_comments_max_items",
    })

    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [first, second],
      orderedActiveTargets: [first, second],
      existing: new Map(),
      result,
      targetId: target => target.id,
      itemId: comment => comment.id,
      embeddedReplies: comment => comment.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.updates.get(metaGraphTopCursorKey(prefix, "post-a"))).toBe(META_GRAPH_CURSOR_COMPLETE)
    expect(plan.updates.get(metaGraphTopCursorKey(prefix, "post-b"))).toBe(initialCursor(second))
    expect(plan.allTargetsComplete).toBe(false)
    expect(plan.nextRotationTargetId).toBe("post-b")
  })

  it("holds a top-level page until its paginated replies are complete", () => {
    const target = { id: "post-a" }
    const comment = {
      id: "comment-a",
      replies: {
        data: [{ id: "reply-a" }],
        paging: { next: "https://graph.facebook.com/v21.0/comment-a/comments?after=2" },
      },
    }
    const replyResume = "https://graph.facebook.com/v21.0/comment-a/comments?after=3"
    const result = emptyThreadResult({
      topLevelResults: [{
        target,
        result: { items: [comment], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      replyResults: [{
        target,
        item: comment,
        result: {
          items: [{ id: "reply-b" }],
          pages: 1,
          capped: true,
          error: "meta_comments_max_pages",
          resumeUrl: replyResume,
        },
      }],
      pages: 2,
      replies: 2,
    })

    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map(),
      result,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(initialCursor(target))
    expect(plan.updates.get(metaGraphReplyCursorKey(prefix, target.id, comment.id))).toBe(replyResume)
    expect(plan.allTargetsComplete).toBe(false)
  })

  it("advances the top page when an earlier reply connection is already complete", () => {
    const target = { id: "post-a" }
    const comment = { id: "comment-a", replies: { data: [{ id: "reply-a" }] } }
    const topResume = "https://graph.facebook.com/v21.0/post-a/comments?after=2"
    const replyKey = metaGraphReplyCursorKey(prefix, target.id, comment.id)
    const result = emptyThreadResult({
      topLevelResults: [{
        target,
        result: {
          items: [comment],
          pages: 1,
          capped: true,
          error: "meta_comments_max_pages",
          resumeUrl: topResume,
        },
      }],
      pages: 1,
    })

    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map([[replyKey, META_GRAPH_CURSOR_COMPLETE]]),
      result,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(topResume)
    expect(plan.updates.get(replyKey)).toBeNull()
    expect(plan.allTargetsComplete).toBe(false)
  })

  it("completes a persisted reply even when its top comment shifted off the current page", () => {
    const target = { id: "post-a" }
    const shiftedComment = { id: "comment-old" }
    const currentComment = { id: "comment-new" }
    const replyKey = metaGraphReplyCursorKey(prefix, target.id, shiftedComment.id)
    const topKey = metaGraphTopCursorKey(prefix, target.id)
    const result = emptyThreadResult({
      topLevelResults: [{
        target,
        result: { items: [currentComment], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      replyResults: [{
        target,
        item: shiftedComment,
        result: { items: [{ id: "reply-final" }], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      pages: 2,
      replies: 1,
    })

    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map([
        [topKey, initialCursor(target)],
        [replyKey, "https://graph.facebook.com/v21.0/comment-old/comments?after=2"],
      ]),
      result,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.updates.get(topKey)).toBe(META_GRAPH_CURSOR_COMPLETE)
    expect(plan.updates.get(replyKey)).toBeNull()
    expect(plan.allTargetsComplete).toBe(true)
  })

  it("resets one invalid paging cursor, then quarantines a repeated invalid target", () => {
    const target = { id: "post-a" }
    const staleCursor = "https://graph.facebook.com/v21.0/post-a/comments?after=expired"
    const failedResult = emptyThreadResult({
      topLevelResults: [{
        target,
        result: {
          items: [],
          pages: 0,
          capped: false,
          error: "meta_comments_fetch_failed_400",
          resumeUrl: staleCursor,
          failureClass: "invalid_cursor",
        },
      }],
      error: "meta_comments_fetch_failed_400",
    })
    const first = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map([[metaGraphTopCursorKey(prefix, target.id), staleCursor]]),
      result: failedResult,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })
    expect(first.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(initialCursor(target))
    expect(first.invalidCursorResets).toBe(1)
    expect(first.terminalTargetIds).toEqual([])

    const resetKey = `${prefix}reset:top:${encodeURIComponent(target.id)}`
    const second = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map([
        [metaGraphTopCursorKey(prefix, target.id), initialCursor(target)],
        [resetKey, "1"],
      ]),
      result: failedResult,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })
    expect(second.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(META_GRAPH_CURSOR_COMPLETE)
    expect(second.terminalTargetIds).toEqual([target.id])
    expect(second.allTargetsComplete).toBe(true)
  })

  it("quarantines a terminal reply branch without blocking its parent target", () => {
    const target = { id: "post-a" }
    const comment = { id: "comment-a", replies: { data: [{ id: "old-reply" }] } }
    const result = emptyThreadResult({
      topLevelResults: [{
        target,
        result: { items: [comment], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      replyResults: [{
        target,
        item: comment,
        result: {
          items: [],
          pages: 0,
          capped: false,
          error: "meta_comments_fetch_failed_404",
          resumeUrl: initialReplyCursor(comment),
          failureClass: "terminal_target",
        },
      }],
      error: "meta_comments_fetch_failed_404",
    })
    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map(),
      result,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.terminalReplyIds).toEqual([comment.id])
    expect(plan.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(META_GRAPH_CURSOR_COMPLETE)
    expect(plan.allTargetsComplete).toBe(true)
  })

  it("persists a bounded-retry reply page so live top-level reordering cannot strand it", () => {
    const target = { id: "post-a" }
    const comment = { id: "comment-a", replies: { data: [{ id: "reply-before-failure" }] } }
    const failedReplyPage = "https://graph.facebook.com/v21.0/comment-a/comments?after=failed-page"
    const result = emptyThreadResult({
      topLevelResults: [{
        target,
        result: { items: [comment], pages: 1, capped: false, error: null, resumeUrl: null },
      }],
      replyResults: [{
        target,
        item: comment,
        result: {
          items: [{ id: "reply-before-failure" }],
          pages: 1,
          capped: false,
          error: "meta_comments_fetch_failed_400",
          resumeUrl: failedReplyPage,
          failureClass: "retryable_target",
        },
      }],
      error: "meta_comments_fetch_failed_400",
    })

    const plan = planMetaGraphCommentCursorUpdates({
      cursorPrefix: prefix,
      allTargets: [target],
      orderedActiveTargets: [target],
      existing: new Map(),
      result,
      targetId: value => value.id,
      itemId: value => value.id,
      embeddedReplies: value => value.replies,
      initialTopLevelCursor: initialCursor,
      initialReplyCursor,
    })

    expect(plan.updates.get(metaGraphReplyCursorKey(prefix, target.id, comment.id))).toBe(failedReplyPage)
    expect(plan.updates.get(`${prefix}retry:reply:${encodeURIComponent(target.id)}:${encodeURIComponent(comment.id)}`)).toBe("1")
    expect(plan.updates.get(metaGraphTopCursorKey(prefix, target.id))).toBe(initialCursor(target))
    expect(plan.allTargetsComplete).toBe(false)
  })

  it("reopens expired target and reply quarantines for a cooldown re-probe", () => {
    const targetId = "post-a"
    const itemId = "comment-a"
    const targetQuarantineKey = `${prefix}quarantine:target:${encodeURIComponent(targetId)}`
    const replyQuarantineKey = `${prefix}quarantine:reply:${encodeURIComponent(targetId)}:${encodeURIComponent(itemId)}`
    const expired = JSON.stringify({
      error: "ambiguous_object",
      retryAfter: "2000-01-01T00:00:00.000Z",
    })
    const effective = applyMetaGraphQuarantines(new Map([
      [metaGraphTopCursorKey(prefix, targetId), META_GRAPH_CURSOR_COMPLETE],
      [metaGraphReplyCursorKey(prefix, targetId, itemId), META_GRAPH_CURSOR_COMPLETE],
      [targetQuarantineKey, expired],
      [replyQuarantineKey, expired],
    ]), prefix)

    expect(effective.has(metaGraphTopCursorKey(prefix, targetId))).toBe(false)
    expect(effective.has(metaGraphReplyCursorKey(prefix, targetId, itemId))).toBe(false)
    expect(effective.get(metaGraphTargetCursorKey(prefix, targetId))).toBe(JSON.stringify({ url: null }))
    expect(metaGraphStoredTargets(effective, prefix)).toEqual([{ id: targetId, url: null }])
  })
})
