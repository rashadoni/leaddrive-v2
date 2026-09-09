import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-instagram-post.json"
import reelFixture from "./fixtures/bright-data-instagram-reel.json"
import missingFields from "./fixtures/bright-data-missing-critical-fields.json"
import {
  BRIGHT_DATA_INSTAGRAM_DISCOVERY_SCHEMA_VERSION,
  BRIGHT_DATA_INSTAGRAM_POST_SCHEMA_VERSION,
  BRIGHT_DATA_INSTAGRAM_REEL_SCHEMA_VERSION,
  normalizeBrightDataInstagramDiscoveryCandidate,
  normalizeBrightDataInstagramPost,
} from "@/lib/social/bright-data-instagram-post-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T12:00:00.000Z"

describe("Bright Data Instagram post normalizer", () => {
  it("keeps profile discovery output behind the candidate boundary", () => {
    const candidate = normalizeBrightDataInstagramDiscoveryCandidate(
      fixture,
      observedAt,
      "https://instagram.com/synthetic_brand",
    )

    expect(candidate).toMatchObject({
      recordType: "CANDIDATE",
      platform: "instagram",
      externalId: fixture.post_id,
      query: "https://instagram.com/synthetic_brand",
      provenance: {
        adapterKey: "BRIGHT_DATA_INSTAGRAM_DISCOVERY",
        schemaVersion: BRIGHT_DATA_INSTAGRAM_DISCOVERY_SCHEMA_VERSION,
      },
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "DISCOVER_URLS",
      records: [candidate],
    })
  })

  it("coalesces one vendor row into content, media and metric records", () => {
    const normalized = normalizeBrightDataInstagramPost(fixture, observedAt)

    expect(normalized.content).toMatchObject({
      recordType: "CONTENT",
      platform: "instagram",
      externalId: "post-test-123",
      contentKind: "VIDEO",
      canonicalUrl: "https://instagram.com/p/TEST123",
      text: fixture.description,
      author: {
        externalId: "user-test-1",
        handle: "synthetic_brand",
      },
      provenance: {
        providerKey: "bright-data",
        adapterKey: "BRIGHT_DATA_INSTAGRAM_POSTS",
        schemaVersion: BRIGHT_DATA_INSTAGRAM_POST_SCHEMA_VERSION,
      },
    })
    expect(normalized.media).toHaveLength(3)
    expect(normalized.media.map(record => record.mediaKind)).toEqual([
      "IMAGE",
      "VIDEO",
      "THUMBNAIL",
    ])
    expect(normalized.media[1]).toMatchObject({
      externalId: "media-test-2",
      durationSeconds: 12.5,
      thumbnailUrl: fixture.thumbnail,
    })
    expect(normalized.metric).toMatchObject({
      likes: 125,
      comments: 9,
      views: null,
      observedAt,
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

  it("fails closed when required live-schema fields drift", () => {
    expect(() => normalizeBrightDataInstagramPost({ ...fixture, ...missingFields.instagramPost }, observedAt))
      .toThrow("post ID is required")
    expect(() => normalizeBrightDataInstagramPost({ ...fixture, description: null }, observedAt))
      .toThrow("post text is required")
    expect(() => normalizeBrightDataInstagramPost({ ...fixture, url: "javascript:alert(1)" }, observedAt))
      .toThrow("post URL is required")
    expect(() => normalizeBrightDataInstagramDiscoveryCandidate(fixture, observedAt, ""))
      .toThrow("discovery query is required")
    expect(() => normalizeBrightDataInstagramDiscoveryCandidate({ ...fixture, post_id: null, content_id: null, shortcode: null }, observedAt, "profile"))
      .toThrow("discovery post ID is required")
  })

  it("maps the live Reel clips shape into video, cover, audio and metrics", () => {
    const normalized = normalizeBrightDataInstagramPost(reelFixture, observedAt)

    expect(normalized.content).toMatchObject({
      externalId: "reel-test-123",
      contentKind: "VIDEO",
      provenance: { schemaVersion: BRIGHT_DATA_INSTAGRAM_REEL_SCHEMA_VERSION },
    })
    expect(normalized.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaKind: "VIDEO",
        url: reelFixture.video_url,
        thumbnailUrl: reelFixture.thumbnail,
        durationSeconds: 46.79999923706055,
      }),
      expect.objectContaining({ mediaKind: "THUMBNAIL", url: reelFixture.thumbnail }),
      expect.objectContaining({ mediaKind: "AUDIO", url: reelFixture.audio_url }),
    ]))
    expect(normalized.metric).toMatchObject({
      likes: 240,
      comments: 17,
      views: null,
      provenance: { schemaVersion: BRIGHT_DATA_INSTAGRAM_REEL_SCHEMA_VERSION },
    })

    expect(normalizeBrightDataInstagramPost({ ...reelFixture, views: 4_321 }, observedAt).metric.views)
      .toBe(4_321)
  })

  it("drops private media, cover and audio URLs before downstream asset fetch", () => {
    const normalized = normalizeBrightDataInstagramPost({
      ...reelFixture,
      video_url: "http://127.0.0.1/private-video.mp4",
      thumbnail: "http://169.254.169.254/latest/meta-data",
      audio_url: "http://10.0.0.5/private-audio.mp4",
    }, observedAt)

    expect(normalized.content.contentKind).toBe("VIDEO")
    expect(normalized.media).toEqual([])
    expect(() => normalizeBrightDataInstagramPost({
      ...reelFixture,
      url: "http://127.0.0.1/private-post",
    }, observedAt)).toThrow("post URL is required")
  })
})
