import { describe, expect, it } from "vitest"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { config } from "@/proxy"

function doesProxyMatch(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    url: `https://app.leaddrivecrm.org${pathname}`,
  })
}

describe("proxy matcher security boundary", () => {
  it.each([
    "/contacts/foo.png",
    "/leads/foo.svg",
    "/tickets/foo.jpg",
  ])("runs the auth proxy for a file-like dynamic CRM id: %s", (pathname) => {
    expect(doesProxyMatch(pathname)).toBe(true)
  })

  it.each([
    "/marketing/crm-dashboard.png",
    "/icons/icon-192.png",
    "/wallpapers/alpine-v3.mp4",
    "/uploads/contracts/document.pdf",
    "/favicon.ico",
  ])("bypasses only a concrete public asset path: %s", (pathname) => {
    expect(doesProxyMatch(pathname)).toBe(false)
  })
})
