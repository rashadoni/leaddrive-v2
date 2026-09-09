import { describe, expect, it } from "vitest"
import {
  monitoringSourceCanonicalIdentityKeys,
  monitoringSourcesShareCanonicalIdentity,
} from "@/lib/social/monitoring-source-identity"

describe("monitoring source canonical identity", () => {
  it("joins Instagram URL and handle forms", () => {
    expect(monitoringSourcesShareCanonicalIdentity(
      {
        platform: "instagram",
        sourceType: "profile",
        url: "http://www.instagram.com/ObaMarketler/?utm_source=campaign",
      },
      {
        platform: "instagram",
        sourceType: "profile",
        handle: "@obamarketler",
      },
    )).toBe(true)
  })

  it("joins mobile Facebook profile URLs and handles", () => {
    expect(monitoringSourcesShareCanonicalIdentity(
      {
        platform: "facebook",
        sourceType: "page",
        url: "https://m.facebook.com/BakuElectronics/?fbclid=tracking",
      },
      {
        platform: "facebook",
        sourceType: "profile",
        handle: "bakuelectronics",
      },
    )).toBe(true)
  })

  it("joins Twitter and X host aliases", () => {
    expect(monitoringSourcesShareCanonicalIdentity(
      {
        platform: "twitter",
        sourceType: "profile",
        url: "https://twitter.com/LeadDrive",
      },
      {
        platform: "x",
        sourceType: "profile",
        url: "https://www.x.com/leaddrive/",
      },
    )).toBe(true)
  })

  it("protects an entire web domain across protocol and path variants", () => {
    expect(monitoringSourcesShareCanonicalIdentity(
      { platform: "web", sourceType: "search_url", url: "https://www.example.az/" },
      { platform: "web", sourceType: "search_url", url: "http://example.az/news/story" },
    )).toBe(true)
  })

  it("keeps unrelated accounts and post resources distinct", () => {
    expect(monitoringSourcesShareCanonicalIdentity(
      { platform: "instagram", sourceType: "profile", handle: "brand-one" },
      { platform: "instagram", sourceType: "profile", handle: "brand-two" },
    )).toBe(false)
    expect(monitoringSourcesShareCanonicalIdentity(
      { platform: "instagram", sourceType: "search_url", url: "https://instagram.com/p/AAA" },
      { platform: "instagram", sourceType: "search_url", url: "https://instagram.com/p/BBB" },
    )).toBe(false)
  })

  it("does not assign canonical keys to keyword-only queries", () => {
    expect(monitoringSourceCanonicalIdentityKeys({
      platform: "facebook",
      sourceType: "keyword",
    })).toEqual([])
  })
})
