import { describe, it, expect, vi } from "vitest"
import {
  signIdentityToken,
  verifyIdentityToken,
  appendIdentityToken,
  IDENTITY_TOKEN_TTL_MS,
  IDENTITY_TOKEN_PARAM,
} from "@/lib/web-tracking"
import { stitchVisitorToContact, stitchByEmail } from "@/lib/web-tracking-identity"

const NOW = 1_700_000_000_000

describe("identity token sign/verify", () => {
  it("round-trips a token back to its org+contact", () => {
    const token = signIdentityToken("org-1", "contact-9", NOW)
    expect(verifyIdentityToken(token, NOW)).toEqual({
      organizationId: "org-1",
      contactId: "contact-9",
    })
  })

  it("rejects an expired token", () => {
    const token = signIdentityToken("org-1", "contact-9", NOW)
    // one ms past expiry
    expect(verifyIdentityToken(token, NOW + IDENTITY_TOKEN_TTL_MS + 1)).toBeNull()
    // still valid at the boundary
    expect(verifyIdentityToken(token, NOW + IDENTITY_TOKEN_TTL_MS)).not.toBeNull()
  })

  it("rejects a tampered signature or payload", () => {
    const token = signIdentityToken("org-1", "contact-9", NOW)
    expect(verifyIdentityToken(token.slice(0, -2) + "xy", NOW)).toBeNull()
    const [payload, sig] = token.split(".")
    const forged = Buffer.from("org-1.contact-EVIL." + (NOW + 1000)).toString("base64url")
    expect(verifyIdentityToken(`${forged}.${sig}`, NOW)).toBeNull()
    // sanity: the untampered payload half is what we mutated above
    expect(payload).toBeTruthy()
  })

  it("rejects garbage without throwing", () => {
    for (const bad of [null, undefined, 42, "", "nodot", "a.b.c.d", "x".repeat(600)]) {
      expect(verifyIdentityToken(bad as unknown, NOW)).toBeNull()
    }
  })
})

describe("appendIdentityToken", () => {
  it("adds the _ldi param and keeps it verifiable", () => {
    const out = appendIdentityToken("https://site.test/thanks?a=1", "org-1", "c-1", NOW)
    const u = new URL(out)
    expect(u.searchParams.get("a")).toBe("1")
    const token = u.searchParams.get(IDENTITY_TOKEN_PARAM)!
    expect(verifyIdentityToken(token, NOW)).toEqual({ organizationId: "org-1", contactId: "c-1" })
  })

  it("returns the input unchanged when the URL is unparseable", () => {
    expect(appendIdentityToken("not a url", "org-1", "c-1", NOW)).toBe("not a url")
  })
})

describe("stitchVisitorToContact", () => {
  // default: a live session exists → no stub creation
  function client(count = 3, liveSession: object | null = { id: "sess-1" }) {
    return {
      webSession: {
        updateMany: vi.fn().mockResolvedValue({ count }),
        findFirst: vi.fn().mockResolvedValue(liveSession),
        create: vi.fn().mockResolvedValue({ id: "sess-new" }),
      },
    }
  }

  it("claims only anonymous sessions inside the 30-day window", async () => {
    const c = client(2)
    const res = await stitchVisitorToContact(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
      now: new Date(NOW),
    })
    expect(res.stitchedSessions).toBe(2)
    const arg = c.webSession.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: null, // idempotent + non-clobbering
    })
    // 30 days back from NOW
    expect(arg.where.lastSeenAt.gte.getTime()).toBe(NOW - 30 * 24 * 60 * 60 * 1000)
    expect(arg.data).toEqual({ contactId: "contact-1" })
    expect(c.webSession.create).not.toHaveBeenCalled()
  })

  it("honours a custom window", async () => {
    const c = client()
    await stitchVisitorToContact(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
      now: new Date(NOW),
      windowDays: 7,
    })
    const arg = c.webSession.updateMany.mock.calls[0][0]
    expect(arg.where.lastSeenAt.gte.getTime()).toBe(NOW - 7 * 24 * 60 * 60 * 1000)
  })

  it("no-ops on missing identifiers (never writes)", async () => {
    const c = client()
    const res = await stitchVisitorToContact(c as never, {
      organizationId: "",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
    })
    expect(res.stitchedSessions).toBe(0)
    expect(c.webSession.updateMany).not.toHaveBeenCalled()
    expect(c.webSession.create).not.toHaveBeenCalled()
  })

  it("re-claims once when the first claim saw 0 rows but a live session exists (ingest interleave)", async () => {
    const c = client(0, { id: "sess-just-created" })
    c.webSession.updateMany
      .mockResolvedValueOnce({ count: 0 }) // first claim: session not created yet
      .mockResolvedValueOnce({ count: 1 }) // re-claim: ingest's row is now visible
    const res = await stitchVisitorToContact(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
      now: new Date(NOW),
    })
    expect(res.stitchedSessions).toBe(1)
    expect(c.webSession.updateMany).toHaveBeenCalledTimes(2)
    expect(c.webSession.create).not.toHaveBeenCalled()
  })

  it("pre-creates a bound stub session when the visitor has no live one (first-visit race)", async () => {
    const c = client(0, null)
    const res = await stitchVisitorToContact(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
      url: "https://site.test/landing?utm_source=news",
      now: new Date(NOW),
    })
    // stub counted as a stitched session
    expect(res.stitchedSessions).toBe(1)
    const created = c.webSession.create.mock.calls[0][0].data
    expect(created).toMatchObject({
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      contactId: "contact-1",
      entryUrl: "https://site.test/landing?utm_source=news",
      utmSource: "news",
    })
    // live-session probe uses the ingest's 30-MINUTE idle window, not the 30-day one
    const probe = c.webSession.findFirst.mock.calls[0][0]
    expect(probe.where.lastSeenAt.gte.getTime()).toBe(NOW - 30 * 60 * 1000)
  })
})

describe("stitchByEmail", () => {
  function client(contact: object | null) {
    return {
      contact: { findFirst: vi.fn().mockResolvedValue(contact) },
      webSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ id: "sess-1" }),
        create: vi.fn(),
      },
    }
  }

  it("matches the contact case-insensitively (stored email may carry uppercase)", async () => {
    const c = client({ id: "contact-9" })
    const res = await stitchByEmail(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      email: "alice@example.com",
    })
    expect(res.stitchedSessions).toBe(1)
    expect(c.contact.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: "org-1",
      email: { equals: "alice@example.com", mode: "insensitive" },
    })
    expect(c.webSession.updateMany.mock.calls[0][0].data).toEqual({ contactId: "contact-9" })
  })

  it("no contact match → silent no-op, nothing written", async () => {
    const c = client(null)
    const res = await stitchByEmail(c as never, {
      organizationId: "org-1",
      visitorId: "Vis1234567890",
      email: "ghost@example.com",
    })
    expect(res.stitchedSessions).toBe(0)
    expect(c.webSession.updateMany).not.toHaveBeenCalled()
  })
})
