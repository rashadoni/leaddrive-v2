import { describe, expect, it } from "vitest"
import { clientIp, isCloudflareIp } from "@/lib/request-ip"

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

describe("clientIp", () => {
  it("uses the Nginx-overwritten peer and ignores attacker-controlled XFF", () => {
    expect(clientIp(request({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
    }))).toBe("203.0.113.10")
  })

  it("uses cf-connecting-ip when the Nginx peer is a Cloudflare IPv4 address", () => {
    expect(clientIp(request({
      "x-real-ip": "173.245.48.15",
      "cf-connecting-ip": "203.0.113.11",
      "x-forwarded-for": "198.51.100.3",
    }))).toBe("203.0.113.11")
  })

  it("uses cf-connecting-ip when the Nginx peer is a Cloudflare IPv6 address", () => {
    expect(clientIp(request({
      "x-real-ip": "2606:4700::1234",
      "cf-connecting-ip": "2001:db8::42",
    }))).toBe("2001:db8::42")
  })

  it("rejects a spoofed Cloudflare header from a direct origin caller", () => {
    expect(clientIp(request({
      "x-real-ip": "203.0.113.12",
      "cf-connecting-ip": "198.51.100.4",
    }))).toBe("203.0.113.12")
  })

  it("returns one shared unknown bucket instead of trusting malformed headers", () => {
    expect(clientIp(request({
      "x-real-ip": "not-an-ip",
      "cf-connecting-ip": "203.0.113.13",
      "x-forwarded-for": "203.0.113.14",
    }))).toBe("unknown")
  })
})

describe("isCloudflareIp", () => {
  it("matches addresses inside the published ranges but not adjacent networks", () => {
    expect(isCloudflareIp("104.16.0.1")).toBe(true)
    expect(isCloudflareIp("2a06:98c0::1")).toBe(true)
    expect(isCloudflareIp("104.15.255.255")).toBe(false)
    expect(isCloudflareIp("203.0.113.1")).toBe(false)
  })
})
