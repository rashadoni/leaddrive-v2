import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webTrackingConfig: { findUnique: vi.fn() },
    webSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    webAction: { createMany: vi.fn() },
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

// C4 — the route fire-and-forgets workflow triggers for stitched sessions.
vi.mock("@/lib/web-tracking-triggers", () => ({
  fireWebActivityWorkflows: vi.fn().mockResolvedValue(undefined),
}))

import { POST, OPTIONS } from "@/app/api/v1/public/web-tracking/route"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { fireWebActivityWorkflows } from "@/lib/web-tracking-triggers"

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

function makeRequest(
  body: unknown,
  opts: { ua?: string; origin?: string; xForwardedHost?: string } = {},
) {
  const headers: Record<string, string> = {
    // sendBeacon path — the route must parse text/plain bodies
    "Content-Type": "text/plain",
    "user-agent": opts.ua ?? BROWSER_UA,
    "x-real-ip": "10.0.0.1",
  }
  if (opts.origin) headers["origin"] = opts.origin
  if (opts.xForwardedHost) headers["x-forwarded-host"] = opts.xForwardedHost
  return new NextRequest(new URL("/api/v1/public/web-tracking", "http://localhost:3000"), {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  })
}

function batch(events: unknown[] = [{ type: "pageview", url: "https://site.test/pricing?utm_source=fb" }]) {
  return { key: CONFIG.publicKey, visitorId: VISITOR, events }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockReturnValue(true)
  ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue(CONFIG)
  ;(prisma.webSession.findFirst as any).mockResolvedValue(null)
  ;(prisma.webSession.create as any).mockResolvedValue({ id: "sess-1" })
  ;(prisma.webSession.update as any).mockResolvedValue({})
  ;(prisma.webAction.createMany as any).mockResolvedValue({ count: 1 })
})

describe("OPTIONS /api/v1/public/web-tracking", () => {
  it("answers the CORS preflight", async () => {
    const res = await OPTIONS(makeRequest(batch()))
    expect(res.status).toBe(204)
  })
})

describe("POST /api/v1/public/web-tracking", () => {
  it("drops bots before any work", async () => {
    const res = await POST(makeRequest(batch(), { ua: "Googlebot/2.1" }))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("bot")
    expect(prisma.webTrackingConfig.findUnique).not.toHaveBeenCalled()
  })

  it("400s on non-JSON and on schema violations", async () => {
    expect((await POST(makeRequest("not json{{"))).status).toBe(400)
    expect((await POST(makeRequest({ key: "k" }))).status).toBe(400)
    expect((await POST(makeRequest(batch([])))).status).toBe(400)
  })

  it("400s on a malformed visitorId (cookie tampering)", async () => {
    const res = await POST(makeRequest({ ...batch(), visitorId: "короткий!" }))
    expect(res.status).toBe(400)
  })

  it("404s for an unknown key and for a disabled config", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue(null)
    expect((await POST(makeRequest(batch()))).status).toBe(404)
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({ ...CONFIG, enabled: false })
    expect((await POST(makeRequest(batch()))).status).toBe(404)
  })

  it("403s when the origin is not whitelisted", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({
      ...CONFIG,
      allowedOrigins: ["https://allowed.test"],
    })
    const res = await POST(makeRequest(batch(), { origin: "https://evil.test" }))
    expect(res.status).toBe(403)
    expect(prisma.webAction.createMany).not.toHaveBeenCalled()
  })

  it("ignores a spoofed X-Forwarded-Host claiming same-origin with the Origin", async () => {
    // A non-browser client controls both headers: Origin: https://evil.test +
    // X-Forwarded-Host: evil.test. The old same-origin shortcut trusted the
    // forwarded host and would have let this slip past the whitelist.
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({
      ...CONFIG,
      allowedOrigins: ["https://allowed.test"],
    })
    const res = await POST(
      makeRequest(batch(), { origin: "https://evil.test", xForwardedHost: "evil.test" }),
    )
    expect(res.status).toBe(403)
    expect(prisma.webAction.createMany).not.toHaveBeenCalled()
  })

  it("allows a widget embedded on an app-owned tenant subdomain past a non-empty whitelist", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({
      ...CONFIG,
      allowedOrigins: ["https://allowed.test"],
    })
    const res = await POST(makeRequest(batch(), { origin: "https://acme.leaddrivecrm.org" }))
    expect(res.status).toBe(200)
  })

  it("403s a whitelisted config when Origin is absent (non-browser client)", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({
      ...CONFIG,
      allowedOrigins: ["https://allowed.test"],
    })
    const res = await POST(makeRequest(batch())) // no origin header
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("Origin required")
  })

  it("accepts a whitelisted origin", async () => {
    ;(prisma.webTrackingConfig.findUnique as any).mockResolvedValue({
      ...CONFIG,
      allowedOrigins: ["https://allowed.test"],
    })
    const res = await POST(makeRequest(batch(), { origin: "https://allowed.test" }))
    expect(res.status).toBe(200)
  })

  it("429s when the rate limit trips", async () => {
    ;(checkRateLimit as any).mockReturnValue(false)
    const res = await POST(makeRequest(batch()))
    expect(res.status).toBe(429)
    expect(prisma.webSession.findFirst).not.toHaveBeenCalled()
  })

  it("creates a session with first-touch UTM and records the batch", async () => {
    const res = await POST(
      makeRequest(
        batch([
          { type: "pageview", url: "https://site.test/pricing?utm_source=fb&utm_campaign=july", referrer: "https://fb.com" },
          { type: "event", name: "cta_click", url: "https://site.test/pricing" },
        ]),
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, recorded: 2 })

    const created = (prisma.webSession.create as any).mock.calls[0][0].data
    expect(created).toMatchObject({
      organizationId: "org-1",
      visitorId: VISITOR,
      utmSource: "fb",
      utmCampaign: "july",
      entryUrl: "https://site.test/pricing?utm_source=fb&utm_campaign=july",
    })

    const rows = (prisma.webAction.createMany as any).mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: "pageview", sessionId: "sess-1", name: null })
    expect(rows[1]).toMatchObject({ type: "event", name: "cta_click" })

    // only pageviews bump the counter
    expect((prisma.webSession.update as any).mock.calls[0][0].data.pageViews).toEqual({ increment: 1 })
  })

  it("reuses an active session instead of creating a new one", async () => {
    ;(prisma.webSession.findFirst as any).mockResolvedValue({ id: "sess-open" })
    const res = await POST(makeRequest(batch()))
    expect(res.status).toBe(200)
    expect(prisma.webSession.create).not.toHaveBeenCalled()
    expect((prisma.webAction.createMany as any).mock.calls[0][0].data[0].sessionId).toBe("sess-open")
  })

  // C4 — web-activity workflow triggers
  it("fires workflow triggers for a batch on a STITCHED session", async () => {
    ;(prisma.webSession.findFirst as any).mockResolvedValue({ id: "sess-open", contactId: "ct-1" })
    const res = await POST(makeRequest(batch()))
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(fireWebActivityWorkflows).toHaveBeenCalledTimes(1))
    const [, args] = vi.mocked(fireWebActivityWorkflows).mock.calls[0]
    expect(args).toMatchObject({ organizationId: "org-1", contactId: "ct-1" })
    expect(args.events.length).toBeGreaterThan(0)
  })

  it("does NOT fire workflow triggers for an anonymous session", async () => {
    ;(prisma.webSession.findFirst as any).mockResolvedValue({ id: "sess-open", contactId: null })
    const res = await POST(makeRequest(batch()))
    expect(res.status).toBe(200)
    await new Promise((r) => setImmediate(r))
    expect(fireWebActivityWorkflows).not.toHaveBeenCalled()
  })

  it("drops oversized metadata instead of storing it", async () => {
    const res = await POST(
      makeRequest(batch([{ type: "event", name: "big", metadata: { blob: "x".repeat(3000) } }])),
    )
    expect(res.status).toBe(200)
    expect((prisma.webAction.createMany as any).mock.calls[0][0].data[0].metadata).toBeUndefined()
  })
})
