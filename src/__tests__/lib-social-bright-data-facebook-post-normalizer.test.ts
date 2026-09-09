import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-facebook-post.json"
import {
  BRIGHT_DATA_FACEBOOK_DISCOVERY_SCHEMA_VERSION,
  BRIGHT_DATA_FACEBOOK_POST_SCHEMA_VERSION,
  normalizeBrightDataFacebookDiscoveryCandidate,
  normalizeBrightDataFacebookPost,
} from "@/lib/social/bright-data-facebook-post-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T13:00:00.000Z"

describe("Bright Data Facebook post normalizer", () => {
  it("keeps page-post discovery output behind the candidate boundary", () => {
    const candidate = normalizeBrightDataFacebookDiscoveryCandidate(
      fixture,
      observedAt,
      "https://facebook.com/synthetic-page",
    )

    expect(candidate).toMatchObject({
      recordType: "CANDIDATE",
      platform: "facebook",
      externalId: fixture.post_id,
      query: "https://facebook.com/synthetic-page",
      provenance: {
        adapterKey: "BRIGHT_DATA_FACEBOOK_DISCOVERY",
        schemaVersion: BRIGHT_DATA_FACEBOOK_DISCOVERY_SCHEMA_VERSION,
      },
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "DISCOVER_URLS",
      records: [candidate],
    })
  })

  it("coalesces content, video, audio, cover and metrics from one post row", () => {
    const normalized = normalizeBrightDataFacebookPost(fixture, observedAt)

    expect(normalized.content).toMatchObject({
      recordType: "CONTENT",
      platform: "facebook",
      externalId: "facebook-post-test-123",
      contentKind: "VIDEO",
      text: fixture.content,
      author: {
        externalId: "facebook-profile-test-1",
        name: "Synthetic Page",
        handle: "synthetic_page",
      },
      provenance: { schemaVersion: BRIGHT_DATA_FACEBOOK_POST_SCHEMA_VERSION },
    })
    expect(normalized.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaKind: "VIDEO",
        url: "https://cdn.example.test/facebook-video.mp4",
        thumbnailUrl: "https://cdn.example.test/facebook-video-cover.jpg",
        durationSeconds: 125.767,
      }),
      expect.objectContaining({
        mediaKind: "AUDIO",
        url: "https://cdn.example.test/facebook-audio.mp4",
        mimeType: "audio/mp4",
      }),
      expect.objectContaining({
        mediaKind: "THUMBNAIL",
        url: fixture.post_image,
      }),
    ]))
    expect(normalized.metric).toMatchObject({
      views: 2400,
      likes: 238,
      comments: 14,
      shares: 9,
    })

    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "ENRICH_CONTENT",
      records: [normalized.content],
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "READ_MEDIA",
      records: normalized.media,
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "UPDATE_METRICS",
      records: [normalized.metric],
    })
  })

  it("fails closed for media-only rows until OCR or ASR provides text", () => {
    expect(() => normalizeBrightDataFacebookPost({ ...fixture, content: null, video_title: null }, observedAt))
      .toThrow("post text is required")
    expect(() => normalizeBrightDataFacebookDiscoveryCandidate(fixture, observedAt, ""))
      .toThrow("discovery query is required")
    expect(() => normalizeBrightDataFacebookDiscoveryCandidate({ ...fixture, post_id: null, shortcode: null }, observedAt, "page"))
      .toThrow("discovery post ID is required")
  })

  it("drops private attachment and cover URLs before downstream asset fetch", () => {
    const normalized = normalizeBrightDataFacebookPost({
      ...fixture,
      attachments: [{
        id: "private-video",
        type: "video",
        video_url: "http://192.168.1.5/private-video.mp4",
        thumbnail_url: "http://169.254.169.254/private-cover.jpg",
      }],
      post_image: "http://10.0.0.2/private-post-cover.jpg",
    }, observedAt)

    expect(normalized.content.contentKind).toBe("VIDEO")
    expect(normalized.media).toEqual([])
    expect(() => normalizeBrightDataFacebookPost({
      ...fixture,
      url: "http://127.0.0.1/private-post",
    }, observedAt)).toThrow("post URL is required")
  })

  it("classifies Facebook content from the actual attachment type", () => {
    const image = normalizeBrightDataFacebookPost({
      ...fixture,
      post_type: "photo",
      post_image: "https://cdn.example.test/facebook-photo.jpg",
      attachments: [{
        id: "photo-1",
        type: "photo",
        attachment_url: "https://cdn.example.test/facebook-photo.jpg",
      }],
    }, observedAt)
    const audio = normalizeBrightDataFacebookPost({
      ...fixture,
      post_type: "audio",
      post_image: null,
      attachments: [{
        id: "audio-1",
        type: "audio",
        attachment_url: "https://cdn.example.test/facebook-audio.mp3",
      }],
    }, observedAt)
    const text = normalizeBrightDataFacebookPost({
      ...fixture,
      post_type: "status",
      post_image: null,
      attachments: [],
    }, observedAt)

    expect(image.content.contentKind).toBe("IMAGE")
    expect(audio.content.contentKind).toBe("AUDIO")
    expect(text.content.contentKind).toBe("POST")
  })
})
