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
