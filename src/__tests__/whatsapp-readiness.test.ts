import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * What a connected WhatsApp number can do today (lib/whatsapp-readiness).
 *
 * The facts come from Meta and are written exactly as Meta returns them, including the lower-case
 * `verified` / `not_verified` of the account node and the upper-case `GREEN` / `TIER_250` of the
 * number node. The payloads below are the shapes read from the live accounts of this install on
 * 2026-11-10, so the test fails if the derivation stops matching what Meta actually says.
 *
 * The distinction under test is the one a tenant acts on: `blocked` means nothing goes out right
 * now, `warn` means the line works with a ceiling the customer can lift. Calling an unverified
 * business "not connected" would send every new tenant to support on their first day.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ rows: [] as Row[], templates: [] as Row[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) =>
        db.rows.find((r) => r.id === where.id && r.organizationId === where.organizationId && r.isActive) ?? null),
    },
    whatsAppTemplate: {
      count: vi.fn(async ({ where }: Row) =>
        db.templates.filter((t) =>
          t.organizationId === where.organizationId
          && t.channelConfigId === where.channelConfigId
          && t.status === where.status).length),
    },
  },
}))

import { deriveWhatsAppReadiness, readWhatsAppReadiness, type WhatsAppNumberFacts } from "@/lib/whatsapp-readiness"

const facts = (patch: Partial<WhatsAppNumberFacts> = {}): WhatsAppNumberFacts => ({
  status: "CONNECTED",
  codeVerificationStatus: "VERIFIED",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_1K",
  nameStatus: "APPROVED",
  verifiedName: "Zeytun Pharmaceuticals",
  displayPhoneNumber: "+994 99 301 29 14",
  accountReviewStatus: "APPROVED",
  businessVerificationStatus: "verified",
  approvedTemplates: 7,
  cloudApiPaused: false,
  ...patch,
})

const state = (items: ReturnType<typeof deriveWhatsAppReadiness>["items"], id: string) =>
  items.find((item) => item.id === id)?.state

describe("deriveWhatsAppReadiness", () => {
  it("calls a fully set up number ready, with nothing left to do", () => {
    const { ready, items } = deriveWhatsAppReadiness(facts())

    expect(ready).toBe(true)
    expect(items.every((item) => item.state === "ok")).toBe(true)
  })

  it("keeps the live account working while naming its ceiling", () => {
    // Exactly what Meta returned for this install's three accounts on 2026-11-10: the account is
    // approved, the business behind it is not verified, so the number is capped at 250 recipients a
    // day. Reading that as a broken connection is the mistake this test exists to prevent.
    const { ready, items } = deriveWhatsAppReadiness(
      facts({ businessVerificationStatus: "not_verified", messagingLimitTier: "TIER_250" }),
    )

    expect(ready).toBe(true)
    expect(state(items, "connection")).toBe("ok")
    expect(state(items, "businessVerification")).toBe("warn")
    expect(state(items, "messagingLimit")).toBe("warn")
    // And the tenant is shown Meta's own word for it, not our paraphrase.
    expect(items.find((i) => i.id === "businessVerification")?.value).toBe("not_verified")
  })

  it("blocks only what really stops a message", () => {
    expect(deriveWhatsAppReadiness(facts({ cloudApiPaused: true })).ready).toBe(false)
    expect(deriveWhatsAppReadiness(facts({ status: "PENDING" })).ready).toBe(false)
    expect(deriveWhatsAppReadiness(facts({ accountReviewStatus: "REJECTED" })).ready).toBe(false)

    // These do not stop a message, so they must not read as "cannot send".
    expect(deriveWhatsAppReadiness(facts({ qualityRating: "RED" })).ready).toBe(true)
    expect(deriveWhatsAppReadiness(facts({ nameStatus: "DECLINED" })).ready).toBe(true)
    expect(deriveWhatsAppReadiness(facts({ approvedTemplates: 0 })).ready).toBe(true)
  })

  it("says a workspace with no approved template cannot write first", () => {
    const { items } = deriveWhatsAppReadiness(facts({ approvedTemplates: 0 }))
    expect(state(items, "templates")).toBe("warn")
    expect(items.find((i) => i.id === "templates")?.value).toBe("0")
  })

  it("does not invent a problem out of a field Meta did not return", () => {
    // Graph refuses the whole read over one unknown field, so the narrower retry leaves these null.
    const { ready, items } = deriveWhatsAppReadiness(
      facts({ messagingLimitTier: null, nameStatus: null, businessVerificationStatus: null, qualityRating: null }),
    )

    expect(ready).toBe(true)
    expect(state(items, "quality")).toBe("ok")
    expect(items.every((item) => item.state !== "blocked")).toBe(true)
  })

  it("treats a paused number as unable to send whatever else Meta says", () => {
    const { ready, items } = deriveWhatsAppReadiness(facts({ cloudApiPaused: true }))
    expect(ready).toBe(false)
    expect(state(items, "connection")).toBe("blocked")
    expect(items.find((i) => i.id === "connection")?.value).toBe("PAUSED")
  })
})

type Call = { url: string; auth: string | null }
let calls: Call[] = []
let fullFieldsOk = true

function stubGraph() {
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const headers = (init?.headers || {}) as Record<string, string>
    calls.push({ url, auth: headers.Authorization || null })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

    if (url.includes("/444555666?")) {
      if (url.includes("messaging_limit_tier") && !fullFieldsOk) {
        return json({ error: { message: "(#100) Tried accessing nonexisting field (messaging_limit_tier)" } }, 400)
      }
      return json({
        id: "444555666",
        verified_name: "Zeytun Pharmaceuticals",
        display_phone_number: "+994 99 301 29 14",
        quality_rating: "GREEN",
        status: "CONNECTED",
        ...(url.includes("messaging_limit_tier")
          ? { messaging_limit_tier: "TIER_1K", name_status: "APPROVED", code_verification_status: "VERIFIED" }
          : {}),
      })
    }
    if (url.includes("/111222333?")) {
      return json({ id: "111222333", name: "Zeytun Pharmaceuticals - Lead Drive", account_review_status: "APPROVED", business_verification_status: "not_verified" })
    }
    return json({ error: { message: "unexpected" } }, 404)
  }))
}

beforeEach(() => {
  db.rows.length = 0
  db.templates.length = 0
  db.rows.push({
    id: "wa_1", organizationId: "org_a", isActive: true, accessToken: "BUSINESS_TOKEN",
    phoneNumberId: "444555666", businessAccountId: "111222333", settings: {},
  })
  fullFieldsOk = true
  stubGraph()
})

describe("readWhatsAppReadiness", () => {
  it("reads the number and the account it belongs to, with the channel's own token", async () => {
    db.templates.push(
      { organizationId: "org_a", channelConfigId: "wa_1", status: "APPROVED" },
      { organizationId: "org_a", channelConfigId: "wa_1", status: "PENDING" },
      { organizationId: "org_a", channelConfigId: "wa_2", status: "APPROVED" },
    )

    const result = await readWhatsAppReadiness("org_a", "wa_1")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.facts).toMatchObject({
      status: "CONNECTED", qualityRating: "GREEN", messagingLimitTier: "TIER_1K",
      businessVerificationStatus: "not_verified", accountReviewStatus: "APPROVED",
      // Only this channel's approved templates — not another number's, not a pending one.
      approvedTemplates: 1,
    })
    expect(result.ready).toBe(true)
    expect(calls.every((c) => c.auth === "Bearer BUSINESS_TOKEN" && !c.url.includes("BUSINESS_TOKEN"))).toBe(true)
  })

  it("still answers when Meta refuses one of the fields", async () => {
    // One unknown field fails the whole read; a narrower retry is worth more to a tenant than an
    // error naming a field they have never heard of.
    fullFieldsOk = false

    const result = await readWhatsAppReadiness("org_a", "wa_1")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.facts).toMatchObject({ status: "CONNECTED", qualityRating: "GREEN", messagingLimitTier: null })
    expect(result.ready).toBe(true)
    expect(calls.filter((c) => c.url.includes("/444555666?")).length).toBe(2)
  })

  it("does not answer for another workspace's channel", async () => {
    const result = await readWhatsAppReadiness("org_b", "wa_1")
    expect(result).toEqual({ ok: false, error: "WhatsApp not configured" })
  })
})
