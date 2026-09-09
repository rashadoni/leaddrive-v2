import { describe, expect, it } from "vitest"
import { providerMediaDescriptor } from "@/lib/social/media-observations"
import type { ProviderMediaRecord } from "@/lib/social/provider-capability-contract"

function record(overrides: Partial<ProviderMediaRecord> = {}): ProviderMediaRecord {
  return {
    recordType: "MEDIA",
    platform: "instagram",
    externalId: "media-1",
    parentExternalId: "post-1",
    parentUrl: "https://instagram.com/p/ONE",
    mediaKind: "VIDEO",
    url: "https://cdn.example/video.mp4",
    thumbnailUrl: "https://cdn.example/cover.jpg",
    durationSeconds: 12.5,
    provenance: {
      providerKey: "bright-data",
      adapterKey: "BRIGHT_DATA_INSTAGRAM_POSTS",
      providerItemId: "media-1",
      observedAt: "2026-07-14T00:00:00.000Z",
      schemaVersion: "fixture-v1",
    },
    ...overrides,
  }
}

describe("provider media persistence descriptor", () => {
  it("maps provider video metadata into the guarded media pipeline", () => {
    expect(providerMediaDescriptor(record())).toMatchObject({
      mediaType: "VIDEO",
      sourceUrl: "https://cdn.example/video.mp4",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      durationMs: 12_500,
    })
  })

  it("treats covers as images and rejects private media URLs", () => {
    expect(providerMediaDescriptor(record({
      mediaKind: "THUMBNAIL",
      url: "https://cdn.example/cover.jpg",
      thumbnailUrl: null,
    }))).toMatchObject({ mediaType: "IMAGE" })
    expect(providerMediaDescriptor(record({ url: "http://127.0.0.1/private.jpg" }))).toBeNull()
  })
})
