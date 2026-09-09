/**
 * C4 Call Transcription — pure type-helper tests.
 */
import { describe, it, expect } from "vitest"
import { isPrivateHost, isValidAudioUrl, TRANSCRIPTION_LIMITS } from "@/lib/transcription/types"

describe("isValidAudioUrl", () => {
  it("accepts https://", () => {
    expect(isValidAudioUrl("https://example.com/recording.mp3")).toBe(true)
  })

  it("accepts http://", () => {
    expect(isValidAudioUrl("http://internal.host/file.wav")).toBe(true)
  })

  it("rejects empty string", () => {
    expect(isValidAudioUrl("")).toBe(false)
  })

  it("rejects javascript:", () => {
    expect(isValidAudioUrl("javascript:alert(1)")).toBe(false)
  })

  it("rejects file://", () => {
    expect(isValidAudioUrl("file:///etc/passwd")).toBe(false)
  })

  it("rejects ftp://", () => {
    expect(isValidAudioUrl("ftp://example.com/file.mp3")).toBe(false)
  })

  it("rejects malformed URLs", () => {
    expect(isValidAudioUrl("not a url")).toBe(false)
  })

  it("rejects URLs over the length cap", () => {
    const long = "https://example.com/" + "a".repeat(TRANSCRIPTION_LIMITS.maxUrlLength)
    expect(isValidAudioUrl(long)).toBe(false)
  })

  it("accepts URLs at exactly the length cap", () => {
    const prefix = "https://example.com/"
    const trailing = "a".repeat(TRANSCRIPTION_LIMITS.maxUrlLength - prefix.length)
    const atCap = prefix + trailing
    expect(atCap.length).toBe(TRANSCRIPTION_LIMITS.maxUrlLength)
    expect(isValidAudioUrl(atCap)).toBe(true)
  })
})

describe("isValidAudioUrl — SSRF guard", () => {
  it("rejects localhost", () => {
    expect(isValidAudioUrl("https://localhost/x.mp3")).toBe(false)
  })

  it("rejects 127.0.0.1 (IPv4 loopback)", () => {
    expect(isValidAudioUrl("https://127.0.0.1/x.mp3")).toBe(false)
  })

  it("rejects 127.x.x.x range (full loopback)", () => {
    expect(isValidAudioUrl("https://127.5.42.1/x.mp3")).toBe(false)
  })

  it("rejects 169.254.169.254 (AWS metadata)", () => {
    expect(isValidAudioUrl("http://169.254.169.254/latest/meta-data/")).toBe(false)
  })

  it("rejects 10.0.0.0/8 RFC1918", () => {
    expect(isValidAudioUrl("https://10.0.0.5/x.mp3")).toBe(false)
  })

  it("rejects 172.16.0.0/12 RFC1918", () => {
    expect(isValidAudioUrl("https://172.20.1.1/x.mp3")).toBe(false)
  })

  it("rejects 192.168.0.0/16 RFC1918", () => {
    expect(isValidAudioUrl("https://192.168.1.5/x.mp3")).toBe(false)
  })

  it("rejects 0.0.0.0", () => {
    expect(isValidAudioUrl("https://0.0.0.0/x.mp3")).toBe(false)
  })

  it("rejects IPv6 loopback ::1", () => {
    expect(isValidAudioUrl("https://[::1]/x.mp3")).toBe(false)
  })

  it("rejects IPv4-mapped IPv6 of loopback", () => {
    expect(isValidAudioUrl("https://[::ffff:127.0.0.1]/x.mp3")).toBe(false)
  })

  it("rejects 224.x multicast", () => {
    expect(isValidAudioUrl("https://224.0.0.1/x.mp3")).toBe(false)
  })

  it("ACCEPTS public IPv4 (1.1.1.1)", () => {
    expect(isValidAudioUrl("https://1.1.1.1/x.mp3")).toBe(true)
  })

  it("ACCEPTS public hostnames (recordings.twiliocdn.com)", () => {
    expect(isValidAudioUrl("https://recordings.twiliocdn.com/x.wav")).toBe(true)
  })

  it("rejects malformed IPv4 literal (out of range)", () => {
    // Fail-closed for invalid IPv4 — 999.0.0.0 isn't a real IP but
    // shouldn't pass through to fetch().
    expect(isValidAudioUrl("https://999.0.0.0/x.mp3")).toBe(false)
  })
})

describe("isPrivateHost — direct cases", () => {
  it.each([
    ["localhost", true],
    ["ip6-localhost", true],
    ["127.0.0.1", true],
    ["10.42.1.1", true],
    ["192.168.0.1", true],
    ["169.254.169.254", true],
    ["172.31.255.255", true],
    ["172.32.0.0", false], // outside 172.16-31
    ["8.8.8.8", false],
    ["example.com", false],
  ])("isPrivateHost(%j) === %s", (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected)
  })
})
