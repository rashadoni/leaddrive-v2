import { describe, expect, it } from "vitest"

import { facebookMobileUrl } from "@/lib/social/external-source-links"

describe("facebookMobileUrl", () => {
  it("preserves a Facebook permalink while switching to the mobile host", () => {
    expect(facebookMobileUrl(
      "https://www.facebook.com/example/posts/pfbid123?comment_id=456#reply",
    )).toBe("https://m.facebook.com/example/posts/pfbid123?comment_id=456#reply")
  })

  it("accepts existing Facebook subdomains", () => {
    expect(facebookMobileUrl("https://mbasic.facebook.com/example/posts/123"))
      .toBe("https://m.facebook.com/example/posts/123")
  })

  it.each([
    null,
    "",
    "not-a-url",
    "http://www.facebook.com/example/posts/123",
    "https://facebook.example/example/posts/123",
    "https://developers.facebook.com/example/posts/123",
    "https://graph.facebook.com/example/posts/123",
    "https://user:secret@www.facebook.com/example/posts/123",
    "https://www.facebook.com:444/example/posts/123",
    "https://fb.watch/abc123",
  ])("rejects unsafe or unsupported input: %s", (value) => {
    expect(facebookMobileUrl(value)).toBeNull()
  })
})
