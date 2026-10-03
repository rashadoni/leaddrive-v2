import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * WhatsApp webhook routing for numbers onboarded through Embedded Signup.
 *
 * Meta posts every WABA subscribed to LeadDrive's app to the app's ONE callback URL. That URL carries
 * `?t=leaddrive` (LeadDrive's own number was set up first), so a customer's number arrives addressed to
 * the wrong tenant. It must still land in the customer's workspace — but only when the payload is signed
 * with the shared app's secret, never on the strength of some tenant's own app secret.
 *
 * Observed through the status branch: it resolves the channel, then looks the message up inside the
 * resolved workspace, which is exactly the organization the routing chose.
 */

// A stand-in for Prisma's rows and arguments, which differ per call; typing them is the real client's job.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const state = vi.hoisted(() => ({
  configs: [] as Row[],
  messageLookups: [] as string[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async ({ where }: Row) => (where.slug === "leaddrive" ? { id: "org_leaddrive" } : null)) },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) => {
        // resolveTenantWhatsAppConfig: the tenant's own active row
        if (where.organizationId && !where.OR && !where.phoneNumberId) {
          return state.configs.find((c) => c.organizationId === where.organizationId) ?? null
        }
        // tenant-addressed lookup by id + phone
        if (where.id) {
          const ids = where.OR.map((c: Row) => c.phoneNumberId ?? c.phoneNumber)
          return state.configs.find((c) => c.id === where.id && ids.includes(c.phoneNumberId)) ?? null
        }
        // Embedded Signup lookup
        if (where.settings?.path?.[0] === "embeddedSignup") {
          return state.configs.find((c) => c.phoneNumberId === where.phoneNumberId && c.settings?.embeddedSignup === true && c.isActive) ?? null
        }
        return null
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: Row) => {
        state.messageLookups.push(where.organizationId)
        return null
      }),
    },
  },
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), resolveWhatsAppConfig: vi.fn() }))
vi.mock("@/lib/ai/support-feature", () => ({ isSupportAiEnabled: vi.fn().mockResolvedValue(true) }))
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
vi.mock("@/lib/inbox/ticket-sync", () => ({ syncWhatsAppExchangeToTicket: vi.fn() }))
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
const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
const statusFor = (phoneNumberId: string) => JSON.stringify({
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: "wamid.X", status: "delivered" }] } }] }],
})
function req(body: string, sig: string): NextRequest {
  return {
    url: URL_T, nextUrl: new URL(URL_T),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sig : null) },
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET = SHARED
  state.messageLookups.length = 0
  state.configs.splice(0, state.configs.length,
    // LeadDrive's own number on the same shared app (its row carries that app's secret).
    { id: "cfg_ld", organizationId: "org_leaddrive", phoneNumberId: "984538588084578", appSecret: SHARED, verifyToken: "v", isActive: true, settings: {} },
    // A customer's number onboarded through Embedded Signup.
    { id: "cfg_es", organizationId: "org_customer", phoneNumberId: "444555666", appSecret: null, isActive: true, settings: { embeddedSignup: true } },
    // A customer's manually configured number — not onboarded through the shared app.
    { id: "cfg_manual", organizationId: "org_manual", phoneNumberId: "777888999", appSecret: "THEIR_OWN", isActive: true, settings: {} },
  )
})
afterEach(() => {
  delete process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
  delete process.env.WHATSAPP_APP_SECRET
})

describe("WhatsApp webhook — Embedded Signup numbers behind the shared callback", () => {
  it("routes a customer's Embedded Signup number to the customer's workspace", async () => {
    const body = statusFor("444555666")
    expect((await POST(req(body, sign(body, SHARED)))).status).toBe(200)
    expect(state.messageLookups).toEqual(["org_customer"])
  })

  it("still routes LeadDrive's own number to LeadDrive", async () => {
    const body = statusFor("984538588084578")
    expect((await POST(req(body, sign(body, SHARED)))).status).toBe(200)
    expect(state.messageLookups).toEqual(["org_leaddrive"])
  })

  it("never resolves a number that was not onboarded through Embedded Signup", async () => {
    const body = statusFor("777888999")
    expect((await POST(req(body, sign(body, SHARED)))).status).toBe(200)
    expect(state.messageLookups).toEqual([])
  })

  it("does not unlock Embedded Signup numbers when the shared app secret is not configured", async () => {
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
    const body = statusFor("444555666")
    // Signed with the tenant's own secret (which here equals the shared one), but the server does not
    // know it as the shared app's: the customer's number stays unresolved.
    expect((await POST(req(body, sign(body, SHARED)))).status).toBe(200)
    expect(state.messageLookups).toEqual([])
  })

  it("is not unlocked by the older WHATSAPP_APP_SECRET either", async () => {
    // That variable verifies callbacks without `?t=`; it says nothing about Embedded Signup numbers.
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
    process.env.WHATSAPP_APP_SECRET = SHARED
    const body = statusFor("444555666")
    expect((await POST(req(body, sign(body, SHARED)))).status).toBe(200)
    expect(state.messageLookups).toEqual([])
  })
})
