import { describe, expect, it } from "vitest"
import { validateUploadBytes } from "@/lib/upload-security"

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

describe("validateUploadBytes", () => {
  it("accepts valid PNG signatures", () => {
    expect(validateUploadBytes("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBeNull()
  })

  it("rejects HTML spoofed as PNG", () => {
    expect(validateUploadBytes("image/png", text("<script>alert(1)</script>"))).toContain("PNG")
  })

  it("accepts valid PDF signatures", () => {
    expect(validateUploadBytes("application/pdf", text("%PDF-1.7\n"))).toBeNull()
  })

  it("rejects binary bytes in text uploads", () => {
    expect(validateUploadBytes("text/plain", bytes(0x68, 0x69, 0x00))).toContain("binary")
  })

  it("accepts a PowerPoint, an Ogg voice note and an Outlook message by their own signatures", () => {
    expect(validateUploadBytes("application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull()
    expect(validateUploadBytes("audio/ogg", text("OggS\u0000"))).toBeNull()
    expect(validateUploadBytes("audio/ogg", text("<html>"))).toContain("Ogg")
    expect(validateUploadBytes("application/vnd.ms-outlook", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBeNull()
    expect(validateUploadBytes("application/vnd.ms-outlook", text("From: x"))).toContain("legacy Office")
  })

  it("accepts ZIP-based Office signatures", () => {
    expect(validateUploadBytes("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull()
  })
})

// Task files since 2026-11-12 (owner: «Да, разрешить»): videos and design sources, checked by their bytes too.
describe("validateUploadBytes — task videos and design sources", () => {
  const b = (...parts: (string | number[])[]) => new Uint8Array(Buffer.concat(parts.map((p) => typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))))
  it("accepts the real thing", () => {
    expect(validateUploadBytes("video/mp4", b([0, 0, 0, 0x20], "ftypisom", [0, 0]))).toBeNull()
    expect(validateUploadBytes("video/quicktime", b([0, 0, 0, 0x14], "ftypqt  "))).toBeNull()
    expect(validateUploadBytes("video/quicktime", b([0, 0, 0, 0x08], "wide"))).toBeNull()
    expect(validateUploadBytes("application/vnd.corel-draw", b("RIFF", [1, 2, 3, 4], "CDRDvrsn"))).toBeNull()
    expect(validateUploadBytes("application/vnd.corel-draw", b([0x50, 0x4b, 0x03, 0x04], "content"))).toBeNull()
    expect(validateUploadBytes("image/vnd.adobe.photoshop", b("8BPS", [0, 1]))).toBeNull()
    expect(validateUploadBytes("application/rtf", b("{\\rtf1\\ansi}"))).toBeNull()
    expect(validateUploadBytes("message/rfc822", b("From: a@b.az\r\nSubject: Salam\r\n\r\nMətn"))).toBeNull()
  })
  it("refuses a file that only wears the name", () => {
    expect(validateUploadBytes("video/mp4", b("<html><script>"))).not.toBeNull()
    expect(validateUploadBytes("application/vnd.corel-draw", b("RIFF", [1, 2, 3, 4], "WAVEfmt "))).not.toBeNull()
    expect(validateUploadBytes("image/vnd.adobe.photoshop", b([0x89, 0x50, 0x4e, 0x47]))).not.toBeNull()
    expect(validateUploadBytes("application/rtf", b("%PDF-1.4"))).not.toBeNull()
    expect(validateUploadBytes("message/rfc822", b([0, 1, 2, 3]))).not.toBeNull()
  })
})

