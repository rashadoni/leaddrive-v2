import { describe, it, expect, vi, afterEach } from "vitest"
import { isAuthStateDependentRequest } from "@/lib/sw-network-only"
import { signOutCallbackUrl } from "@/lib/tenant-domain"

const ORIGIN = "https://zeytun.leaddrivecrm.org"

function req(init: { mode?: string; headers?: Record<string, string> } = {}) {
  const headers = init.headers || {}
  return {
    mode: init.mode,
    headers: { get: (n: string) => headers[n] ?? null },
  }
}

function url(href: string) {
  return new URL(href)
}

describe("isAuthStateDependentRequest", () => {
  it("bypasses the cache for document navigations", () => {
    expect(
      isAuthStateDependentRequest(req({ mode: "navigate" }), url(`${ORIGIN}/dashboard`), ORIGIN)
    ).toBe(true)
  })

  // The regression this whole module exists for: an RSC transition after a
  // successful login must not be answered from the StaleWhileRevalidate copy
  // of /login that was cached while the user was signed out.
  it("bypasses the cache for RSC transitions", () => {
    expect(
      isAuthStateDependentRequest(req({ headers: { RSC: "1" } }), url(`${ORIGIN}/login`), ORIGIN)
    ).toBe(true)
  })

  it("bypasses the cache for RSC prefetches carrying ?_rsc", () => {
    expect(
      isAuthStateDependentRequest(req(), url(`${ORIGIN}/login?_rsc=abc123`), ORIGIN)
    ).toBe(true)
  })

  it("bypasses the cache for same-origin API traffic", () => {
    expect(
      isAuthStateDependentRequest(req(), url(`${ORIGIN}/api/v1/users/me`), ORIGIN)
    ).toBe(true)
  })

  // Tenant isolation: the session cookie is shared across *.leaddrivecrm.org,
  // so an /api response cached under one tenant must never be replayable.
  it("bypasses API traffic regardless of which tenant host is asking", () => {
    const other = "https://brandprotection.leaddrivecrm.org"
    expect(
      isAuthStateDependentRequest(req(), url(`${other}/api/v1/users/me`), other)
    ).toBe(true)
  })

  it("never caches protected runtime uploads under the browser-visible URL", () => {
    for (const pathname of [
      "/uploads/avatars/org-1/avatar.webp",
      "/uploads/contracts/confidential.pdf",
      "/uploads/inbox/org-1/attachment.jpg",
    ]) {
      expect(
        isAuthStateDependentRequest(req(), url(`${ORIGIN}${pathname}`), ORIGIN)
      ).toBe(true)
    }
  })

  it("still caches static assets", () => {
    expect(
      isAuthStateDependentRequest(req(), url(`${ORIGIN}/_next/static/chunk.js`), ORIGIN)
    ).toBe(false)
    expect(
      isAuthStateDependentRequest(req(), url(`${ORIGIN}/icons/logo.png`), ORIGIN)
    ).toBe(false)
  })

  // Cross-origin hosts that merely use an /api/ prefix keep the default rules.
  it("leaves cross-origin /api traffic to the default rules", () => {
    expect(
      isAuthStateDependentRequest(req(), url("https://tiles.example.com/api/v1/tile.png"), ORIGIN)
    ).toBe(false)
    expect(
      isAuthStateDependentRequest(req(), url("https://cdn.example.com/uploads/logo.png"), ORIGIN)
    ).toBe(false)
  })
})

describe("signOutCallbackUrl", () => {
  afterEach(() => vi.unstubAllGlobals())

  // The bug: a relative callbackUrl is resolved against NEXTAUTH_URL
  // (the app host), so signing out of a tenant subdomain dumped the user on
  // app.leaddrivecrm.org. The absolute form keeps them on their own host.
  it("keeps the user on the tenant host they signed out from", () => {
    vi.stubGlobal("window", { location: { origin: ORIGIN } })
    expect(signOutCallbackUrl()).toBe("https://zeytun.leaddrivecrm.org/login")
  })

  it("does the same on the app host", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.leaddrivecrm.org" } })
    expect(signOutCallbackUrl()).toBe("https://app.leaddrivecrm.org/login")
  })

  it("honours a custom path", () => {
    vi.stubGlobal("window", { location: { origin: ORIGIN } })
    expect(signOutCallbackUrl("/goodbye")).toBe("https://zeytun.leaddrivecrm.org/goodbye")
  })

  it("falls back to the bare path when there is no window (SSR)", () => {
    expect(signOutCallbackUrl()).toBe("/login")
  })
})
