import { describe, it, expect } from "vitest"
import { classifyPageUrl, isBotUserAgent } from "./track-pixel"

describe("classifyPageUrl", () => {
  it("flags buying-intent pages as high-intent", () => {
    expect(classifyPageUrl("/pricing")).toBe("page_view_high_intent")
    expect(classifyPageUrl("https://acme.com/pricing?plan=pro")).toBe("page_view_high_intent")
    expect(classifyPageUrl("/request-demo")).toBe("page_view_high_intent")
    expect(classifyPageUrl("/checkout/cart")).toBe("page_view_high_intent")
    expect(classifyPageUrl("https://x.com/get-started")).toBe("page_view_high_intent")
    expect(classifyPageUrl("/contact-sales")).toBe("page_view_high_intent")
  })

  it("treats everything else as research", () => {
    expect(classifyPageUrl("/blog/how-to")).toBe("page_view_research")
    expect(classifyPageUrl("https://acme.com/products")).toBe("page_view_research")
    expect(classifyPageUrl("/")).toBe("page_view_research")
  })

  it("falls back to research for empty / invalid input", () => {
    expect(classifyPageUrl("")).toBe("page_view_research")
    expect(classifyPageUrl(null)).toBe("page_view_research")
    expect(classifyPageUrl(undefined)).toBe("page_view_research")
  })
})

describe("isBotUserAgent", () => {
  it("detects bots / crawlers / tools", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true)
    expect(isBotUserAgent("curl/8.4.0")).toBe(true)
    expect(isBotUserAgent("python-requests/2.31.0")).toBe(true)
    expect(isBotUserAgent("HeadlessChrome/120")).toBe(true)
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true)
  })

  it("treats empty / missing UA as a bot", () => {
    expect(isBotUserAgent("")).toBe(true)
    expect(isBotUserAgent(null)).toBe(true)
    expect(isBotUserAgent(undefined)).toBe(true)
  })

  it("lets a real browser through", () => {
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe(false)
  })
})
