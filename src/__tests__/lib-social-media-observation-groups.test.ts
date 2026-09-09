import { describe, expect, it } from "vitest"
import { groupMediaDashboardObservations, type GroupableMediaObservation } from "@/lib/social/media-observation-groups"

function observation(overrides: Partial<GroupableMediaObservation> = {}): GroupableMediaObservation {
  return {
    id: "observation-1",
    mentionId: "mention-1",
    discoveryLeadId: null,
    mediaType: "IMAGE",
    status: "COMPLETE",
    sourceUrl: "https://cdn.example.com/cover.jpg",
    canonicalMediaUrl: "https://cdn.example.com/cover.jpg",
    thumbnailUrl: "https://cdn.example.com/cover.jpg",
    audioUrl: null,
    platformTranscript: null,
    durationMs: null,
    language: null,
    relevanceScore: 0.6,
    signals: [],
    runs: [],
    ...overrides,
  }
}

describe("media dashboard post grouping", () => {
  it("collapses cover, video and blocked audio rows into one post card", () => {
    const grouped = groupMediaDashboardObservations([
      observation({ id: "cover", signals: [{ id: "signal-cover" }] }),
      observation({
        id: "video",
        mediaType: "VIDEO",
        status: "PARTIAL",
        sourceUrl: "https://cdn.example.com/video.mp4",
        canonicalMediaUrl: "https://cdn.example.com/video.mp4",
        durationMs: 90_000,
        platformTranscript: "Araz Supermarket endirimləri",
        signals: [{ id: "signal-video" }],
      }),
      observation({
        id: "audio",
        mediaType: "AUDIO",
        status: "BLOCKED",
        sourceUrl: "https://cdn.example.com/audio.mp3",
        canonicalMediaUrl: "https://cdn.example.com/audio.mp3",
        thumbnailUrl: null,
      }),
    ])

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      id: "video",
      assetCount: 3,
      mediaTypes: ["AUDIO", "IMAGE", "VIDEO"],
      thumbnailUrl: "https://cdn.example.com/cover.jpg",
      platformTranscript: "Araz Supermarket endirimləri",
    })
    expect(grouped[0].signals.map(signal => signal.id)).toEqual(["signal-cover", "signal-video"])
  })

  it("keeps different source posts separate", () => {
    const grouped = groupMediaDashboardObservations([
      observation({ id: "first", mentionId: "mention-1" }),
      observation({ id: "second", mentionId: "mention-2" }),
    ])
    expect(grouped.map(item => item.id)).toEqual(["first", "second"])
  })

  it("collapses a multi-image carousel from one mention", () => {
    const grouped = groupMediaDashboardObservations([
      observation({ id: "image-1", canonicalMediaUrl: "https://cdn.example.com/1.jpg" }),
      observation({ id: "image-2", canonicalMediaUrl: "https://cdn.example.com/2.jpg" }),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].assetCount).toBe(2)
  })
})
