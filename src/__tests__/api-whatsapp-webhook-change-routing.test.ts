vi.mock("@/lib/integrations/whatsapp-events", () => ({ publishWhatsAppIntegrationEvent: vi.fn().mockResolvedValue(undefined) }))
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * One delivery, every change in it.
 *
 * This handler used to read `entry[0].changes[0]` and drop the rest without a word. That was
 * already a quiet bug — Meta batches changes — and coexistence makes it a data-loss bug: the
 * history of a freshly connected number arrives as chunks in batched changes, each deliverable
 * exactly once, and a one-shot synchronisation cannot be asked for again without offboarding the
 * client. So "all changes are processed" and "each is routed by its own `field`" are asserted here,
 * together with the rule that keeps batching safe: a change is only ever processed against the
 * channel its own `phone_number_id` resolves to.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const state = vi.hoisted(() => ({
  configs: [] as Row[],
  statusLookups: [] as string[],
}))

const ingestEcho = vi.hoisted(() => vi.fn(async () => ({ stored: 1, duplicates: 0, revoked: 0, edited: 0, skipped: 0 })))
const applyAccountUpdate = vi.hoisted(() => vi.fn(async () => ({ action: "paused" as const, channels: 1, event: "ACCOUNT_OFFBOARDED" })))
vi.mock("@/lib/inbox/whatsapp-app-echo", () => ({ ingestWhatsAppAppEcho: ingestEcho, BUSINESS_APP_SOURCE: "business_app" }))
vi.mock("@/lib/whatsapp-account-update", () => ({ applyWhatsAppAccountUpdate: applyAccountUpdate, isCloudApiPaused: () => false }))
vi.mock("@/lib/campaigns/whatsapp-dispatch", () => ({ recordWhatsAppCampaignStatus: vi.fn(async () => {}) }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async ({ where }: Row) => (where.slug === "leaddrive" ? { id: "org_leaddrive" } : null)) },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) => {
        if (where.organizationId && !where.OR && !where.phoneNumberId) {
          const ownSecretOnly = Array.isArray(where.NOT)
          return state.configs.find((c) => c.organizationId === where.organizationId && c.isActive && (!ownSecretOnly || !!c.appSecret)) ?? null
        }
        if (where.id) {
          const ids = (where.OR ?? []).map((c: Row) => c.phoneNumberId ?? c.phoneNumber)
          return state.configs.find((c) => c.id === where.id && ids.includes(c.phoneNumberId)) ?? null
        }
        if (where.settings?.path?.[0] === "embeddedSignup") {
          return state.configs.find((c) => c.phoneNumberId === where.phoneNumberId && c.settings?.embeddedSignup === true && c.isActive) ?? null
        }
        return null
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: Row) => {
        state.statusLookups.push(where.organizationId)
        return null
      }),
    },
  },
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), resolveWhatsAppConfig: vi.fn() }))
vi.mock("@/lib/ai/support-feature", () => ({ isSupportAiEnabled: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/whatsapp-media", () => ({ fetchAndStoreWaMedia: vi.fn() }))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: vi.fn() }))
vi.mock("@/lib/ai/pii-masker", () => ({ PiiMasker: class { mask(s: string) { return s } unmask(s: string) { return s } } }))
vi.mock("@/lib/complaint-ai", () => ({ enrichComplaintInBackground: vi.fn() }))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: vi.fn() }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: vi.fn() }))
vi.mock("@/lib/sla-resolver", () => ({ resolveTicketSla: vi.fn(), normalizeTicketPriority: (p: string) => p }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn() }))
vi.mock("@/lib/inbox/reply-mode", () => ({ aiReplyEnabled: vi.fn(() => false) }))
vi.mock("@/lib/ai/support-agent", () => ({ getSupportAgentConfig: vi.fn() }))
vi.mock("@/lib/inbox/ticket-sync", () => ({ syncWhatsAppExchangeToTicket: vi.fn(), appendWhatsAppBotReplyToTicket: vi.fn() }))
vi.mock("@/lib/inbox/complaint-register", () => ({ ensureComplaintRegistered: vi.fn(), notifyComplaintRegistered: vi.fn() }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn() }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

import { POST } from "@/app/api/v1/webhooks/whatsapp/route"

const URL_T = "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=leaddrive"
const SHARED = "SHARED_APP_SECRET"
const OWN_NUMBER = "984538588084578"
const CUSTOMER_NUMBER = "444555666"
const WABA = "102290129340398"

const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

function req(body: string): NextRequest {
  return {
    url: URL_T,
    nextUrl: new URL(URL_T),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sign(body, SHARED) : null) },
  } as unknown as NextRequest
}

const statusChange = (phoneNumberId: string) => ({
  field: "messages",
  value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: "wamid.S", status: "delivered" }] },
})
const echoChange = (phoneNumberId: string, id: string) => ({
  field: "smb_message_echoes",
  value: {
    metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: "994501234567" }],
    message_echoes: [{ from: phoneNumberId, to: "994501234567", id, timestamp: "1794208200", type: "text", text: { body: "ok" } }],
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET = SHARED
  state.statusLookups.length = 0
  state.configs.splice(0, state.configs.length,
    { id: "cfg_ld", organizationId: "org_leaddrive", phoneNumberId: OWN_NUMBER, appSecret: SHARED, verifyToken: "v", isActive: true, settings: {} },
    { id: "cfg_es", organizationId: "org_customer", phoneNumberId: CUSTOMER_NUMBER, appSecret: null, isActive: true, settings: { embeddedSignup: true } },
  )
})
afterEach(() => {
  delete process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
  delete process.env.WHATSAPP_APP_SECRET
})

describe("WhatsApp webhook — every change in a delivery", () => {
  it("processes a second change instead of dropping it", async () => {
    const body = JSON.stringify({ entry: [{ id: WABA, changes: [statusChange(OWN_NUMBER), echoChange(OWN_NUMBER, "wamid.e1")] }] })

    expect((await POST(req(body))).status).toBe(200)

    expect(state.statusLookups).toEqual(["org_leaddrive"])
    expect(ingestEcho).toHaveBeenCalledTimes(1)
  })

  it("processes changes spread across several entries", async () => {
    const body = JSON.stringify({
      entry: [
        { id: WABA, changes: [echoChange(OWN_NUMBER, "wamid.e1")] },
        { id: WABA, changes: [echoChange(OWN_NUMBER, "wamid.e2")] },
      ],
    })

    expect((await POST(req(body))).status).toBe(200)

    expect(ingestEcho).toHaveBeenCalledTimes(2)
    const ids = ingestEcho.mock.calls.map((call) => (call[0] as Row).value.message_echoes[0].id)
    expect(ids).toEqual(["wamid.e1", "wamid.e2"])
  })

  it("hands an echo to the workspace that owns that number, not to the one in the URL", async () => {
    // The shared app posts every WABA to the one callback URL, which carries ?t=leaddrive.
    const body = JSON.stringify({ entry: [{ id: WABA, changes: [echoChange(CUSTOMER_NUMBER, "wamid.e1")] }] })

    expect((await POST(req(body))).status).toBe(200)

    expect(ingestEcho).toHaveBeenCalledWith(expect.objectContaining({
      channel: { id: "cfg_es", organizationId: "org_customer" },
    }))
  })

  it("routes account_update by the Messaging account id, which is the only address it carries", async () => {
    const body = JSON.stringify({
      entry: [{ id: WABA, changes: [{ field: "account_update", value: { event: "ACCOUNT_OFFBOARDED" } }] }],
    })

    expect((await POST(req(body))).status).toBe(200)

    expect(applyAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      wabaId: WABA,
      value: expect.objectContaining({ event: "ACCOUNT_OFFBOARDED" }),
    }))
  })

  it("acknowledges history and contact synchronisation without inventing an import", async () => {
    const body = JSON.stringify({
      entry: [{
        id: WABA,
        changes: [
          { field: "history", value: { metadata: { phone_number_id: OWN_NUMBER }, history: [{ metadata: { phase: 0, chunk_order: 1, progress: 10 }, threads: [] }] } },
          { field: "smb_app_state_sync", value: { metadata: { phone_number_id: OWN_NUMBER }, state_sync: [] } },
        ],
      }],
    })

    // Answering 200 matters: Meta redelivers anything else, and these payloads are one-shot.
    expect((await POST(req(body))).status).toBe(200)
    expect(ingestEcho).not.toHaveBeenCalled()
    expect(state.statusLookups).toEqual([])
  })

  it("keeps going after one change fails", async () => {
    ingestEcho.mockRejectedValueOnce(new Error("boom"))
    const body = JSON.stringify({
      entry: [{ id: WABA, changes: [echoChange(OWN_NUMBER, "wamid.e1"), statusChange(OWN_NUMBER)] }],
    })

    // A redelivery would re-run every change that already succeeded, so one failure must not
    // abandon the rest of the batch.
    expect((await POST(req(body))).status).toBe(200)
    expect(state.statusLookups).toEqual(["org_leaddrive"])
  })

  it("ignores an unsigned delivery before looking at any change", async () => {
    const body = JSON.stringify({ entry: [{ id: WABA, changes: [echoChange(OWN_NUMBER, "wamid.e1")] }] })
    const unsigned = {
      url: URL_T, nextUrl: new URL(URL_T), text: async () => body,
      headers: { get: () => null },
    } as unknown as NextRequest

    expect((await POST(unsigned)).status).toBe(401)
    expect(ingestEcho).not.toHaveBeenCalled()
  })

  it("answers an empty delivery without touching anything", async () => {
    for (const body of [JSON.stringify({}), JSON.stringify({ entry: [] }), JSON.stringify({ entry: [{ id: WABA, changes: [] }] })]) {
      expect((await POST(req(body))).status).toBe(200)
    }
    expect(ingestEcho).not.toHaveBeenCalled()
    expect(applyAccountUpdate).not.toHaveBeenCalled()
  })
})
