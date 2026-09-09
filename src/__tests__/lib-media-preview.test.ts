import { describe, it, expect } from "vitest"
import { isImagePreview, isTikTokPlayerUrl, isVideoPreview } from "@/lib/media-preview"

/**
 * Inbox inline-image-preview decision. Fixes "фото работает только без превью" — media rendered as a
 * link instead of an inline thumbnail because messageType wasn't "image".
 */
describe("isImagePreview", () => {
  it("true when messageType is image (WhatsApp/Facebook inbound + outbound send)", () => {
    expect(isImagePreview("image", "/uploads/inbox/org/abc")).toBe(true)
  })

  it("true for image URL extensions — covers Telegram inbound (no messageType)", () => {
    for (const u of ["/uploads/telegram/o/a.jpg", "/x/b.jpeg", "/y/c.PNG", "/z/d.webp", "/q/e.gif?v=1", "/r/f.avif#x"]) {
      expect(isImagePreview(null, u)).toBe(true)
    }
  })

  it("false for non-image media (documents render as a link)", () => {
    expect(isImagePreview("document", "/uploads/inbox/o/a.pdf")).toBe(false)
    expect(isImagePreview(null, "/uploads/inbox/o/a.docx")).toBe(false)
    expect(isImagePreview(null, "/uploads/inbox/o/a.mp4")).toBe(false)
  })

  it("false when there is no mediaUrl", () => {
    expect(isImagePreview("image", null)).toBe(false)
    expect(isImagePreview(undefined, undefined)).toBe(false)
    expect(isImagePreview(null, "")).toBe(false)
  })

  it("false for browser-non-renderable formats even when tagged image (HEIC/HEIF/TIFF → link, not broken <img>)", () => {
    expect(isImagePreview("image", "/uploads/whatsapp/o/photo.heic")).toBe(false)
    expect(isImagePreview("image", "/x/y.heif")).toBe(false)
    expect(isImagePreview(null, "/x/z.tiff?v=1")).toBe(false)
  })

  it("false for TikTok player URLs even when Chatwoot tags them as image", () => {
    expect(isImagePreview("image", "https://www.tiktok.com/player/v1/7656684706481720598?autoplay=1")).toBe(false)
  })
})

describe("isVideoPreview", () => {
  it("true when messageType is video", () => {
    expect(isVideoPreview("video", "https://cdn.chatwoot.test/attachment")).toBe(true)
  })

  it("true for browser-playable video URL extensions", () => {
    for (const u of ["/uploads/tiktok/o/a.mp4", "/x/b.webm", "/y/c.ogg", "/z/d.mov?v=1", "/q/e.m4v#x"]) {
      expect(isVideoPreview(null, u)).toBe(true)
    }
  })

  it("false for non-video media", () => {
    expect(isVideoPreview("document", "/uploads/inbox/o/a.pdf")).toBe(false)
    expect(isVideoPreview(null, "/uploads/inbox/o/a.jpg")).toBe(false)
  })
})

describe("isTikTokPlayerUrl", () => {
  it("true for TikTok player and embed URLs", () => {
    expect(isTikTokPlayerUrl("https://www.tiktok.com/player/v1/7656684706481720598?autoplay=1")).toBe(true)
    expect(isTikTokPlayerUrl("https://www.tiktok.com/embed/7656684706481720598")).toBe(true)
  })

  it("false for normal media URLs", () => {
    expect(isTikTokPlayerUrl("https://cdn.chatwoot.test/photo.jpg")).toBe(false)
    expect(isTikTokPlayerUrl("/uploads/tiktok/o/a.mp4")).toBe(false)
  })
})
