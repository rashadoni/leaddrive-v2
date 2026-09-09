import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-tiktok-comment.json"
import replyFixture from "./fixtures/bright-data-tiktok-reply.json"
import missingFields from "./fixtures/bright-data-missing-critical-fields.json"
import {
  BRIGHT_DATA_TIKTOK_COMMENT_SCHEMA_VERSION,
  normalizeBrightDataTikTokComment,
  normalizeBrightDataTikTokCommentThread,
} from "@/lib/social/bright-data-tiktok-comment-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
  providerRecordToIngestInput,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T13:00:00.000Z"

describe("Bright Data TikTok comment normalizer", () => {
  it("preserves post identity, permalink, author and engagement", () => {
    const comment = normalizeBrightDataTikTokComment(fixture, observedAt, fixture.post_id)

    expect(comment).toMatchObject({
      recordType: "COMMENT",
      platform: "tiktok",
      externalId: "tiktok-comment-test-1",
      contentKind: "COMMENT",
      postExternalId: fixture.post_id,
      parentExternalId: null,
      threadExternalId: fixture.post_id,
      depth: 0,
      likes: 6,
      replies: 2,
      author: {
        externalId: "tiktok-user-test-1",
        handle: "synthetic_viewer",
        profileUrl: fixture.commenter_url,
      },
      provenance: { schemaVersion: BRIGHT_DATA_TIKTOK_COMMENT_SCHEMA_VERSION },
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "READ_COMMENTS",
      records: [comment],
    })
    expect(providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      acquisitionMode: "LICENSED_PROVIDER",
    }, comment)).toMatchObject({
      postExternalId: fixture.post_id,
      sourceMetadata: {
        authorProfileUrl: fixture.commenter_url,
        commentLikes: 6,
        commentReplies: 2,
      },
    })
  })

  it("maps a provider reply onto one supported nesting level", () => {
    const reply = normalizeBrightDataTikTokComment(replyFixture, observedAt, fixture.post_id)

    expect(reply).toMatchObject({
      contentKind: "REPLY",
      parentExternalId: "tiktok-comment-test-1",
      replyToExternalId: "tiktok-comment-test-1",
      depth: 1,
    })
  })

  it("expands embedded replies with canonical parent and thread identity", () => {
    const records = normalizeBrightDataTikTokCommentThread({
      ...fixture,
      replies: [{ reply_id: "tiktok-reply-nested-1", text: "Synthetic nested reply", reply_date: "2026-07-13T10:37:00.000Z", amount_of_likes: 3 }],
    }, observedAt, fixture.post_id)
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({
      externalId: "tiktok-reply-nested-1", contentKind: "REPLY", parentExternalId: fixture.comment_id,
      replyToExternalId: fixture.comment_id, threadExternalId: fixture.post_id, postExternalId: fixture.post_id,
      depth: 1, likes: 3, replies: 0, author: null,
    })
    expect(records[1].canonicalUrl).toBe(records[0].canonicalUrl)
  })

  it("fails closed on malformed embedded replies", () => {
    expect(() => normalizeBrightDataTikTokCommentThread({
      ...fixture, replies: [{ text: "missing identity" }],
    }, observedAt, fixture.post_id)).toThrow("reply ID is required")
  })

  it("fails closed on parent mismatch or missing critical fields", () => {
    expect(() => normalizeBrightDataTikTokComment(fixture, observedAt, "another-post"))
      .toThrow("parent post ID mismatch")
    expect(() => normalizeBrightDataTikTokComment({ ...fixture, ...missingFields.tiktokComment }, observedAt, fixture.post_id))
      .toThrow("comment post ID is required")
    expect(() => normalizeBrightDataTikTokComment({ ...fixture, comment_id: null }, observedAt, fixture.post_id))
      .toThrow("comment ID is required")
    expect(() => normalizeBrightDataTikTokComment({ ...fixture, comment_text: null }, observedAt, fixture.post_id))
      .toThrow("comment text is required")
  })

  it("rejects private parent URLs and falls back from a private comment URL", () => {
    expect(() => normalizeBrightDataTikTokComment({
      ...fixture,
      post_url: "http://127.0.0.1/private-post",
      url: "http://169.254.169.254/private-post",
    }, observedAt, fixture.post_id)).toThrow("parent post URL is required")

    const comment = normalizeBrightDataTikTokComment({
      ...fixture,
      comment_url: "http://172.16.0.2/private-comment",
      commenter_url: "http://172.16.0.3/private-profile",
    }, observedAt, fixture.post_id)
    expect(comment.url).toBeNull()
    expect(comment.canonicalUrl).toBe("https://tiktok.com/@synthetic_creator/video/7660000000000000001")
    expect(comment.author?.profileUrl).toBeNull()
  })
})
