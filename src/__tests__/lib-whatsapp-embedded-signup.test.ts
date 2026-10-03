import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * WhatsApp Embedded Signup, server side (lib/whatsapp-embedded-signup).
 *
 * The browser hands over a code and two ids it read from Meta's window message; nothing but the token
 * the code exchanges into proves which assets the customer granted. So the properties under test are:
 * the number is checked against the token's WABA before anything is saved, another workspace's number
 * is never taken over, the steps run in Meta's order and a failed registration is reported rather than
 * hidden — and the token never travels in a URL we build ourselves except the documented exchange.
 */

// A stand-in for Prisma's rows and arguments, which differ per call; typing them is the real client's job.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) => {
        const ids = (where.OR || []).map((c: Row) => c.phoneNumberId ?? c.phoneNumber)
        return db.rows.find((r) =>
          r.channelType === where.channelType
          && (where.isActive === undefined || r.isActive === where.isActive)
          && (typeof where.organizationId === "string" ? r.organizationId === where.organizationId : r.organizationId !== where.organizationId?.not)
          && ids.includes(r.phoneNumberId),
        ) ?? null
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const r = db.rows.find((x) => x.id === where.id)!
        Object.assign(r, data)
        return r
      }),
      create: vi.fn(async ({ data }: Row) => {
        const r = { id: `wa_${++db.seq}`, ...data }
        db.rows.push(r)
        return { id: r.id }
      }),
    },
  },
}))

import { completeEmbeddedSignup } from "@/lib/whatsapp-embedded-signup"
import { readSignupMessage } from "@/components/channels/whatsapp-embedded-signup"
import { decryptToken } from "@/lib/secure-token"

type Call = { url: string; method: string; auth: string | null; body: unknown }
let calls: Call[] = []
let phoneStatus = "PENDING"
let registerOk = true
let subscribeOk = true

function stubGraph() {
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers || {}) as Record<string, string>
    calls.push({ url, method: init?.method || "GET", auth: headers.Authorization || null, body: init?.body ? JSON.parse(String(init.body)) : null })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.includes("/oauth/access_token?")) return json({ access_token: "BUSINESS_TOKEN", token_type: "bearer" })
    if (url.includes("/111222333/phone_numbers")) {
      return json({ data: [{ id: "444555666", display_phone_number: "+994 50 123 45 67", verified_name: "Acme Rent", status: phoneStatus }] })
    }
    if (url.endsWith("/111222333/subscribed_apps")) return subscribeOk ? json({ success: true }) : json({ error: { message: "(#200) no permission" } }, 400)
    if (url.endsWith("/444555666/register")) return registerOk ? json({ success: true }) : json({ error: { message: "(#133005) Two step verification PIN mismatch" } }, 400)
    return json({ error: { message: "unexpected" } }, 404)
  }))
}

const input = { organizationId: "org_a", code: "CODE", wabaId: "111222333", phoneNumberId: "444555666", businessId: "99988877", createdBy: "user_1" }

beforeEach(() => {
  process.env.WHATSAPP_APP_ID = "2414060595720618"
  process.env.WHATSAPP_APP_SECRET = "APP_SECRET"
  process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = "1234567890"
  db.rows.length = 0
  phoneStatus = "PENDING"
  registerOk = true
  subscribeOk = true
  stubGraph()
})

describe("completeEmbeddedSignup", () => {
  it("runs Meta's onboarding in order and saves the channel for this workspace", async () => {
    const result = await completeEmbeddedSignup(input)

    expect(result).toMatchObject({ ok: true, created: true, displayPhoneNumber: "+994 50 123 45 67", verifiedName: "Acme Rent", registration: "registered" })
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /v21.0/oauth/access_token",
      "GET /v21.0/111222333/phone_numbers",
      "POST /v21.0/111222333/subscribed_apps",
      "POST /v21.0/444555666/register",
    ])
    // The business token rides in the Authorization header on every call after the exchange.
    expect(calls.slice(1).every((c) => c.auth === "Bearer BUSINESS_TOKEN" && !c.url.includes("BUSINESS_TOKEN"))).toBe(true)
    const pin = (calls[3].body as { pin: string }).pin
    expect(pin).toMatch(/^\d{6}$/)

    const row = db.rows[0]
    expect(row).toMatchObject({
      organizationId: "org_a", channelType: "whatsapp", isActive: true, accessToken: "BUSINESS_TOKEN",
      phoneNumberId: "444555666", businessAccountId: "111222333", displayName: "Acme Rent", appSecret: null,
    })
    expect(row.settings).toMatchObject({ embeddedSignup: true, businessId: "99988877", registration: "registered" })
    // The PIN is the number's two-step verification PIN: kept, but only encrypted.
    expect(row.settings.registrationPin).not.toBe(pin)
    expect(decryptToken(row.settings.registrationPin, "whatsapp-registration-pin")).toBe(pin)
  })

  it("does not re-register a number Meta already reports as CONNECTED", async () => {
    phoneStatus = "CONNECTED"
    const result = await completeEmbeddedSignup(input)
    expect(result).toMatchObject({ ok: true, registration: "already_connected" })
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false)
    expect(db.rows[0].settings).not.toHaveProperty("registrationPin")
  })

  it("refuses a number that is not in the WABA the token was granted for", async () => {
    const result = await completeEmbeddedSignup({ ...input, phoneNumberId: "777888999" })
    expect(result).toMatchObject({ ok: false, step: "ownership" })
    expect(calls.some((c) => c.url.endsWith("/subscribed_apps"))).toBe(false)
    expect(db.rows).toEqual([])
  })

  it("does not take over a number another workspace has connected", async () => {
    db.rows.push({ id: "theirs", organizationId: "org_b", channelType: "whatsapp", isActive: true, phoneNumberId: "444555666", settings: {} })
    const result = await completeEmbeddedSignup(input)
    expect(result).toMatchObject({ ok: false, step: "conflict" })
    expect(calls.some((c) => c.url.endsWith("/subscribed_apps"))).toBe(false)
    expect(db.rows.map((r) => r.organizationId)).toEqual(["org_b"])
  })

  it("refreshes the workspace's own row on a reconnect instead of adding a second one", async () => {
    db.rows.push({ id: "ours", organizationId: "org_a", channelType: "whatsapp", isActive: false, phoneNumberId: "444555666", accessToken: "OLD", settings: { replyMode: "agent" } })
    const result = await completeEmbeddedSignup(input)
    expect(result).toMatchObject({ ok: true, created: false, channelId: "ours" })
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ isActive: true, accessToken: "BUSINESS_TOKEN" })
    expect(db.rows[0].settings).toMatchObject({ replyMode: "agent", embeddedSignup: true })
  })

  it("saves the channel but says so when Meta refuses the registration", async () => {
    registerOk = false
    const result = await completeEmbeddedSignup(input)
    expect(result).toMatchObject({ ok: true, registration: "failed", registrationError: expect.stringContaining("PIN") })
    expect(db.rows[0].settings).toMatchObject({ registration: "failed" })
    expect(db.rows[0].settings).not.toHaveProperty("registrationPin")
  })

  it("stops before saving anything when the webhook subscription is refused", async () => {
    subscribeOk = false
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: false, step: "subscribe" })
    expect(db.rows).toEqual([])
  })

  it("is off without the server configuration", async () => {
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: false, step: "config" })
    expect(calls).toEqual([])
  })
})

describe("readSignupMessage (browser side)", () => {
  const finish = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "111222333", phone_number_id: "444555666", business_id: "99988877" } }

  it("reads Meta's FINISH message, as an object or as a JSON string", () => {
    const expected = { wabaId: "111222333", phoneNumberId: "444555666", businessId: "99988877" }
    expect(readSignupMessage("https://www.facebook.com", finish)).toEqual(expected)
    expect(readSignupMessage("https://web.facebook.com", JSON.stringify(finish))).toEqual(expected)
  })

  it("ignores the same message from any other origin", () => {
    expect(readSignupMessage("https://evil.example", finish)).toBeNull()
    expect(readSignupMessage("https://facebook.com.evil.example", finish)).toBeNull()
  })

  it("reports a cancel and ignores unrelated messages", () => {
    expect(readSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} })).toBe("cancel")
    expect(readSignupMessage("https://www.facebook.com", { type: "something-else" })).toBeNull()
  })
})
