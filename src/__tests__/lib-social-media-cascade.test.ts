import { describe, expect, it } from "vitest"
import {
  extractMediaDescriptor,
  planMediaCascade,
  representativeFrameTimes,
} from "@/lib/social/media-cascade"

const disabledPolicy = {
  enabled: false,
  coverOcrEnabled: true,
  frameOcrEnabled: false,
  asrEnabled: false,
  multimodalEnabled: false,
  preferPlatformTranscript: true,
  maxFramesPerVideo: 8,
  frameCandidatePercent: 5,
  asrCandidatePercent: 1,
  multimodalCandidatePercent: 0.5,
}

describe("social media cascade", () => {
  it("extracts only explicit public media fields and strips tracking parameters", () => {
    const result = extractMediaDescriptor({
      videoUrl: "https://cdn.example/video.mp4?utm_source=test&id=7",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      frameUrls: ["https://cdn.example/frame-1.jpg", "http://127.0.0.1/private.jpg"],
      durationSeconds: 60,
      mediaType: "video",
    })
    expect(result).toMatchObject({
      mediaType: "VIDEO",
      canonicalMediaUrl: "https://cdn.example/video.mp4?id=7",
      durationMs: 60_000,
      frameUrls: ["https://cdn.example/frame-1.jpg"],
    })
    expect(extractMediaDescriptor({}, "https://example.com/post/1")).toMatchObject({ mediaType: "IMAGE" })
    expect(extractMediaDescriptor({ imageUrl: "http://169.254.169.254/latest" })).toBeNull()
  })

  it("allows a free platform transcript while every paid stage remains disabled", () => {
    const media = extractMediaDescriptor({
      videoUrl: "https://cdn.example/video.mp4",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      platformTranscript: "LeadDrive is mentioned",
      mediaType: "VIDEO",
    })!
    const plan = planMediaCascade(disabledPolicy, media, 0.9, "candidate-1")
    expect(plan.find(stage => stage.stage === "PLATFORM_TRANSCRIPT")?.enabled).toBe(true)
    expect(plan.filter(stage => stage.estimatedCostUsd > 0).every(stage => !stage.enabled)).toBe(true)
  })

  it("selects high-value frame and ASR stages but prefers a platform transcript", () => {
    const media = extractMediaDescriptor({
      videoUrl: "https://cdn.example/video.mp4",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      audioUrl: "https://cdn.example/audio.mp3",
      frameUrls: Array.from({ length: 10 }, (_, index) => `https://cdn.example/frame-${index}.jpg`),
      platformTranscript: "platform text",
      durationSeconds: 120,
      mediaType: "VIDEO",
    })!
    const plan = planMediaCascade({
      ...disabledPolicy,
      enabled: true,
      frameOcrEnabled: true,
      asrEnabled: true,
      multimodalEnabled: true,
    }, media, 0.99, "high-value")
    expect(plan.find(stage => stage.stage === "COVER_OCR")?.enabled).toBe(true)
    expect(plan.find(stage => stage.stage === "FRAME_OCR")).toMatchObject({ enabled: true, frameCount: 8 })
    expect(plan.find(stage => stage.stage === "ASR")?.enabled).toBe(false)
    expect(plan.find(stage => stage.stage === "MULTIMODAL")?.enabled).toBe(true)
  })

  it("returns representative timestamps without exceeding the requested count", () => {
    expect(representativeFrameTimes(60_000, 8)).toHaveLength(8)
    expect(representativeFrameTimes(1_000, 8)).toEqual([500])
    expect(representativeFrameTimes(undefined, 8)).toEqual([])
  })
})
