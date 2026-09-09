import { describe, expect, it } from "vitest"
import fixture from "./fixtures/bright-data-tiktok-post.json"
import {
  BRIGHT_DATA_TIKTOK_DISCOVERY_SCHEMA_VERSION,
  BRIGHT_DATA_TIKTOK_POST_SCHEMA_VERSION,
  normalizeBrightDataTikTokDiscoveryCandidate,
  normalizeBrightDataTikTokPost,
} from "@/lib/social/bright-data-tiktok-post-normalizer"
import {
  PROVIDER_CONTRACT_VERSION,
  assertValidProviderBatch,
} from "@/lib/social/provider-capability-contract"

const observedAt = "2026-07-13T13:00:00.000Z"

describe("Bright Data TikTok post normalizer", () => {
  it("keeps discovery as a candidate before enrichment", () => {
    const candidate = normalizeBrightDataTikTokDiscoveryCandidate(fixture, observedAt, "synthetic query")

    expect(candidate).toMatchObject({
      recordType: "CANDIDATE",
      platform: "tiktok",
      externalId: fixture.post_id,
      query: "synthetic query",
      provenance: { schemaVersion: BRIGHT_DATA_TIKTOK_DISCOVERY_SCHEMA_VERSION },
    })
    assertValidProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "DISCOVER_URLS",
      records: [candidate],
    })
  })

  it("coalesces video, cover, audio, author and metrics from one post row", () => {
    const normalized = normalizeBrightDataTikTokPost(fixture, observedAt)

    expect(normalized.content).toMatchObject({
      recordType: "CONTENT",
      platform: "tiktok",
      externalId: fixture.post_id,
      contentKind: "VIDEO",
      text: fixture.description,
      author: {
        externalId: "tiktok-profile-test-1",
        handle: "synthetic_creator",
      },
      provenance: { schemaVersion: BRIGHT_DATA_TIKTOK_POST_SCHEMA_VERSION },
    })
    expect(normalized.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaKind: "VIDEO",
        url: fixture.video_url,
        thumbnailUrl: fixture.preview_image,
        durationSeconds: 37,
        width: 576,
      }),
      expect.objectContaining({ mediaKind: "THUMBNAIL", url: fixture.preview_image }),
      expect.objectContaining({ mediaKind: "AUDIO", url: fixture.music.playurl }),
    ]))
    expect(normalized.metric).toMatchObject({
      views: 4500,
      likes: 321,
      comments: 18,
      shares: 24,
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

  it("fails closed when discovery identity or enriched text is missing", () => {
    expect(() => normalizeBrightDataTikTokDiscoveryCandidate({ ...fixture, post_id: null, shortcode: null }, observedAt, "query"))
      .toThrow("post ID is required")
    expect(() => normalizeBrightDataTikTokPost({ ...fixture, description: null }, observedAt))
      .toThrow("post text is required")
  })

  it("drops private video, cover and audio URLs before downstream asset fetch", () => {
    const normalized = normalizeBrightDataTikTokPost({
      ...fixture,
      video_url: "http://127.0.0.1/private-video.mp4",
      preview_image: "http://169.254.169.254/private-cover.jpg",
      music: { id: "private-audio", playurl: "http://172.16.0.2/private-audio.mp3" },
    }, observedAt)

    expect(normalized.content.contentKind).toBe("VIDEO")
    expect(normalized.media).toEqual([])
    expect(() => normalizeBrightDataTikTokPost({
      ...fixture,
      url: "http://127.0.0.1/private-post",
    }, observedAt)).toThrow("post URL is required")
  })
})
