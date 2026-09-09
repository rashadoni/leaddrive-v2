import { describe, expect, it } from "vitest"
import facebookComment from "./fixtures/bright-data-facebook-comment.json"
import facebookPost from "./fixtures/bright-data-facebook-post.json"
import instagramComment from "./fixtures/bright-data-instagram-comment.json"
import instagramPost from "./fixtures/bright-data-instagram-post.json"
import tiktokComment from "./fixtures/bright-data-tiktok-comment.json"
import tiktokPost from "./fixtures/bright-data-tiktok-post.json"
import { normalizeBrightDataProviderBatch } from "@/lib/social/bright-data-provider-normalizer"
import { validateProviderBatch } from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-14T02:30:00.000Z"

describe("Bright Data provider batch normalizer", () => {
  it.each([
    ["instagram", instagramPost],
    ["facebook", facebookPost],
    ["tiktok", tiktokPost],
  ] as const)("normalizes %s discovery and content batches", (platform, fixture) => {
    const discovery = normalizeBrightDataProviderBatch({
      platform,
      capability: "DISCOVER_URLS",
      rows: [fixture],
      observedAt,
      query: "synthetic brand",
    })
    const content = normalizeBrightDataProviderBatch({
      platform,
      capability: "ENRICH_CONTENT",
      rows: [fixture],
      observedAt,
    })

    expect(discovery.batch.records).toHaveLength(1)
    expect(discovery.batch.records[0]).toMatchObject({ recordType: "CANDIDATE", platform })
    expect(content.batch.records).toHaveLength(1)
    expect(content.batch.records[0]).toMatchObject({ recordType: "CONTENT", platform })
    expect(validateProviderBatch(discovery.batch)).toEqual({ valid: true, errors: [] })
    expect(validateProviderBatch(content.batch)).toEqual({ valid: true, errors: [] })
  })

  it.each([
    ["instagram", instagramPost],
    ["facebook", facebookPost],
    ["tiktok", tiktokPost],
  ] as const)("splits %s media and metrics into capability-specific batches", (platform, fixture) => {
    const media = normalizeBrightDataProviderBatch({
      platform,
      capability: "READ_MEDIA",
      rows: [fixture],
      observedAt,
    })
    const metrics = normalizeBrightDataProviderBatch({
      platform,
      capability: "UPDATE_METRICS",
      rows: [fixture],
      observedAt,
    })

    expect(media.batch.records.length).toBeGreaterThan(0)
    expect(media.batch.records.every(record => record.recordType === "MEDIA")).toBe(true)
    expect(metrics.batch.records).toHaveLength(1)
    expect(metrics.batch.records[0]).toMatchObject({ recordType: "METRIC", platform, observedAt })
    expect(validateProviderBatch(media.batch).valid).toBe(true)
    expect(validateProviderBatch(metrics.batch).valid).toBe(true)
  })

  it.each([
    ["instagram", instagramComment, "instagram-post-test-123"],
    ["facebook", facebookComment, "facebook-post-test-123"],
    ["tiktok", tiktokComment, "7660000000000000001"],
  ] as const)("links %s comments only through the enriched parent identity map", (platform, fixture, postExternalId) => {
    const postUrl = fixture.post_url
    const result = normalizeBrightDataProviderBatch({
      platform,
      capability: "READ_COMMENTS",
      rows: [fixture],
      observedAt,
      parentPostExternalIds: { [postUrl]: postExternalId },
    })

    expect(result.batch.records).toHaveLength(1)
    expect(result.batch.records[0]).toMatchObject({
      recordType: "COMMENT",
      platform,
      postExternalId,
    })
    expect(validateProviderBatch(result.batch).valid).toBe(true)
  })

  it("expands nested TikTok replies inside the approved parent batch", () => {
    const result = normalizeBrightDataProviderBatch({
      platform: "tiktok", capability: "READ_COMMENTS",
      rows: [{ ...tiktokComment, replies: [{ reply_id: "tiktok-reply-nested-1", text: "Synthetic nested reply", reply_date: "2026-07-13T10:37:00.000Z", amount_of_likes: 2 }] }],
      observedAt, parentPostExternalIds: { [tiktokComment.post_url]: "7660000000000000001" },
    })
    expect(result.batch.records).toHaveLength(2)
    expect(result.batch.records[1]).toMatchObject({ contentKind: "REPLY", parentExternalId: tiktokComment.comment_id, threadExternalId: tiktokComment.post_id })
    expect(validateProviderBatch(result.batch).valid).toBe(true)
  })

  it("falls back to post_id identity when the provider resolves the parent URL to a different form", () => {
    // Regression (prod 2026-07-20): Facebook pfbid post URLs get echoed back by
    // the comments dataset as resolved numeric /posts/<id> URLs, so the
    // canonical-URL parent lookup missed and the ENTIRE batch failed schema.
    const result = normalizeBrightDataProviderBatch({
      platform: "facebook",
      capability: "READ_COMMENTS",
      rows: [facebookComment],
      observedAt,
      parentPostExternalIds: {
        "https://www.facebook.com/example/posts/pfbid0COMPLETELYDIFFERENTURL/": facebookComment.post_id,
      },
    })

    expect(result.batch.records).toHaveLength(1)
    expect(result.batch.records[0]).toMatchObject({
      recordType: "COMMENT",
      platform: "facebook",
      postExternalId: facebookComment.post_id,
    })
    expect(result.drift.health).toBe("HEALTHY")
  })

  it("matches the parent by URL path token when the provider echoes a different URL form", () => {
    // Prod 2026-07-20: the comments dataset echoes post URLs with extra query
    // params / other hosts, so neither the canonical-URL nor the post_id lookup
    // hits. The path token (pfbid…/numeric id) still identifies the post.
    const result = normalizeBrightDataProviderBatch({
      platform: "facebook",
      capability: "READ_COMMENTS",
      rows: [{ ...facebookComment, post_id: "pfbid-other-representation", post_url: "https://m.facebook.com/example/posts/POST123?comment_id=42&__cft__=x" }],
      observedAt,
      parentPostExternalIds: { "https://www.facebook.com/example/posts/POST123/": "tracked-ext-9" },
    })

    expect(result.batch.records).toHaveLength(1)
    expect(result.batch.records[0]).toMatchObject({ recordType: "COMMENT", postExternalId: "tracked-ext-9" })
    expect(result.drift.health).toBe("HEALTHY")
  })

  it("uses the echoed input URL when Facebook resolves the row to video.php", () => {
    const trackedUrl = "https://www.facebook.com/example/posts/POST123/"
    const result = normalizeBrightDataProviderBatch({
      platform: "facebook",
      capability: "READ_COMMENTS",
      rows: [{
        ...facebookComment,
        post_id: "resolved-video-id",
        post_url: "https://www.facebook.com/video.php?v=resolved-video-id",
        url: "https://www.facebook.com/video.php?v=resolved-video-id",
        input: { url: trackedUrl, comments_sort: "Most relevant" },
      }],
      observedAt,
      parentPostExternalIds: { [trackedUrl]: "tracked-ext-input" },
    })

    expect(result.batch.records).toHaveLength(1)
    expect(result.batch.records[0]).toMatchObject({
      recordType: "COMMENT",
      postExternalId: "tracked-ext-input",
      parentPostUrl: trackedUrl,
    })
    expect(result.drift.health).toBe("HEALTHY")
  })

  it("still rejects a comment whose post_id is not a tracked parent even with the fallback", () => {
    const result = normalizeBrightDataProviderBatch({
      platform: "facebook",
      capability: "READ_COMMENTS",
      rows: [facebookComment],
      observedAt,
      parentPostExternalIds: {
        "https://www.facebook.com/example/posts/pfbid0COMPLETELYDIFFERENTURL/": "some-other-post-id",
      },
    })

    expect(result.batch.records).toEqual([])
    expect(result.drift.health).toBe("FAILED")
  })

  it("does not trust a provider row when the parent identity was not enriched", () => {
    const result = normalizeBrightDataProviderBatch({
      platform: "facebook",
      capability: "READ_COMMENTS",
      rows: [facebookComment],
      observedAt,
    })

    expect(result.batch.records).toEqual([])
    expect(result.drift).toMatchObject({
      health: "FAILED",
      validCount: 0,
      invalidCount: 1,
      failureCodes: { missing_required_field: 1 },
    })
  })

  it("returns TRUE_ZERO for an empty provider result without inventing records", () => {
    const result = normalizeBrightDataProviderBatch({
      platform: "instagram",
      capability: "ENRICH_CONTENT",
      rows: [],
      observedAt,
    })

    expect(result.batch.records).toEqual([])
    expect(result.drift.health).toBe("TRUE_ZERO")
    expect(validateProviderBatch(result.batch).valid).toBe(true)
  })

  it("redacts malformed/provider-error rows into aggregate drift warnings", () => {
    const result = normalizeBrightDataProviderBatch({
      platform: "tiktok",
      capability: "ENRICH_CONTENT",
      rows: [
        tiktokPost,
        { ...tiktokPost, description: null },
        { error_code: "dead_page", error: "Bearer secret-token" },
      ],
      observedAt,
    })

    expect(result.batch.records).toHaveLength(1)
    expect(result.drift).toMatchObject({
      health: "DEGRADED",
      validCount: 1,
      invalidCount: 2,
      providerErrorCount: 1,
      failureCodes: {
        missing_text: 1,
        "provider_error:dead_page": 1,
      },
    })
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  it("rejects invalid observation timestamps even for true-zero batches", () => {
    expect(() => normalizeBrightDataProviderBatch({
      platform: "instagram",
      capability: "ENRICH_CONTENT",
      rows: [],
      observedAt: "not-a-date",
    })).toThrow("observedAt must be an ISO date")
  })
})
