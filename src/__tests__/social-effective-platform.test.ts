import { describe, expect, it } from "vitest"
import {
  effectiveMonitoringPlatform,
  effectiveMonitoringPlatformWhere,
  monitoringPlatformFromUrl,
  normalizeMonitoringPlatform,
} from "@/lib/social/effective-platform"

describe("effective monitoring platform", () => {
  it("normalizes stored aliases without inventing an unrelated platform", () => {
    expect(normalizeMonitoringPlatform("WEB")).toBe("web")
    expect(normalizeMonitoringPlatform("X")).toBe("twitter")
    expect(normalizeMonitoringPlatform("VK")).toBe("vkontakte")
    expect(normalizeMonitoringPlatform("custom-network")).toBe("custom-network")
  })

  it("recognizes every supported social destination by hostname", () => {
    expect(monitoringPlatformFromUrl("https://www.facebook.com/acme/posts/1")).toBe("facebook")
    expect(monitoringPlatformFromUrl("https://instagram.com/acme/p/one")).toBe("instagram")
    expect(monitoringPlatformFromUrl("https://www.tiktok.com/@acme/video/1")).toBe("tiktok")
    expect(monitoringPlatformFromUrl("https://youtu.be/abc")).toBe("youtube")
    expect(monitoringPlatformFromUrl("https://x.com/acme/status/1")).toBe("twitter")
    expect(monitoringPlatformFromUrl("https://t.me/acme/1")).toBe("telegram")
    expect(monitoringPlatformFromUrl("https://vk.com/wall-1_2")).toBe("vkontakte")
    expect(monitoringPlatformFromUrl("https://example.com/facebook.com/story")).toBeNull()
  })

  it("uses the result destination instead of a WEB acquisition label", () => {
    expect(effectiveMonitoringPlatform({
      platform: "WEB",
      url: "https://www.facebook.com/baku.ess/posts/123",
    })).toBe("facebook")
    expect(effectiveMonitoringPlatform({
      platform: "WEB",
      canonicalUrl: "https://www.instagram.com/baku.ess/p/abc",
      url: "https://search.example/result",
    })).toBe("instagram")
    expect(effectiveMonitoringPlatform({
      platform: "WEB",
      url: "https://news.example/baku-electronics",
    })).toBe("web")
  })

  it("builds a Web predicate that excludes recognized social destinations", () => {
    const where = effectiveMonitoringPlatformWhere(["web"])

    expect(where).toEqual({
      OR: [{
        AND: [
          { platform: { in: ["web", "WEB"] } },
          {
            AND: expect.arrayContaining([
              {
                OR: [
                  { url: null },
                  {
                    NOT: {
                      OR: expect.arrayContaining([
                        {
                          url: { contains: "facebook.com", mode: "insensitive" },
                        },
                        {
                          url: { contains: "youtube.com", mode: "insensitive" },
                        },
                      ]),
                    },
                  },
                ],
              },
              {
                OR: [
                  { canonicalUrl: null },
                  {
                    NOT: {
                      OR: expect.arrayContaining([
                        {
                          canonicalUrl: { contains: "instagram.com", mode: "insensitive" },
                        },
                      ]),
                    },
                  },
                ],
              },
              {
                OR: [
                  { parentPostUrl: null },
                  {
                    NOT: {
                      OR: expect.arrayContaining([
                        {
                          parentPostUrl: { contains: "tiktok.com", mode: "insensitive" },
                        },
                      ]),
                    },
                  },
                ],
              },
            ]),
          },
        ],
      }],
    })
  })

  it("includes WEB-acquired social links in the requested social platform", () => {
    const where = effectiveMonitoringPlatformWhere(["facebook"])

    expect(where).toEqual({
      OR: [{
        OR: [
          { platform: { in: ["facebook", "FACEBOOK"] } },
          {
            AND: [
              { platform: { in: ["web", "WEB"] } },
              {
                OR: expect.arrayContaining([
                  { url: { contains: "facebook.com", mode: "insensitive" } },
                  { canonicalUrl: { contains: "fb.watch", mode: "insensitive" } },
                ]),
              },
            ],
          },
        ],
      }],
    })
  })
})
