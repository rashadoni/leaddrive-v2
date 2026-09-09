import { describe, expect, it } from "vitest"
import { detectSocialPlatformFromUrl, detectSocialSourceTypeFromUrl } from "@/lib/social/url-detect"

describe("detectSocialPlatformFromUrl", () => {
  it("detects platforms from host (with and without www)", () => {
    expect(detectSocialPlatformFromUrl("https://www.instagram.com/xeber_azerbaycan/")).toBe("instagram")
    expect(detectSocialPlatformFromUrl("https://facebook.com/patrul.az")).toBe("facebook")
    expect(detectSocialPlatformFromUrl("https://fb.com/some.page")).toBe("facebook")
    expect(detectSocialPlatformFromUrl("https://www.tiktok.com/@brand")).toBe("tiktok")
    expect(detectSocialPlatformFromUrl("https://x.com/brand")).toBe("twitter")
    expect(detectSocialPlatformFromUrl("https://twitter.com/brand")).toBe("twitter")
    expect(detectSocialPlatformFromUrl("https://youtu.be/abc123")).toBe("youtube")
  })

  it("returns null for unrecognised or invalid urls", () => {
    expect(detectSocialPlatformFromUrl("https://example.com/page")).toBeNull()
    expect(detectSocialPlatformFromUrl("not a url")).toBeNull()
    expect(detectSocialPlatformFromUrl("")).toBeNull()
  })
})

describe("detectSocialSourceTypeFromUrl", () => {
  it("classifies profile/page links as profile", () => {
    expect(detectSocialSourceTypeFromUrl("https://instagram.com/xeber_azerbaycan/")).toBe("profile")
    expect(detectSocialSourceTypeFromUrl("https://facebook.com/patrul.az")).toBe("profile")
    expect(detectSocialSourceTypeFromUrl("https://tiktok.com/@brand")).toBe("profile")
  })

  it("classifies specific post/video links as search_url", () => {
    expect(detectSocialSourceTypeFromUrl("https://instagram.com/p/ABC123/")).toBe("search_url")
    expect(detectSocialSourceTypeFromUrl("https://instagram.com/reel/XYZ/")).toBe("search_url")
    expect(detectSocialSourceTypeFromUrl("https://facebook.com/patrul.az/posts/123")).toBe("search_url")
    expect(detectSocialSourceTypeFromUrl("https://www.youtube.com/watch?v=abc")).toBe("search_url")
    expect(detectSocialSourceTypeFromUrl("https://youtu.be/abc123")).toBe("search_url")
    expect(detectSocialSourceTypeFromUrl("https://x.com/brand/status/999")).toBe("search_url")
  })
})
