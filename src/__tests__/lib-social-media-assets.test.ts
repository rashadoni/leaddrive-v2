import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  detectSocialMediaPlatform,
  getMediaProviderReadiness,
  resolveSocialMediaAssets,
} from "@/lib/social/social-media-assets"

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("social media asset resolution", () => {
  it("detects supported platform URLs without fetching user-controlled pages", () => {
    expect(detectSocialMediaPlatform("https://youtu.be/video-1")).toBe("youtube")
    expect(detectSocialMediaPlatform("https://www.tiktok.com/@brand/video/1")).toBe("tiktok")
    expect(detectSocialMediaPlatform("https://cdn.example/video.mp4")).toBe("direct")
    expect(detectSocialMediaPlatform("https://example.com/article/1")).toBe("unknown")
  })

  it("makes a direct video available to ASR without a local ffmpeg dependency", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(resolveSocialMediaAssets({ submittedUrl: "https://cdn.example/video.mp4" })).resolves.toMatchObject({
      status: "PARTIAL",
      platform: "direct",
      mediaType: "VIDEO",
      mediaUrl: "https://cdn.example/video.mp4",
      audioUrl: "https://cdn.example/video.mp4",
      provider: "direct-url",
      resolvedCapabilities: expect.arrayContaining(["DIRECT_MEDIA", "AUDIO_SOURCE"]),
      blockers: ["FRAME_EXTRACTION_PROVIDER_NOT_CONFIGURED"],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("resolves a YouTube cover through the free oEmbed endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("youtube.com/oembed")
      return new Response(JSON.stringify({
        title: "LeadDrive review",
        author_name: "Channel",
        thumbnail_url: "https://i.ytimg.com/vi/video-1/hqdefault.jpg",
      }), { status: 200 })
    }))

    await expect(resolveSocialMediaAssets({ submittedUrl: "https://www.youtube.com/watch?v=video-1" })).resolves.toMatchObject({
      status: "PARTIAL",
      platform: "youtube",
      title: "LeadDrive review",
      authorName: "Channel",
      thumbnailUrl: "https://i.ytimg.com/vi/video-1/hqdefault.jpg",
      provider: "youtube-oembed",
      resolvedCapabilities: expect.arrayContaining(["METADATA", "THUMBNAIL"]),
      blockers: expect.arrayContaining(["AUDIO_SOURCE_UNAVAILABLE"]),
    })
  })

  it("fails closed for Meta links until an official oEmbed token or resolver is configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(resolveSocialMediaAssets({ submittedUrl: "https://www.instagram.com/reel/example/" })).resolves.toMatchObject({
      status: "BLOCKED",
      platform: "instagram",
      blockers: expect.arrayContaining(["META_OEMBED_TOKEN_MISSING", "NO_PROCESSABLE_MEDIA_ASSET"]),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the lead actionable when a free oEmbed endpoint is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down") }))

    await expect(resolveSocialMediaAssets({ submittedUrl: "https://www.tiktok.com/@brand/video/1" })).resolves.toMatchObject({
      status: "BLOCKED",
      platform: "tiktok",
      blockers: expect.arrayContaining([expect.stringMatching(/^OEMBED_FAILED:/), "NO_PROCESSABLE_MEDIA_ASSET"]),
    })
  })

  it("merges an allowlisted external resolver response with validated media assets", async () => {
    vi.stubEnv("SOCIAL_MEDIA_ASSET_RESOLVER_ENDPOINT", "https://resolver.example/v1/resolve")
    vi.stubEnv("SOCIAL_MEDIA_ASSET_RESOLVER_ALLOWED_HOSTS", "resolver.example")
    vi.stubEnv("SOCIAL_MEDIA_ASSET_RESOLVER_TOKEN", "secret")
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret" })
      return new Response(JSON.stringify({
        title: "External video",
        mediaUrl: "https://cdn.example/video.mp4",
        thumbnailUrl: "https://cdn.example/cover.jpg",
        audioUrl: "https://cdn.example/audio.m4a",
        frameUrls: ["https://cdn.example/frame-1.jpg"],
        transcript: "LeadDrive is mentioned",
        durationSeconds: 30,
      }), { status: 200 })
    }))

    await expect(resolveSocialMediaAssets({ submittedUrl: "https://example.com/post/1" })).resolves.toMatchObject({
      status: "RESOLVED",
      provider: "external-asset-resolver",
      mediaUrl: "https://cdn.example/video.mp4",
      thumbnailUrl: "https://cdn.example/cover.jpg",
      audioUrl: "https://cdn.example/audio.m4a",
      frameUrls: ["https://cdn.example/frame-1.jpg"],
      platformTranscript: "LeadDrive is mentioned",
      durationMs: 30_000,
      blockers: [],
    })
  })

  it("reports provider readiness without exposing credentials", () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "vision-secret")
    vi.stubEnv("OPENAI_API_KEY", "openai-secret")
    expect(getMediaProviderReadiness()).toEqual(expect.objectContaining({
      ocrConfigured: true,
      asrConfigured: true,
      directMediaSupported: true,
      freeOembedPlatforms: ["youtube", "tiktok"],
    }))
    expect(JSON.stringify(getMediaProviderReadiness())).not.toContain("secret")
  })
})
