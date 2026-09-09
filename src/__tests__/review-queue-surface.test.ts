import { describe, expect, it } from "vitest"
import {
  knownReviewQueueContentKinds,
  reviewQueueContentKindsForSurface,
  reviewQueueSurfaceCounts,
  reviewQueueSurfaceForEnvelope,
  reviewQueueSurfaceForContentKind,
  reviewQueueSurfaceWhere,
} from "@/lib/social/review-queue-surface"

describe("review queue surface classification", () => {
  it("classifies only real content kinds and leaves untyped discovery explicit", () => {
    expect(reviewQueueSurfaceForContentKind("POST")).toBe("posts")
    expect(reviewQueueSurfaceForContentKind("MENTION")).toBe("posts")
    expect(reviewQueueSurfaceForContentKind("COMMENT")).toBe("comments")
    expect(reviewQueueSurfaceForContentKind("REPLY")).toBe("comments")
    expect(reviewQueueSurfaceForContentKind("VIDEO")).toBe("media")
    expect(reviewQueueSurfaceForContentKind("UNKNOWN")).toBe("unknown")
    expect(reviewQueueSurfaceForContentKind("REVIEW")).toBe("unknown")
    expect(reviewQueueSurfaceForContentKind("POST", "youtube")).toBe("media")
    expect(reviewQueueSurfaceForContentKind("POST", "tiktok")).toBe("media")
    expect(reviewQueueSurfaceForContentKind("POST", "facebook")).toBe("posts")
  })

  it("keeps legacy YouTube and TikTok video rows out of Posts", () => {
    expect(reviewQueueSurfaceCounts([
      { platform: "youtube", contentKind: "POST", _count: 2 },
      { platform: "tiktok", contentKind: "POST", _count: 3 },
      { platform: "facebook", contentKind: "POST", _count: 4 },
    ])).toMatchObject({ all: 9, posts: 4, media: 5 })
    expect(reviewQueueSurfaceWhere("posts")).toMatchObject({
      AND: expect.arrayContaining([
        { contentKind: { in: ["POST", "MENTION"] } },
        expect.objectContaining({ NOT: expect.any(Object) }),
      ]),
    })
  })

  it("uses Facebook and Instagram URL evidence for legacy media rows", () => {
    expect(reviewQueueSurfaceForEnvelope({
      platform: "facebook",
      contentKind: "POST",
      url: "https://facebook.com/brand/videos/123",
    })).toBe("media")
    expect(reviewQueueSurfaceForEnvelope({
      platform: "instagram",
      contentKind: "POST",
      canonicalUrl: "https://instagram.com/brand/reel/123",
    })).toBe("media")
    expect(reviewQueueSurfaceWhere("media")).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({
                  platform: { in: ["facebook", "instagram", "FACEBOOK", "INSTAGRAM"] },
                }),
              ]),
            }),
          ]),
        }),
      ]),
    })
  })

  it("returns disjoint queue totals including unknown findings", () => {
    expect(reviewQueueSurfaceCounts([
      { contentKind: "POST", _count: 120 },
      { contentKind: "COMMENT", _count: 9 },
      { contentKind: "VIDEO", _count: 3 },
      { contentKind: "UNKNOWN", _count: 329 },
    ])).toEqual({
      all: 461,
      posts: 120,
      comments: 9,
      media: 3,
      unknown: 329,
    })
  })

  it("provides server filter allow-lists without treating unknown as a made-up type", () => {
    expect(reviewQueueContentKindsForSurface("posts")).toEqual(["POST", "MENTION"])
    expect(reviewQueueContentKindsForSurface("comments")).toEqual(["COMMENT", "REPLY"])
    expect(reviewQueueContentKindsForSurface("media")).toEqual(["VIDEO", "IMAGE", "AUDIO"])
    expect(reviewQueueContentKindsForSurface("unknown")).toBeNull()
    expect(knownReviewQueueContentKinds()).not.toContain("UNKNOWN")
  })
})
