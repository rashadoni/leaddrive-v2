/**
 * The WhatsApp webhook and the demo's live thread
 * (src/lib/demo-center/demo-whatsapp-agent.ts). A message the demo's agent
 * takes is stored like any other and then goes no further: no ticket, no
 * reopened ticket, no rule bot, no support AI — the prospect would otherwise
 * get two answers and the owner's Service Desk a ticket for demo chatter.
 * Every other message takes the ordinary path, untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

const db: {
  orgId: string | null
  appSecret: string | null
  phoneNumberId: string
  existingCall: { id: string; notes?: string | null } | null
  pendingOutboundCall: { id: string; notes?: string | null } | null
  contactId: string | null
} = {
  orgId: "org_1",
  appSecret: "ACME_SECRET",
  phoneNumberId: "phone_1",
  existingCall: null,
  pendingOutboundCall: null,
  contactId: "contact_1",
}

type MockFindUniqueArgs = { where?: { slug?: string } }
type MockFindFirstArgs = { where?: Record<string, unknown> & { OR?: Array<{ phoneNumberId?: string; phoneNumber?: string }> } }
type MockWriteArgs = { data: Record<string, unknown> }
type MockTenantCallback = () => unknown

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async ({ where }: MockFindUniqueArgs) => (db.orgId && where?.slug === "acme" ? { id: db.orgId } : null)),
    },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: MockFindFirstArgs) => {
        if (!db.orgId) return null
        if (where?.id === "cfg_wa") {
          const phoneId = where?.OR?.[0]?.phoneNumberId || where?.OR?.[1]?.phoneNumber
          return phoneId === db.phoneNumberId
            ? { id: "cfg_wa", organizationId: db.orgId, settings: {}, phoneNumberId: db.phoneNumberId, appSecret: db.appSecret }
            : null
        }
        if (where?.channelType === "whatsapp" && where?.isActive === true && Array.isArray(where.OR)) {
          const phoneId = where.OR[0]?.phoneNumberId || where.OR[1]?.phoneNumber
          return phoneId === db.phoneNumberId
            ? { id: "cfg_wa", organizationId: db.orgId, settings: {}, phoneNumberId: db.phoneNumberId, appSecret: db.appSecret }
            : null
        }
        if (where?.organizationId === db.orgId && where?.channelType === "whatsapp") {
          return { id: "cfg_wa", verifyToken: "VERIFY", appSecret: db.appSecret }
        }
        return null
      }),
    },
    callLog: {
      findFirst: vi.fn(async ({ where }: MockFindFirstArgs) => {
        if (where?.organizationId === db.orgId && db.pendingOutboundCall && where?.id === db.pendingOutboundCall.id) {
          return db.pendingOutboundCall
        }
        if (
          where?.organizationId === db.orgId
          && db.pendingOutboundCall
          && where?.provider === "whatsapp"
          && where?.direction === "outbound"
          && where?.callSid === null
          && where?.providerCallId === null
        ) {
          return { id: db.pendingOutboundCall.id }
        }
        if (where?.organizationId === db.orgId && db.existingCall && (where?.callSid || where?.id === db.existingCall.id)) return db.existingCall
        return null
      }),
      create: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "call_created", ...data })),
      update: vi.fn(async ({ data }: MockWriteArgs) => ({ id: db.existingCall?.id || "call_updated", ...data })),
    },
    whatsAppCallPermission: {
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "perm_1",
        status: update?.status || create?.status,
        canRequest: update?.canRequest ?? create?.canRequest ?? false,
        canStartCall: update?.canStartCall ?? create?.canStartCall ?? false,
        requestMessageId: null,
        responseSource: update?.responseSource ?? create?.responseSource ?? null,
        isPermanent: update?.isPermanent ?? create?.isPermanent ?? false,
        requestedAt: null,
        approvedAt: update?.approvedAt ?? create?.approvedAt ?? null,
        rejectedAt: update?.rejectedAt ?? create?.rejectedAt ?? null,
        expiresAt: update?.expiresAt ?? create?.expiresAt ?? null,
        lastCheckedAt: null,
        lastProviderStatus: null,
        lastError: null,
        actions: [],
      })),
    },
    socialConversation: {
      upsert: vi.fn(async () => ({ id: "sc_wa" })),
    },
    contact: {
      findFirst: vi.fn(async () => (db.contactId ? { id: db.contactId } : null)),
      findMany: vi.fn(async () => (db.contactId ? [{ id: db.contactId, companyId: null }] : [])),
      create: vi.fn(async () => ({ id: "contact_new" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    channelMessage: {
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "msg_created", ...data })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), resolveWhatsAppConfig: vi.fn() }))
vi.mock("@/lib/ai/support-feature", () => ({ isSupportAiEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/whatsapp-media", () => ({ fetchAndStoreWaMedia: vi.fn() }))
vi.mock("@/lib/whatsapp-call-sessions", () => ({
  deleteWhatsAppCallSession: vi.fn(),
  storeWhatsAppCallSession: vi.fn(),
}))
// Identity stubs (unchanged behaviour), but as spies so the wiring test below can
// assert the sender's profile name is actually routed through the sanitiser. The
// sanitiser's own behaviour is covered against the real implementation in
// lib-inbound-name-sanitization.test.ts.
vi.mock("@/lib/sanitize", () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
  sanitizeLog: vi.fn((s: string) => s),
}))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: vi.fn() }))
vi.mock("@/lib/ai/pii-masker", () => ({ PiiMasker: class { mask(s: string) { return s } unmask(s: string) { return s } } }))
vi.mock("@/lib/complaint-ai", () => ({ enrichComplaintInBackground: vi.fn() }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: vi.fn() }))
vi.mock("@/lib/sla-resolver", () => ({ resolveTicketSla: vi.fn(), normalizeTicketPriority: (p: string) => p }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn() }))
vi.mock("@/lib/inbox/reply-mode", () => ({ aiReplyEnabled: vi.fn(() => false) }))
vi.mock("@/lib/ai/support-agent", () => ({ getSupportAgentConfig: vi.fn() }))
vi.mock("@/lib/inbox/ticket-sync", () => ({ syncWhatsAppExchangeToTicket: vi.fn() }))
vi.mock("@/lib/inbox/complaint-register", () => ({ ensureComplaintRegistered: vi.fn(), notifyComplaintRegistered: vi.fn() }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn() }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn() }))
// What this file is about: the demo's agent takes its own threads' messages
// before tickets, the rule bot and the support AI ever see them.
const demoHook = vi.hoisted(() => vi.fn())
vi.mock("@/lib/demo-center/demo-whatsapp-agent", () => ({ handleDemoWhatsAppInbound: demoHook }))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn(async () => ({ id: "sc_wa", assignedTo: null, wasCreated: false })) }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn() }))
const ticketHook = vi.hoisted(() => vi.fn())
vi.mock("@/lib/inbox/whatsapp-inbound-ticket", () => ({ ensureInboundWhatsAppTicket: ticketHook }))
vi.mock("@/lib/chatbot-autoreply", () => ({ maybeAutoReply: vi.fn(async () => ({ replied: false })), chatbotTookOwnership: vi.fn(() => true) }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: MockTenantCallback) => fn(),
  runWithRlsBypass: (fn: MockTenantCallback) => fn(),
}))

import { POST } from "@/app/api/v1/webhooks/whatsapp/route"
import { reopenTicketForCustomerReply } from "@/lib/ticket-reopen"

const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=acme"
const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

function req(
  body: string,
  opts: { url?: string; secret?: string | null; signature?: string | null } = {},
): NextRequest {
  const signature = opts.signature !== undefined
    ? opts.signature
    : opts.secret === null
      ? null
      : sign(body, opts.secret ?? db.appSecret ?? "")
  return {
    url: opts.url ?? BASE,
    nextUrl: new URL(opts.url ?? BASE),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? signature : null) },
  } as unknown as NextRequest
}

function messagesPayload(value: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba_1", changes: [{ field: "messages", value }] }],
  })
}

const baseValue = {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "phone_1", display_phone_number: "13175551399" },
  contacts: [{ profile: { name: "Aysel" }, wa_id: "994501234567" }],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.orgId = "org_1"
  db.appSecret = "ACME_SECRET"
  db.phoneNumberId = "phone_1"
  db.existingCall = null
  db.pendingOutboundCall = null
  db.contactId = "contact_1"
})

afterEach(() => {
  delete process.env.WHATSAPP_APP_SECRET
})

describe("a message of the demo's live thread", () => {
  const textMessage = (text: string) => messagesPayload({
    ...baseValue,
    messages: [{ id: "wamid.in1", from: "994501234567", timestamp: "1760785200", type: "text", text: { body: text } }],
  })

  beforeEach(() => {
    vi.mocked(reopenTicketForCustomerReply).mockResolvedValue({ reopened: false } as never)
    ticketHook.mockResolvedValue(null)
  })

  it("is stored, handed to the demo's agent, and goes no further", async () => {
    demoHook.mockResolvedValue({ handled: true, action: "answered" })
    const res = await POST(req(textMessage("Salam! Kod: LD-1A2B3C")))
    expect(res.status).toBe(200)
    expect(demoHook).toHaveBeenCalledTimes(1)
    expect(demoHook.mock.calls[0][0]).toMatchObject({ organizationId: "org_1", channelConfigId: "cfg_wa", waPhone: "994501234567", text: "Salam! Kod: LD-1A2B3C", conversationId: "sc_wa" })
    expect(reopenTicketForCustomerReply).not.toHaveBeenCalled()
    expect(ticketHook).not.toHaveBeenCalled()
  })

  it("leaves every other message on the ordinary path", async () => {
    demoHook.mockResolvedValue({ handled: false })
    const res = await POST(req(textMessage("Sifarişim haqqında")))
    expect(res.status).toBe(200)
    expect(demoHook).toHaveBeenCalledTimes(1)
    expect(reopenTicketForCustomerReply).toHaveBeenCalledTimes(1)
  })
})
