import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-facebook-comment.json"
import replyFixture from "./fixtures/bright-data-facebook-reply.json"
import missingFields from "./fixtures/bright-data-missing-critical-fields.json"
import {
  BRIGHT_DATA_FACEBOOK_COMMENT_SCHEMA_VERSION,
  normalizeBrightDataFacebookComment,
} from "@/lib/social/bright-data-facebook-comment-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
  providerRecordToIngestInput,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T13:00:00.000Z"

describe("Bright Data Facebook comment normalizer", () => {
  it("preserves top-level comment identity, parent and engagement", () => {
    const comment = normalizeBrightDataFacebookComment(
      fixture,
      observedAt,
      "facebook-post-test-123",
    )

    expect(comment).toMatchObject({
      recordType: "COMMENT",
      platform: "facebook",
      externalId: "facebook-comment-test-1",
      contentKind: "COMMENT",
      postExternalId: "facebook-post-test-123",
      parentExternalId: null,
      threadExternalId: "facebook-post-test-123",
      depth: 0,
      likes: 7,
      replies: 3,
      author: {
        externalId: "facebook-user-test-1",
        name: "Synthetic User",
        profileUrl: fixture.commentator_profile_url,
      },
      provenance: { schemaVersion: BRIGHT_DATA_FACEBOOK_COMMENT_SCHEMA_VERSION },
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
      postExternalId: "facebook-post-test-123",
      sourceMetadata: {
        authorProfileUrl: fixture.commentator_profile_url,
        commentLikes: 7,
        commentReplies: 3,
      },
    })
  })

  it("maps reply linkage without inventing deeper nesting", () => {
    const reply = normalizeBrightDataFacebookComment(replyFixture, observedAt, "facebook-post-test-123")

    expect(reply).toMatchObject({
      contentKind: "REPLY",
      parentExternalId: "facebook-comment-test-1",
      replyToExternalId: "facebook-comment-test-1",
      depth: 1,
    })
  })

  it("keys the record by the resolved tracked parent identity and fails closed on missing critical fields", () => {
    // The shared layer resolves the parent from the row's own URL/id against
    // the tracked-post index; a differing provider post_id representation
    // (pfbid vs numeric) must not fail the row — the resolved identity wins.
    expect(normalizeBrightDataFacebookComment(fixture, observedAt, "resolved-tracked-post"))
      .toMatchObject({ postExternalId: "resolved-tracked-post" })
    expect(() => normalizeBrightDataFacebookComment({ ...fixture, comment_id: null }, observedAt, "facebook-post-test-123"))
      .toThrow("comment ID is required")
    expect(() => normalizeBrightDataFacebookComment({ ...fixture, ...missingFields.facebookComment }, observedAt, "facebook-post-test-123"))
      .toThrow("comment text is required")
    expect(() => normalizeBrightDataFacebookComment({ ...replyFixture, ...missingFields.facebookReply }, observedAt, "facebook-post-test-123"))
      .toThrow("reply parent comment ID is required")
  })

  it("rejects private parent URLs and drops private optional permalinks", () => {
    expect(() => normalizeBrightDataFacebookComment({
      ...fixture,
      input: { url: "http://127.0.0.1/private-input" },
      post_url: "http://127.0.0.1/private-post",
      url: "http://169.254.169.254/private-post",
    }, observedAt, "facebook-post-test-123")).toThrow("parent post URL is required")

    const comment = normalizeBrightDataFacebookComment({
      ...fixture,
      comment_link: "http://10.0.0.2/private-comment",
      commentator_profile_url: "http://10.0.0.3/private-profile",
    }, observedAt, "facebook-post-test-123")
    expect(comment.url).toBeNull()
    expect(comment.canonicalUrl).toBeNull()
    expect(comment.author?.profileUrl).toBeNull()
  })
})
