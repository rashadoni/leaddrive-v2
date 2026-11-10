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
const db = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, templates: [] as Row[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) => {
        // The row by its own id — how every later read of this channel finds it (resolveWhatsAppConfig).
        if (where.id) return db.rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null
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
    whatsAppTemplate: {
      upsert: vi.fn(async ({ where, create }: Row) => {
        const key = where.organizationId_channelConfigId_name_language
        const found = db.templates.find((t) => t.name === key.name && t.language === key.language && t.channelConfigId === key.channelConfigId)
        if (found) return found
        const row = { ...create }
        db.templates.push(row)
        return row
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
let registerConfirmed = true
let subscribeOk = true
let phoneStatusAfterRegister: string | null = null
// What Graph answers for `is_on_biz_app`. "unreadable" stands for the field not existing or the
// request being refused — which is what we expect from today's live numbers.
let isOnBizApp: boolean | "unreadable" = "unreadable"
let templatesOk = true

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
    if (url.includes("/444555666?fields=is_on_biz_app")) {
      return isOnBizApp === "unreadable"
        ? json({ error: { message: "(#100) Unsupported get request" } }, 400)
        : json({ is_on_biz_app: isOnBizApp, platform_type: "CLOUD_API", id: "444555666" })
    }
    if (url.includes("/111222333/message_templates")) {
      return templatesOk
        ? json({ data: [
            { id: "1", name: "order_received", language: "az", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Sifarişiniz qəbul edildi." }] },
            { id: "2", name: "campaign_update", language: "az", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "{{1}} kampaniyası." }] },
          ] })
        : json({ error: { message: "(#200) You do not have permission" } }, 400)
    }
    if (url.endsWith("/111222333/subscribed_apps")) return subscribeOk ? json({ success: true }) : json({ error: { message: "(#200) no permission" } }, 400)
    if (url.endsWith("/444555666/register")) {
      if (phoneStatusAfterRegister) phoneStatus = phoneStatusAfterRegister
      return registerOk ? json({ success: registerConfirmed }) : json({ error: { message: "(#133005) Two step verification PIN mismatch" } }, 400)
    }
    return json({ error: { message: "unexpected" } }, 404)
  }))
}

const input = { organizationId: "org_a", code: "CODE", wabaId: "111222333", phoneNumberId: "444555666", businessId: "99988877", createdBy: "user_1" }

beforeEach(() => {
  process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID = "2414060595720618"
  process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET = "APP_SECRET"
  process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = "1234567890"
  db.rows.length = 0
  phoneStatus = "PENDING"
  registerOk = true
  registerConfirmed = true
  subscribeOk = true
  phoneStatusAfterRegister = null
  isOnBizApp = "unreadable"
  templatesOk = true
  db.templates.length = 0
  stubGraph()
})

describe("completeEmbeddedSignup", () => {
  it("runs Meta's onboarding in order and saves the channel for this workspace", async () => {
    const result = await completeEmbeddedSignup(input)

    expect(result).toMatchObject({ ok: true, created: true, displayPhoneNumber: "+994 50 123 45 67", verifiedName: "Acme Rent", registration: "registered" })
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /v21.0/oauth/access_token",
      "GET /v21.0/111222333/phone_numbers",
      // Asked on its own newer version, and only once the number is known to be ours to connect.
      "GET /v27.0/444555666",
      "POST /v21.0/111222333/subscribed_apps",
      "POST /v21.0/444555666/register",
      // Last, and only after the channel exists: the account's templates (see the templates test below).
      "GET /v21.0/111222333/message_templates",
    ])
    // The business token rides in the Authorization header on every call after the exchange.
    expect(calls.slice(1).every((c) => c.auth === "Bearer BUSINESS_TOKEN" && !c.url.includes("BUSINESS_TOKEN"))).toBe(true)
    const pin = (calls[4].body as { pin: string }).pin
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

  it("keeps a reconnected row's own App Secret and Verify Token", async () => {
    // LeadDrive's own number: its row's secret verifies the shared callback `?t=leaddrive` for every
    // workspace. Erasing it on a reconnect would reject every WhatsApp callback behind that URL.
    db.rows.push({ id: "ours", organizationId: "org_a", channelType: "whatsapp", isActive: true, phoneNumberId: "444555666", accessToken: "OLD", appSecret: "OWN_SECRET", verifyToken: "OWN_VERIFY", settings: {} })
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: true, created: false })
    expect(db.rows[0]).toMatchObject({ appSecret: "OWN_SECRET", verifyToken: "OWN_VERIFY", accessToken: "BUSINESS_TOKEN" })
  })

  it("does not create an active channel when Meta refuses the registration", async () => {
    registerOk = false
    const result = await completeEmbeddedSignup(input)
    expect(result).toMatchObject({ ok: false, step: "register", error: expect.stringContaining("PIN") })
    expect(db.rows).toEqual([])
  })

  it("leaves the existing connection unchanged when a reconnect registration fails", async () => {
    registerOk = false
    const existing = { id: "ours", organizationId: "org_a", channelType: "whatsapp", isActive: true, phoneNumberId: "444555666", accessToken: "OLD", appSecret: "OWN_SECRET", settings: { replyMode: "agent", registration: "registered" } }
    db.rows.push(structuredClone(existing))
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: false, step: "register" })
    expect(db.rows).toEqual([existing])
  })

  it("does not treat an HTTP 200 without registration success as a connected number", async () => {
    registerConfirmed = false
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: false, step: "register" })
    expect(db.rows).toEqual([])
  })

  it("accepts an already registered number only after Meta confirms CONNECTED on a fresh read", async () => {
    registerOk = false
    phoneStatusAfterRegister = "CONNECTED"
    expect(await completeEmbeddedSignup(input)).toMatchObject({ ok: true, registration: "already_connected" })
    expect(calls.filter((call) => call.url.includes("/phone_numbers"))).toHaveLength(2)
    expect(db.rows[0]).toMatchObject({ isActive: true, accessToken: "BUSINESS_TOKEN" })
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
    const expected = { wabaId: "111222333", phoneNumberId: "444555666", signupEvent: "FINISH", businessId: "99988877" }
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

  it("carries the coexistence completion event through, even without a number", () => {
    // Meta's own example of this event shows `waba_id` alone. A finished dialog must not be read as
    // a failure over a field the server can look up itself (lib/whatsapp-number-onboarding).
    const kept = {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "111222333" },
    }
    expect(readSignupMessage("https://www.facebook.com", kept)).toEqual({
      wabaId: "111222333",
      phoneNumberId: "",
      signupEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      businessId: null,
    })
  })

  it("still refuses a message with no account id, or with a malformed number", () => {
    expect(readSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "444555666" } })).toBeNull()
    expect(readSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "111222333", phone_number_id: "4-4-4" } })).toBeNull()
  })
})

describe("a number that stays in the WhatsApp Business app (coexistence)", () => {
  it("does not register it, and says so on the channel", async () => {
    isOnBizApp = true

    const result = await completeEmbeddedSignup({ ...input, signupEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" })

    // Meta: "skip the phone number registration step, as the number is already registered". There is
    // no undo for touching that registration — the Deregister API refuses such a number.
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false)
    expect(result).toMatchObject({ ok: true, registration: "already_connected", coexistence: true })
    expect(db.rows[0].settings).toMatchObject({
      coexistence: true,
      onboardingMode: "coexistence",
      onboardingReason: "graph_says_business_app",
      isOnBizApp: true,
    })
    // The channel is live and sendable; only the registration call was skipped.
    expect(db.rows[0].isActive).toBe(true)
    expect(db.rows[0].settings).not.toHaveProperty("registrationPin")
  })

  it("believes the dialog when Graph will not answer", async () => {
    isOnBizApp = "unreadable"
    phoneStatus = "PENDING"

    const result = await completeEmbeddedSignup({ ...input, signupEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" })

    expect(result).toMatchObject({ ok: true, coexistence: true })
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false)
    expect(db.rows[0].settings).toMatchObject({ onboardingReason: "signup_event_says_business_app" })
  })

  it("refuses to connect a number Meta describes two ways at once", async () => {
    isOnBizApp = false

    const result = await completeEmbeddedSignup({ ...input, signupEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" })

    expect(result).toMatchObject({ ok: false, step: "platform" })
    // Nothing registered, nothing subscribed, nothing saved: the owner retries instead of owning a
    // channel we cannot describe.
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false)
    expect(calls.some((c) => c.url.endsWith("/subscribed_apps"))).toBe(false)
    expect(db.rows).toEqual([])
  })

  it("finds the number itself when Meta's event named only the account", async () => {
    isOnBizApp = true

    const result = await completeEmbeddedSignup({
      ...input,
      phoneNumberId: null,
      signupEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    })

    expect(result).toMatchObject({ ok: true, coexistence: true, displayPhoneNumber: "+994 50 123 45 67" })
    expect(db.rows[0].phoneNumberId).toBe("444555666")
  })

  it("still registers an ordinary number, exactly as before", async () => {
    // The live path, untouched: no coexistence signal anywhere.
    const result = await completeEmbeddedSignup(input)

    expect(result).toMatchObject({ ok: true, registration: "registered", coexistence: false })
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(true)
    expect(db.rows[0].settings).toMatchObject({ coexistence: false, onboardingReason: "no_signal" })
  })

  it("leaves the workspace able to write first: the account's templates are pulled by connecting", async () => {
    // Not "a sync request was issued": what matters is that the templates exist in the workspace
    // afterwards, bound to the channel that was just created. Writing first is impossible without
    // one, and nothing on the connect screen says a button in settings is part of connecting.
    const result = await completeEmbeddedSignup(input)

    expect(result).toMatchObject({ ok: true, templatesSynced: 2 })
    expect(db.templates.map((t) => `${t.name}/${t.language}/${t.status}`)).toEqual([
      "order_received/az/APPROVED",
      "campaign_update/az/APPROVED",
    ])
    expect(new Set(db.templates.map((t) => t.channelConfigId))).toEqual(new Set([db.rows[0].id]))
    expect(db.templates.every((t) => t.organizationId === "org_a")).toBe(true)
    // The pull is the last step, after the channel exists — it reads the row's own credentials.
    const templatesCall = calls.findIndex((c) => c.url.includes("message_templates"))
    expect(templatesCall).toBe(calls.length - 1)
  })

  it("keeps the connection when Meta refuses the templates", async () => {
    // A template pull that fails is a workspace with no templates yet, not a number that failed to
    // connect: undoing a registered, subscribed, saved channel over it would be the worse answer.
    templatesOk = false

    const result = await completeEmbeddedSignup(input)

    expect(result).toMatchObject({ ok: true, registration: "registered", templatesSynced: null })
    expect(db.rows[0]).toMatchObject({ isActive: true, phoneNumberId: "444555666" })
    expect(db.templates).toEqual([])
  })
})
