// Task 10 (T10a) — webhook two-phase RLS scoping, behavioral pin.
//
// Invokes the REAL route handlers with the REAL rls-context module (AsyncLocalStorage)
// and a prisma mock that captures getRlsContext() AT QUERY TIME — the moment the RLS
// extension hook would fire in production. Pins the invariant for each pattern shape:
//
//   • org-resolution lookup (external identifier → org) runs under { bypass: true }
//   • ALL remaining handler work runs under { orgId: <resolved org> }
//   • secret/signature checks + global-table org existence checks run OUTSIDE any scope
//
// Routes chosen to cover every shape in the sweep:
//   telegram        — whole-handler wrap after a single resolution lookup
//   facebook        — per-entry wrap inside the entry loop (shared-app fan-out)
//   meeting-recap   — SPECIAL: own secret header, org from body.orgId, organizations
//                     existence check stays OUTSIDE scope (global table, no policy)
//   payment-webhooks — provider-row resolution → tenant-scoped event log + dispatch
//   calls/webhook/threecx — org from ?orgId; the channelConfig secret-gate lookup
//                     doubles as resolution (bypass); event switch tenant-scoped
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { getRlsContext, type RlsContext } from "@/lib/rls-context"

/** ctx snapshots keyed by "<model>.<op>", captured when the mock query executes. */
const seen: Array<{ call: string; ctx: RlsContext | undefined }> = []
const cap = (call: string) => seen.push({ call, ctx: getRlsContext() })
const ctxOf = (call: string) => seen.filter((s) => s.call === call).map((s) => s.ctx)

/**
 * Assert the RLS BOUNDARY for a query, not how many times it ran.
 *
 * `expect(ctxOf(x)).toEqual([{ orgId: "org1" }])` also pins the call count, so
 * it broke the moment a second, perfectly tenant-scoped lookup appeared
 * downstream (telegram now hits channelMessage.findFirst in the handler AND in
 * conversation-events). That is a refactor, not a leak — but the red test then
 * says nothing about leaks at all, which is worse than saying less.
 *
 * This demands what actually matters: the query ran, and EVERY execution of it
 * carried the tenant context. One bypass among ten scoped calls still fails.
 */
const expectAllScopedTo = (call: string, orgId: string) => {
  const ctxs = ctxOf(call)
  expect(ctxs.length, `${call} never ran`).toBeGreaterThan(0)
  for (const ctx of ctxs) expect(ctx, `${call} ran outside the tenant scope`).toEqual({ orgId })
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => { cap("organization.findUnique"); return { id: "org1" } }),
    },
    channelConfig: {
      findFirst: vi.fn(async () => {
        cap("channelConfig.findFirst")
        return { id: "ch1", organizationId: "org1", apiKey: "tok", settings: {} }
      }),
      // The facebook webhook resolves the inbound channel with findMany (every active claimant of the
      // pageId, ranked deterministically), so a pageId query must return a row for phase 2 to run.
      findMany: vi.fn(async (args?: { where?: { pageId?: string } }) => {
        cap("channelConfig.findMany")
        return args?.where?.pageId
          ? [{ id: "ch1", organizationId: "org1", channelType: "facebook", pageId: args.where.pageId, isActive: true, apiKey: "tok", settings: {}, createdAt: new Date("2026-01-01T00:00:00Z") }]
          : []
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async () => { cap("channelMessage.findFirst"); return null }),
      create: vi.fn(async () => { cap("channelMessage.create"); return { id: "m1" } }),
      update: vi.fn(async () => { cap("channelMessage.update"); return { id: "m1" } }),
      updateMany: vi.fn(async () => { cap("channelMessage.updateMany"); return { count: 1 } }),
    },
    aiShadowAction: {
      findFirst: vi.fn(async () => { cap("aiShadowAction.findFirst"); return { id: "dup1" } }),
    },
    paymentProvider: {
      findFirst: vi.fn(async () => {
        cap("paymentProvider.findFirst")
        return { id: "prov1", organizationId: "org1", type: "stripe", webhookSecret: "whsec", isActive: true }
      }),
    },
    paymentWebhookEvent: {
      create: vi.fn(async () => { cap("paymentWebhookEvent.create"); return { id: "evtrow1" } }),
      update: vi.fn(async () => { cap("paymentWebhookEvent.update"); return { id: "evtrow1" } }),
    },
    contact: {
      findFirst: vi.fn(async () => { cap("contact.findFirst"); return null }),
    },
    // matchParty falls through to leads when no contact matches. Unmocked, that
    // threw and the webhook answered 200 anyway — which is how the assertions
    // after it ended up guarding nothing.
    lead: {
      findFirst: vi.fn(async () => { cap("lead.findFirst"); return null }),
    },
    callLog: {
      // findOpenCallToClose runs BEFORE the create branch. Without it mocked the
      // call threw, the webhook swallowed the error and still answered 200, and
      // callLog.create was never reached — so the assertion below was checking
      // a write that never happened. null = no open call, take the create path.
      findFirst: vi.fn(async () => { cap("callLog.findFirst"); return null }),
      update: vi.fn(async () => { cap("callLog.update"); return { id: "cl1" } }),
      create: vi.fn(async () => { cap("callLog.create"); return { id: "cl1" } }),
    },
  },
}))

vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation: vi.fn(async () => ({ id: "conv1", assignedTo: null })),
  sendFacebookMessage: vi.fn(),
  sendInstagramMessage: vi.fn(),
}))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ sent: true })),
  chatbotTookOwnership: vi.fn(() => true), // rules-bot owns the turn → AI branch skipped
}))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn(async () => undefined) }))
vi.mock("@/lib/telegram-media", () => ({ fetchAndStoreTelegramMedia: vi.fn(async () => null) }))
vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: vi.fn(async () => true),
  checkAiBudget: vi.fn(async () => ({ allowed: true })),
}))
vi.mock("@/lib/ai/meeting-recap", () => ({
  processMeetingRecap: vi.fn(async () => null), // → "skipped" response after the dedup lookup
  writeMeetingRecapShadowAction: vi.fn(async () => {}),
}))
vi.mock("@/lib/payments", () => ({
  getProvider: vi.fn(() => ({
    parseWebhook: vi.fn(async () => ({ ok: true, externalId: "evt_1", eventType: "unhandled.event", payload: {} })),
  })),
  advanceIntentState: vi.fn(),
}))

// Plain fetch Request + the `nextUrl` field route handlers read (repo test convention).
const asReq = (req: Request) => Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest

beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.MEETING_WEBHOOK_SECRET
})

describe("telegram webhook — whole-handler two-phase", () => {
  // This is the first test in the file to import a route, so it also pays for
  // transforming the route's whole module graph (~2.7 s alone on an idle
  // 8-core box, 4.7 s with a second vitest on the same host). Against the
  // default 5 s budget that is a coin flip on the shared self-hosted runners,
  // and a timeout here says nothing about RLS scoping. 30 s only widens the
  // budget for the cold import; the assertions are unchanged.
  it("bot-token resolution runs bypass; message persistence runs tenant-scoped", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const { POST } = await import("@/app/api/v1/webhooks/telegram/route")
    const res = await POST(asReq(new Request("https://x.test/api/v1/webhooks/telegram?token=bot123", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { chat: { id: 42 }, message_id: 7, from: { first_name: "A" }, text: "hi" } }),
    })))
    expect(res.status).toBe(200)
    expect(ctxOf("channelConfig.findFirst")).toEqual([{ bypass: true }])         // phase 1
    expectAllScopedTo("channelMessage.findFirst", "org1")       // prevMsg lookup
    expectAllScopedTo("channelMessage.create", "org1")          // persistence
    expect(ctxOf("channelMessage.update")).toEqual([{ orgId: "org1" }])          // conversation link
  }, 30_000)
})

describe("facebook webhook — per-entry two-phase", () => {
  it("pageId resolution runs bypass; per-entry processing runs tenant-scoped", async () => {
    process.env.FACEBOOK_APP_SECRET = "fbsecret"
    const { POST } = await import("@/app/api/v1/webhooks/facebook/route")
    const raw = JSON.stringify({
      object: "page",
      entry: [{ id: "page9", messaging: [{ sender: { id: "u1" }, message: { text: "hello" } }] }],
    })
    const { createHmac } = await import("crypto")
    const sig = "sha256=" + createHmac("sha256", "fbsecret").update(raw).digest("hex")
    const res = await POST(asReq(new Request("https://x.test/api/v1/webhooks/facebook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body: raw,
    })))
    expect(res.status).toBe(200)
    expect(ctxOf("channelConfig.findMany")).toEqual([{ bypass: true }])          // phase 1 (per entry)
    expectAllScopedTo("channelMessage.create", "org1")          // phase 2
  })
})

describe("meeting-recap webhook — secret outside, body.orgId tenant scope", () => {
  it("organizations existence check runs UNSCOPED (global table); dedup lookup runs tenant-scoped", async () => {
    process.env.MEETING_WEBHOOK_SECRET = "mrsecret"
    const { POST } = await import("@/app/api/v1/webhooks/meeting-recap/route")
    const res = await POST(asReq(new Request("https://x.test/api/v1/webhooks/meeting-recap", {
      method: "POST",
      headers: { "content-type": "application/json", "x-meeting-webhook-secret": "mrsecret" },
      body: JSON.stringify({ orgId: "org1", providerId: "ff_1", transcript: "t", participants: ["a@b.c"] }),
    })))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ skipped: true, reason: "duplicate providerId" })
    expect(ctxOf("organization.findUnique")).toEqual([undefined])                // outside any scope
    expect(ctxOf("aiShadowAction.findFirst")).toEqual([{ orgId: "org1" }])       // inside tenant scope
  })

  it("rejects a bad secret BEFORE any tenant-scoped work", async () => {
    process.env.MEETING_WEBHOOK_SECRET = "mrsecret"
    const { POST } = await import("@/app/api/v1/webhooks/meeting-recap/route")
    const res = await POST(asReq(new Request("https://x.test/api/v1/webhooks/meeting-recap", {
      method: "POST",
      headers: { "content-type": "application/json", "x-meeting-webhook-secret": "WRONG" },
      body: JSON.stringify({ orgId: "org1", transcript: "t", participants: ["a@b.c"] }),
    })))
    expect(res.status).toBe(401)
    expect(ctxOf("aiShadowAction.findFirst")).toEqual([])                        // nothing tenant-scoped ran
  })
})

describe("threecx call webhook — ?orgId secret-gate resolution bypass, event switch tenant-scoped", () => {
  it("channelConfig secret lookup runs bypass; ringing handler work runs tenant-scoped", async () => {
    // The secret is mandatory, so the gate lookup must return one for the
    // handler body to run at all.
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.channelConfig.findMany).mockImplementationOnce(async () => {
      cap("channelConfig.findMany")
      return [{ id: "ch1", isActive: true, settings: { webhookSecret: "s3cret" } }] as never
    })
    const { POST } = await import("@/app/api/v1/calls/webhook/threecx/route")
    const res = await POST(asReq(new Request("https://x.test/api/v1/calls/webhook/threecx?orgId=org1&secret=s3cret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "call.ringing",
        // A real external caller. "+1234" is extension-length, and
        // threeCxPhoneVariants returns no variants for it, so matchParty
        // short-circuited before contact.findFirst ever ran — the test was
        // asserting a lookup its own fixture prevented.
        call: { callId: "c1", callerNumber: "+994501234567", calleeNumber: "+994505550000", direction: "inbound" },
      }),
    })))
    expect(res.status).toBe(200)
    expect(ctxOf("channelConfig.findMany")).toEqual([{ bypass: true }])         // phase 1 (secret gate IS the resolution)
    expectAllScopedTo("contact.findFirst", "org1")                              // phase 2: contact match
    expectAllScopedTo("callLog.create", "org1")                                 // phase 2: call log write
  })

  it("rejects a bad secret with 401 BEFORE any tenant-scoped work", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.channelConfig.findMany).mockImplementationOnce(async () => {
      cap("channelConfig.findMany")
      return [{ id: "ch1", isActive: true, settings: { webhookSecret: "correct" } }] as never
    })
    const { POST } = await import("@/app/api/v1/calls/webhook/threecx/route")
    const res = await POST(asReq(new Request("https://x.test/api/v1/calls/webhook/threecx?orgId=org1&secret=wrongXX", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "call.ringing", call: { callId: "c1", callerNumber: "+1" } }),
    })))
    expect(res.status).toBe(401)
    expect(ctxOf("channelConfig.findMany")).toEqual([{ bypass: true }])         // gate lookup still bypass
    expect(ctxOf("contact.findFirst")).toEqual([])                               // nothing tenant-scoped ran
    expect(ctxOf("callLog.create")).toEqual([])
  })
})

describe("payment webhook — provider resolution bypass, event log tenant-scoped", () => {
  it("provider row loads under bypass; event create/update run tenant-scoped", async () => {
    const { POST } = await import("@/app/api/v1/payment-webhooks/[provider]/route")
    const res = await POST(
      asReq(new Request("https://x.test/api/v1/payment-webhooks/prov1", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: JSON.stringify({ type: "unhandled.event" }),
      })),
      { params: Promise.resolve({ provider: "prov1" }) },
    )
    expect(res.status).toBe(200)
    expect(ctxOf("paymentProvider.findFirst")).toEqual([{ bypass: true }])       // phase 1
    expect(ctxOf("paymentWebhookEvent.create")).toEqual([{ orgId: "org1" }])     // phase 2
    expect(ctxOf("paymentWebhookEvent.update")).toEqual([{ orgId: "org1" }])     // "ignored" mark
  })
})
