import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Проверить приём сообщений» (lib/whatsapp-delivery-check): why a WhatsApp number's messages do or
 * do not reach the CRM, asked of Meta. Found 2026-11-22: a test message to a client's number never
 * arrived, the row was active, the webhook had rejected nothing — and nothing in the CRM could say
 * whether Meta had stopped sending or why.
 *
 * Meta is a stand-in that answers the four reads the way Graph does, per number; the number rows
 * are an in-memory table; everything between them — the reads, the verdict, the one write — is real.
 */
const TOKEN = "EAAG-secret-token-value"
const OUR_APP = "2414060595720618"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ channels: [] as Array<Record<string, unknown>>, messages: [] as Array<Record<string, unknown>> }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        db.channels.find((row) => row.id === where.id && row.organizationId === where.organizationId && row.channelType === where.channelType) ?? null),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        db.messages
          .filter((m) => m.organizationId === where.organizationId && m.channelConfigId === where.channelConfigId && m.direction === "inbound" && m.historyImportedAt === null)
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null),
    },
  },
}))

import { assessWhatsAppDelivery, checkWhatsAppDelivery, isOurCallbackHost, resubscribeWhatsAppDelivery, type DeliveryFacts } from "@/lib/whatsapp-delivery-check"

/** What Meta holds about one number; the stub answers from it. */
type MetaState = {
  status?: string
  tokenValid?: boolean
  subscribed?: Array<{ id: string; name: string; override?: string }>
  hooks?: { phone_number?: string; whatsapp_business_account?: string; application?: string } | "unreadable"
  platform?: string
  acceptsSubscribe?: boolean
}
let meta: MetaState
let requests: Array<{ method: string; url: string; auth: string | null }>

function stubMeta() {
  requests = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || "GET"
    const auth = ((init?.headers || {}) as Record<string, string>).Authorization || null
    requests.push({ method, url, auth })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (meta.tokenValid === false) {
      return json({ error: { message: `Error validating access token: Session has expired. access_token=${TOKEN}`, code: 190 } }, 401)
    }
    if (url.endsWith("/waba-1/subscribed_apps") && method === "POST") {
      if (meta.acceptsSubscribe === false) return json({ error: { message: "(#200) Permissions error" } }, 400)
      meta.subscribed = [{ id: OUR_APP, name: "LeadDrive" }]
      if (meta.hooks && meta.hooks !== "unreadable") delete meta.hooks.whatsapp_business_account
      return json({ success: true })
    }
    if (url.endsWith("/waba-1/subscribed_apps")) {
      return json({ data: (meta.subscribed ?? []).map((app) => ({ whatsapp_business_api_data: { id: app.id, name: app.name, link: "https://example.test" }, ...(app.override ? { override_callback_uri: app.override } : {}) })) })
    }
    if (url.includes("/phone-1?fields=status")) return json({ status: meta.status ?? "CONNECTED", id: "phone-1" })
    if (url.includes("/phone-1?fields=platform_type")) return json({ platform_type: meta.platform ?? "CLOUD_API", id: "phone-1" })
    if (url.includes("/phone-1?fields=webhook_configuration")) {
      return meta.hooks === "unreadable"
        ? json({ error: { message: "(#100) Tried accessing nonexisting field (webhook_configuration)" } }, 400)
        : json({ webhook_configuration: meta.hooks ?? { application: "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=leaddrive" }, id: "phone-1" })
    }
    if (url.includes("/app?fields=id")) return json({ id: "customer-own-app" })
    return json({ error: { message: "unexpected" } }, 404)
  }))
}

function number(overrides: Row = {}): Row {
  return {
    id: "wa-1", organizationId: "org-zeytun", channelType: "whatsapp", configName: "Zeytun Pharmaceuticals", isActive: true,
    accessToken: TOKEN, apiKey: null, phoneNumberId: "phone-1", phoneNumber: null, businessAccountId: "waba-1", webhookUrl: null,
    settings: { embeddedSignup: true },
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_APP_ID", OUR_APP)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.leaddrivecrm.org")
  db.channels = [number()]
  db.messages = []
  meta = { subscribed: [{ id: OUR_APP, name: "LeadDrive" }] }
  stubMeta()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const check = () => checkWhatsAppDelivery("org-zeytun", "wa-1")

describe("the delivery check of a WhatsApp number", () => {
  it("says delivery works for a connected number whose account our app is subscribed to", async () => {
    db.messages.push({ organizationId: "org-zeytun", channelConfigId: "wa-1", direction: "inbound", historyImportedAt: null, createdAt: new Date("2026-10-26T18:20:00Z") })

    const view = await check()

    expect(view).toMatchObject({
      verdict: "ok", subscribed: true, canResubscribe: false,
      number: { status: "CONNECTED", platformType: "CLOUD_API" },
      subscribedApps: ["LeadDrive"],
      callback: { host: "app.leaddrivecrm.org", level: "application", ours: true },
      lastInboundAt: "2026-10-26T18:20:00.000Z",
      metaError: null,
    })
  })

  it("names a missing subscription — the case where Meta simply sends nothing — and offers to subscribe again", async () => {
    meta.subscribed = []

    expect(await check()).toMatchObject({ verdict: "not_subscribed", subscribed: false, canResubscribe: true, lastInboundAt: null })
  })

  it("does not take another app's subscription for ours", async () => {
    meta.subscribed = [{ id: "someone-elses-app", name: "Other CRM" }]

    expect(await check()).toMatchObject({ verdict: "not_subscribed", subscribed: false, subscribedApps: ["Other CRM"], canResubscribe: true })
  })

  it("says a number that is not connected to Cloud API is the reason, whatever the subscription", async () => {
    meta.status = "PENDING"

    const view = await check()

    expect(view).toMatchObject({ verdict: "number_not_connected", number: { status: "PENDING" }, canResubscribe: false })
  })

  it("names the address Meta really sends to when the account carries an override, and can clear that one", async () => {
    meta.hooks = { whatsapp_business_account: "https://hooks.other-crm.example/wa", application: "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp" }

    expect(await check()).toMatchObject({ verdict: "callback_elsewhere", callback: { host: "hooks.other-crm.example", level: "account", ours: false }, canResubscribe: true })
  })

  it("does not offer to subscribe again for an override set on the number itself: that would not move it", async () => {
    meta.hooks = { phone_number: "https://relay.example.net/hook", application: "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp" }

    expect(await check()).toMatchObject({ verdict: "callback_elsewhere", callback: { host: "relay.example.net", level: "number" }, canResubscribe: false })
  })

  it("accepts a workspace's own subdomain as ours", async () => {
    meta.hooks = { whatsapp_business_account: "https://zeytun.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=zeytun" }

    expect(await check()).toMatchObject({ verdict: "ok", callback: { host: "zeytun.leaddrivecrm.org", ours: true } })
    expect(isOurCallbackHost("leaddrivecrm.org.evil.example", "app.leaddrivecrm.org")).toBe(false)
  })

  it("still reads the account's override from the subscription when Meta will not show the number's callbacks", async () => {
    meta.hooks = "unreadable"
    meta.subscribed = [{ id: OUR_APP, name: "LeadDrive", override: "https://hooks.other-crm.example/wa" }]

    expect(await check()).toMatchObject({ verdict: "callback_elsewhere", callback: { host: "hooks.other-crm.example", level: "account" }, canResubscribe: true })

    meta.subscribed = [{ id: OUR_APP, name: "LeadDrive" }]
    expect(await check()).toMatchObject({ verdict: "ok", callback: null })
  })

  it("finds whose app the token is for a number connected by hand", async () => {
    db.channels = [number({ settings: {} })]
    meta.subscribed = [{ id: "customer-own-app", name: "Zeytun app" }]

    expect(await check()).toMatchObject({ verdict: "ok", subscribed: true })
    expect(requests.some((request) => request.url.includes("/app?fields=id"))).toBe(true)
  })

  it("reports Meta's refusal in Meta's words, without the token", async () => {
    meta.tokenValid = false

    const view = await check()

    expect(view).toMatchObject({ verdict: "meta_refused", subscribed: null, canResubscribe: false })
    expect(view!.metaError).toContain("Session has expired")
    expect(JSON.stringify(view)).not.toContain(TOKEN)
  })

  it("never puts the token in a URL or in the answer", async () => {
    const view = await check()

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.auth === `Bearer ${TOKEN}` && !request.url.includes(TOKEN))).toBe(true)
    expect(JSON.stringify(view)).not.toContain(TOKEN)
  })

  it("asks Meta nothing for a number Meta has paused, or one with no key saved", async () => {
    db.channels = [number({ settings: { embeddedSignup: true, cloudApiPaused: true } })]
    expect(await check()).toMatchObject({ verdict: "paused", canResubscribe: false })

    db.channels = [number({ accessToken: null })]
    expect(await check()).toMatchObject({ verdict: "not_configured" })
    expect(requests).toEqual([])
  })

  it("does not find another workspace's number, or a channel that is not WhatsApp", async () => {
    expect(await checkWhatsAppDelivery("org-other", "wa-1")).toBeNull()
    db.channels = [number({ channelType: "telegram" })]
    expect(await check()).toBeNull()
    expect(requests).toEqual([])
  })
})

describe("subscribing a number's account again", () => {
  it("subscribes when that is what is wrong, and answers with the check run again", async () => {
    meta.subscribed = []

    const result = await resubscribeWhatsAppDelivery("org-zeytun", "wa-1")

    expect(requests.filter((request) => request.method === "POST").map((request) => request.url)).toEqual(["https://graph.facebook.com/v21.0/waba-1/subscribed_apps"])
    expect(result).toMatchObject({ ok: true, view: { verdict: "ok", subscribed: true, canResubscribe: false } })
  })

  it("clears an account-level override by subscribing again", async () => {
    meta.hooks = { whatsapp_business_account: "https://hooks.other-crm.example/wa", application: "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp" }

    expect(await resubscribeWhatsAppDelivery("org-zeytun", "wa-1")).toMatchObject({ ok: true, view: { verdict: "ok", callback: { host: "app.leaddrivecrm.org", level: "application" } } })
  })

  it("writes nothing to Meta for a number whose delivery works", async () => {
    const result = await resubscribeWhatsAppDelivery("org-zeytun", "wa-1")

    expect(result).toMatchObject({ ok: false, reason: "nothing_to_fix", view: { verdict: "ok" } })
    expect(requests.some((request) => request.method === "POST")).toBe(false)
  })

  it("writes nothing for a number that is not connected: subscribing would not connect it", async () => {
    meta.status = "DISCONNECTED"
    meta.subscribed = []

    expect(await resubscribeWhatsAppDelivery("org-zeytun", "wa-1")).toMatchObject({ ok: false, reason: "nothing_to_fix", view: { verdict: "number_not_connected" } })
    expect(requests.some((request) => request.method === "POST")).toBe(false)
  })

  it("says so when Meta refuses the subscription", async () => {
    meta.subscribed = []
    meta.acceptsSubscribe = false

    expect(await resubscribeWhatsAppDelivery("org-zeytun", "wa-1")).toMatchObject({ ok: false, reason: "meta_refused", error: expect.stringContaining("Permissions error"), view: { verdict: "not_subscribed" } })
  })

  it("does not reach another workspace's number", async () => {
    meta.subscribed = []

    expect(await resubscribeWhatsAppDelivery("org-other", "wa-1")).toEqual({ ok: false, reason: "not_found" })
    expect(requests).toEqual([])
  })
})

describe("what the facts mean", () => {
  const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
    number: { readable: true, status: "CONNECTED", platformType: "CLOUD_API", error: null },
    subscription: { readable: true, apps: [{ id: "app", name: "App", overrideHost: null }], ourAppId: "app", error: null },
    callbacks: { readable: false, numberHost: null, accountHost: null, applicationHost: null },
    ...over,
  })

  it("does not call an unreadable number «not connected»", () => {
    const unread = facts({ number: { readable: false, status: null, platformType: null, error: "(#100) nope" } })
    expect(assessWhatsAppDelivery(unread, "app.leaddrivecrm.org")).toMatchObject({ verdict: "ok_number_unread", subscribed: true })
  })

  it("does not call an unreadable subscription «not subscribed»", () => {
    const unread = facts({ subscription: { readable: false, apps: [], ourAppId: null, error: "(#200) nope" } })
    expect(assessWhatsAppDelivery(unread, "app.leaddrivecrm.org")).toMatchObject({ verdict: "ok", subscribed: null, canResubscribe: false })
  })

  it("puts the number's own override before the account's, and the account's before the app's", () => {
    const all = facts({ callbacks: { readable: true, numberHost: "n.example", accountHost: "a.example", applicationHost: "app.leaddrivecrm.org" } })
    expect(assessWhatsAppDelivery(all, "app.leaddrivecrm.org").callback).toEqual({ host: "n.example", level: "number", ours: false })
    const account = facts({ callbacks: { readable: true, numberHost: null, accountHost: "a.example", applicationHost: "app.leaddrivecrm.org" } })
    expect(assessWhatsAppDelivery(account, "app.leaddrivecrm.org").callback).toEqual({ host: "a.example", level: "account", ours: false })
  })
})
