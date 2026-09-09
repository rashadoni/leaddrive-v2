import { describe, it, expect, beforeAll } from "vitest"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-do-not-use-in-prod"
  process.env.EMAIL_REPLY_DOMAIN = "leaddrivecrm.org"
})

// Re-import after env is set so module-scope constants pick it up.
async function importModule() {
  return await import("@/lib/email-reply-address")
}

describe("email-reply-address", () => {
  it("builds a tracked ticket address with 10-char hmac suffix", async () => {
    const { buildReplyTo } = await importModule()
    const addr = buildReplyTo({ kind: "ticket", id: "cmo5wa0230001" })
    expect(addr).toMatch(/^ticket\+cmo5wa0230001\.[a-f0-9]{10}@leaddrivecrm\.org$/)
  })

  it("parse round-trips a valid ticket address", async () => {
    const { buildReplyTo, parseReplyTo } = await importModule()
    const addr = buildReplyTo({ kind: "ticket", id: "abc123" })
    const parsed = parseReplyTo(addr)
    expect(parsed).toEqual({ ok: true, kind: "ticket", id: "abc123" })
  })

  it("supports 'Name <addr>' envelopes (RFC 5322)", async () => {
    const { buildReplyTo, parseReplyTo } = await importModule()
    const addr = buildReplyTo({ kind: "ticket", id: "xyz789" })
    const parsed = parseReplyTo(`"LeadDrive CRM" <${addr}>`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.id).toBe("xyz789")
  })

  it("rejects tampered HMAC", async () => {
    const { parseReplyTo } = await importModule()
    const parsed = parseReplyTo("ticket+abc123.0000000000@leaddrivecrm.org")
    expect(parsed).toEqual({ ok: false, reason: "bad_hmac" })
  })

  it("rejects wrong domain", async () => {
    const { signReplyId, parseReplyTo } = await importModule()
    const sig = signReplyId("abc123")
    const parsed = parseReplyTo(`ticket+abc123.${sig}@evil.example`)
    expect(parsed).toEqual({ ok: false, reason: "wrong_domain" })
  })

  it("rejects malformed address", async () => {
    const { parseReplyTo } = await importModule()
    expect(parseReplyTo("not-an-email").ok).toBe(false)
    expect(parseReplyTo("support@leaddrivecrm.org").ok).toBe(false)
    expect(parseReplyTo("ticket+abc@leaddrivecrm.org").ok).toBe(false) // no hmac
  })

  it("contact kind also works", async () => {
    const { buildReplyTo, parseReplyTo } = await importModule()
    const addr = buildReplyTo({ kind: "contact", id: "c42" })
    const parsed = parseReplyTo(addr)
    expect(parsed).toEqual({ ok: true, kind: "contact", id: "c42" })
  })

  it("extractReplyToFromToHeader finds token in multi-address To", async () => {
    const { buildReplyTo, extractReplyToFromToHeader } = await importModule()
    const addr = buildReplyTo({ kind: "ticket", id: "xid" })
    const to = `support@other.com, "LeadDrive" <${addr}>, cc@x.com`
    const found = extractReplyToFromToHeader(to)
    expect(found?.ok).toBe(true)
    if (found?.ok) expect(found.id).toBe("xid")
  })

  it("extractReplyToFromToHeader returns null when no token present", async () => {
    const { extractReplyToFromToHeader } = await importModule()
    expect(extractReplyToFromToHeader("a@b.com, c@d.com")).toBeNull()
  })

  it("is case-insensitive on the address (Gmail normalizes)", async () => {
    const { buildReplyTo, parseReplyTo } = await importModule()
    const addr = buildReplyTo({ kind: "ticket", id: "abcdef" })
    const parsed = parseReplyTo(addr.toUpperCase())
    expect(parsed.ok).toBe(true)
  })
})
