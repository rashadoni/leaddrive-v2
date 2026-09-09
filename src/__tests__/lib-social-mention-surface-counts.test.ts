import { describe, expect, it } from "vitest"
import { combineMentionAndReviewSurfaceCounts, mentionSurfaceCounts } from "@/lib/social/mention-surface-counts"

describe("social mention surface counts", () => {
  it("uses the API's disjoint surface counts when available", () => {
    expect(mentionSurfaceCounts({ post: 65 }, 53, {
      all: 65,
      posts: 12,
      comments: 0,
      media: 53,
      unknown: 0,
    })).toEqual({
      all: 65,
      posts: 12,
      comments: 0,
      media: 53,
      unknown: 0,
    })
  })

  it("adds posts, comments, and media into All even when media overlaps posts", () => {
    expect(mentionSurfaceCounts({ post: 65 }, 53)).toEqual({
      all: 118,
      posts: 65,
      comments: 0,
      media: 53,
      unknown: 0,
    })
  })

  it("includes mention and reply aliases in their parent segments", () => {
    expect(mentionSurfaceCounts({ post: 4, mention: 2, comment: 3, reply: 1 }, 5)).toEqual({
      all: 15,
      posts: 6,
      comments: 4,
      media: 5,
      unknown: 0,
    })
  })

  it("defaults missing aggregates to zero", () => {
    expect(mentionSurfaceCounts(undefined, undefined)).toEqual({
      all: 0,
      posts: 0,
      comments: 0,
      media: 0,
      unknown: 0,
    })
  })

  it("adds the full review queue to all surface counters without hiding unknown findings", () => {
    expect(combineMentionAndReviewSurfaceCounts(
      { all: 8, posts: 3, comments: 0, media: 3, unknown: 2 },
      { all: 461, posts: 120, comments: 9, media: 3, unknown: 329 },
    )).toEqual({
      all: 469,
      posts: 123,
      comments: 9,
      media: 6,
      unknown: 331,
    })
  })
})
