import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webTrackingConfig: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn() },
    webSession: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>()
  return { ...actual, checkRateLimit: vi.fn(() => true) }
})

import { POST } from "@/app/api/v1/public/web-tracking/identify/route"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { signIdentityToken } from "@/lib/web-tracking"

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
const VISITOR = "Vis1234567890abcdef"
const CONFIG = {
  id: "cfg-1",
  organizationId: "org-1",
  enabled: true,
  publicKey: "ldt_testkey123",
  allowedOrigins: [] as string[],
  retentionDays: 180,
}

function makeRequest(body: unknown, opts: { ua?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    "user-agent": opts.ua ?? BROWSER_UA,
    "x-real-ip": "10.0.0.1",
  }
  if (opts.origin) headers["origin"] = opts.origin
  return new NextRequest(new URL("/api/v1/public/web-tracking/identify", "http://localhost:3000"), {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockReturnValue(true)
  ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue(CONFIG)
  ;(prisma.contact.findFirst as any).mockResolvedValue({ id: "contact-1" })
  ;(prisma.webSession.updateMany as any).mockResolvedValue({ count: 3 })
  // default: the visitor already has a live session → no stub creation
  ;(prisma.webSession.findFirst as any).mockResolvedValue({ id: "sess-1" })
  ;(prisma.webSession.create as any).mockResolvedValue({ id: "sess-new" })
})

describe("POST /api/v1/public/web-tracking/identify", () => {
  it("stitches by email when a contact matches", async () => {
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, email: "Jane@Site.test" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // matched by normalised (lowercased) email, case-insensitively — Contact.email
    // is stored as typed, so an exact `=` would miss mixed-case rows
    expect((prisma.contact.findFirst as any).mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      email: { equals: "jane@site.test", mode: "insensitive" },
    })
    expect((prisma.webSession.updateMany as any).mock.calls[0][0].data).toEqual({ contactId: "contact-1" })
  })

  it("stays opaque (200) and writes nothing when no contact matches", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue(null)
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, email: "ghost@site.test" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(prisma.webSession.updateMany).not.toHaveBeenCalled()
  })

  it("stitches by a valid signed token", async () => {
    const token = signIdentityToken("org-1", "contact-1")
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, token }))
    expect(res.status).toBe(200)
    // token path verifies the contact exists in-org first
    expect((prisma.contact.findFirst as any).mock.calls[0][0].where).toMatchObject({
      id: "contact-1",
      organizationId: "org-1",
    })
    expect(prisma.webSession.updateMany).toHaveBeenCalled()
  })

  it("ignores a token minted for a different org", async () => {
    const token = signIdentityToken("org-OTHER", "contact-1")
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, token }))
    expect(res.status).toBe(200)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.webSession.updateMany).not.toHaveBeenCalled()
  })

  it("token wins over email when both are present (no double stitch)", async () => {
    const token = signIdentityToken("org-1", "contact-1")
    const res = await POST(
      makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, token, email: "other@site.test" }),
    )
    expect(res.status).toBe(200)
    // only the token path's contact lookup ran (by id, not by email)
    expect(prisma.contact.findFirst).toHaveBeenCalledTimes(1)
    expect((prisma.contact.findFirst as any).mock.calls[0][0].where).toMatchObject({ id: "contact-1" })
    expect(prisma.webSession.updateMany).toHaveBeenCalledTimes(1)
  })

  it("pre-creates a bound stub session when the visitor has none live (first-visit race)", async () => {
    ;(prisma.webSession.findFirst as any).mockResolvedValue(null)
    const token = signIdentityToken("org-1", "contact-1")
    const res = await POST(
      makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, token, url: "https://site.test/landing?a=1" }),
    )
    expect(res.status).toBe(200)
    const created = (prisma.webSession.create as any).mock.calls[0][0].data
    expect(created).toMatchObject({
      organizationId: "org-1",
      visitorId: VISITOR,
      contactId: "contact-1",
      entryUrl: "https://site.test/landing?a=1",
    })
  })

  it("400s when neither email nor token is present", async () => {
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR }))
    expect(res.status).toBe(400)
  })

  it("400s on a malformed visitorId", async () => {
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: "bad!", email: "a@b.test" }))
    expect(res.status).toBe(400)
  })

  it("drops bots before any work", async () => {
    const res = await POST(
      makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, email: "a@b.test" }, { ua: "Googlebot/2.1" }),
    )
    expect(res.status).toBe(200)
    expect(prisma.webTrackingConfig.findUnique).not.toHaveBeenCalled()
  })

  it("404s for unknown or disabled config", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue(null)
    expect((await POST(makeRequest({ key: "nope", visitorId: VISITOR, email: "a@b.test" }))).status).toBe(404)
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({ ...CONFIG, enabled: false })
    expect((await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, email: "a@b.test" }))).status).toBe(404)
  })

  it("429s when the rate limit trips", async () => {
    ;(checkRateLimit as any).mockReturnValue(false)
    const res = await POST(makeRequest({ key: CONFIG.publicKey, visitorId: VISITOR, email: "a@b.test" }))
    expect(res.status).toBe(429)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })
})
