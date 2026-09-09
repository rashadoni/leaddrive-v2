import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-instagram-comment.json"
import missingFields from "./fixtures/bright-data-missing-critical-fields.json"
import {
  BRIGHT_DATA_INSTAGRAM_COMMENT_SCHEMA_VERSION,
  normalizeBrightDataInstagramComment,
} from "@/lib/social/bright-data-instagram-comment-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
  providerRecordToIngestInput,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T12:00:00.000Z"

describe("Bright Data Instagram comment normalizer", () => {
  it("preserves comment identity, parent linkage and engagement", () => {
    const comment = normalizeBrightDataInstagramComment(fixture, observedAt, "post-test-123")

    expect(comment).toMatchObject({
      recordType: "COMMENT",
      platform: "instagram",
      externalId: "comment-test-1",
      contentKind: "COMMENT",
      text: fixture.comment,
      postExternalId: "post-test-123",
      threadExternalId: "post-test-123",
      parentExternalId: null,
      parentPostUrl: fixture.post_url,
      depth: 0,
      likes: 4,
      replies: 2,
      author: {
        handle: "synthetic_user",
        profileUrl: fixture.comment_user_url,
      },
      provenance: {
        providerKey: "bright-data",
        adapterKey: "BRIGHT_DATA_INSTAGRAM_COMMENTS",
        schemaVersion: BRIGHT_DATA_INSTAGRAM_COMMENT_SCHEMA_VERSION,
      },
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
      postExternalId: "post-test-123",
      sourceMetadata: {
        authorProfileUrl: fixture.comment_user_url,
        commentLikes: 4,
        commentReplies: 2,
      },
    })
  })

  it("fails closed instead of inventing parent or comment identity", () => {
    expect(() => normalizeBrightDataInstagramComment(fixture, observedAt, ""))
      .toThrow("parent post ID is required")
    expect(() => normalizeBrightDataInstagramComment({ ...fixture, ...missingFields.instagramComment }, observedAt, "post-test-123"))
      .toThrow("comment ID is required")
    expect(() => normalizeBrightDataInstagramComment({ ...fixture, comment: null }, observedAt, "post-test-123"))
      .toThrow("comment text is required")
    expect(() => normalizeBrightDataInstagramComment({ ...fixture, post_url: null, url: "file:///tmp/post" }, observedAt, "post-test-123"))
      .toThrow("parent post URL is required")

    const negativeEngagement = normalizeBrightDataInstagramComment({
      ...fixture,
      likes_number: -1,
      replies_number: -2,
    }, observedAt, "post-test-123")
    expect(negativeEngagement).toMatchObject({ likes: null, replies: null })
  })

  it("rejects private parent URLs and does not trust private author URLs", () => {
    expect(() => normalizeBrightDataInstagramComment({
      ...fixture,
      post_url: "http://127.0.0.1/private-post",
      url: "http://169.254.169.254/private-post",
    }, observedAt, "post-test-123")).toThrow("parent post URL is required")

    const comment = normalizeBrightDataInstagramComment({
      ...fixture,
      comment_user: null,
      comment_user_url: "http://10.0.0.2/private-profile",
    }, observedAt, "post-test-123")
    expect(comment.author).toBeNull()
  })
})
