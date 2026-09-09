import { describe, expect, it, vi } from "vitest"
import { classifyMetaGraphHttpFailure, collectMetaGraphCommentThreads, collectMetaGraphConnection } from "@/lib/social/meta-graph-pagination"

describe("Meta Graph connection pagination", () => {
  it("keeps ambiguous HTTP 400 auth errors retryable and classifies only proven cursor/target failures", () => {
    const paged = "https://graph.facebook.com/v21.0/post/comments?after=expired"
    expect(classifyMetaGraphHttpFailure(400, paged, JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }))).toBe("retryable")
    expect(classifyMetaGraphHttpFailure(400, paged, JSON.stringify({ error: { code: 100, message: "Invalid paging cursor" } }))).toBe("invalid_cursor")
    expect(classifyMetaGraphHttpFailure(400, paged, JSON.stringify({ error: { code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID does not exist or cannot be loaded" } }))).toBe("retryable_target")
    expect(classifyMetaGraphHttpFailure(400, "https://graph.facebook.com/v21.0/post/comments", JSON.stringify({ error: { message: "Comments are disabled" } }))).toBe("terminal_target")
    expect(classifyMetaGraphHttpFailure(400, paged, JSON.stringify({ error: { message: "Comments are disabled" } }))).toBe("terminal_target")
    expect(classifyMetaGraphHttpFailure(404, "https://graph.facebook.com/v21.0/deleted/comments", "not found")).toBe("terminal_target")
    expect(classifyMetaGraphHttpFailure(500, paged, "server error")).toBe("retryable")
  })

  it("walks paging links without trusting echoed credentials", async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes("after=page-2")) {
        expect(url).not.toContain("access_token")
        expect(url).not.toContain("untrusted-proof")
        expect(new URL(url).searchParams.get("appsecret_proof")).toBe("trusted-proof")
        return { ok: true as const, data: { data: [{ id: "comment-2" }] } }
      }
      return {
        ok: true as const,
        data: {
          data: [{ id: "comment-1" }],
          paging: {
            next: "https://graph.facebook.com/v21.0/post/comments?after=page-2&access_token=secret&appsecret_proof=untrusted-proof",
          },
        },
      }
    })

    const result = await collectMetaGraphConnection<{ id: string }>({
      graphBaseUrl: "https://graph.facebook.com/v21.0",
      appSecretProof: "trusted-proof",
      initialUrl: "https://graph.facebook.com/v21.0/post/comments",
      fetchPage,
      maxPages: 5,
      maxItems: 10,
    })

    expect(result).toEqual({
      items: [{ id: "comment-1" }, { id: "comment-2" }],
      pages: 2,
      capped: false,
      error: null,
      resumeUrl: null,
    })
  })

  it("reports item caps and rejects cross-origin pagination", async () => {
    const capped = await collectMetaGraphConnection<{ id: string }>({
      graphBaseUrl: "https://graph.facebook.com/v21.0",
      appSecretProof: null,
      initialPage: {
        data: [{ id: "one" }, { id: "two" }],
        paging: { next: "https://graph.facebook.com/v21.0/comments?after=next" },
      },
      fetchPage: vi.fn(),
      maxPages: 5,
      maxItems: 1,
    })
    expect(capped).toMatchObject({ pages: 1, capped: true, error: "meta_comments_max_items" })
    expect(capped.items).toEqual([{ id: "one" }, { id: "two" }])
    expect(capped.resumeUrl).toBe("https://graph.facebook.com/v21.0/comments?after=next")

    const rejected = await collectMetaGraphConnection<{ id: string }>({
      graphBaseUrl: "https://graph.facebook.com/v21.0",
      appSecretProof: null,
      initialPage: {
        data: [{ id: "one" }],
        paging: { next: "https://attacker.example/comments?after=next" },
      },
      fetchPage: vi.fn(),
      maxPages: 5,
      maxItems: 10,
    })
    expect(rejected).toMatchObject({ pages: 1, capped: true, error: "meta_comments_pagination_url_rejected" })
  })

  it("reserves page and item capacity for replies after collecting top-level comments first", async () => {
    type Target = { id: string }
    type Comment = { id: string; replies?: { data?: Comment[] } }
    const fetchPage = vi.fn(async (url: string) => {
      const targetId = url.includes("post-b") ? "b" : "a"
      return {
        ok: true as const,
        data: {
          data: [{
            id: `comment-${targetId}`,
            replies: { data: [{ id: `reply-${targetId}` }] },
          }],
        },
      }
    })

    const result = await collectMetaGraphCommentThreads<Target, Comment>({
      targets: [{ id: "post-a" }, { id: "post-b" }],
      initialUrl: target => `https://graph.facebook.com/v21.0/${target.id}/comments`,
      graphBaseUrl: "https://graph.facebook.com/v21.0",
      appSecretProof: null,
      fetchPage,
      embeddedReplies: comment => comment.replies,
      itemId: comment => comment.id,
      maxPages: 4,
      maxPagesPerConnection: 1,
      maxItems: 4,
    })

    expect(result.records.map(record => record.item.id)).toEqual([
      "comment-a",
      "comment-b",
      "reply-a",
      "reply-b",
    ])
    expect(result.records.slice(0, 2).every(record => record.replyToExternalId === null)).toBe(true)
    expect(result.pages).toBe(4)
  })

  it("can skip a completed embedded reply connection without consuming retry capacity", async () => {
    type Target = { id: string }
    type Comment = { id: string; replies?: { data?: Comment[] } }
    const result = await collectMetaGraphCommentThreads<Target, Comment>({
      targets: [{ id: "post-a" }],
      initialUrl: () => "https://graph.facebook.com/v21.0/post-a/comments",
      graphBaseUrl: "https://graph.facebook.com/v21.0",
      appSecretProof: null,
      fetchPage: vi.fn(async () => ({
        ok: true as const,
        data: {
          data: [
            { id: "comment-done", replies: { data: [{ id: "old-reply" }] } },
            { id: "comment-pending", replies: { data: [{ id: "new-reply" }] } },
          ],
        },
      })),
      embeddedReplies: comment => comment.id === "comment-done" ? null : comment.replies,
      itemId: comment => comment.id,
      maxPages: 4,
      maxPagesPerConnection: 1,
      maxItems: 6,
    })

    expect(result.records.map(record => record.item.id)).toEqual([
      "comment-done",
      "comment-pending",
      "new-reply",
    ])
    expect(result.replyResults).toHaveLength(1)
    expect(result.replyResults[0]?.item.id).toBe("comment-pending")
  })
})
