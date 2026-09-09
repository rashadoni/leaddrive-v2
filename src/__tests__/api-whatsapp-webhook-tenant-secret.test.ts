import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * WhatsApp webhook POST — per-tenant signature, env-fallback convergence with the FB fix.
 *
 * When `?t=<org-slug>` addresses a tenant that has NO own appSecret, the POST must REJECT (401) and
 * NOT fall back to env WHATSAPP_APP_SECRET — otherwise an env-signed (shared-app) payload to
 * `?t=<any org slug>` would pass the signature AND be org-scoped → a cross-tenant write. The no-`?t`
 * (legacy LeadDrive) path keeps the env fallback.
 */

const tenant: { orgId: string | null; verifyToken: string | null; appSecret: string | null } = {
  orgId: null, verifyToken: null, appSecret: null,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async ({ where }: any) => (tenant.orgId && where?.slug ? { id: tenant.orgId } : null)) },
    channelConfig: {
      // resolveTenantWhatsAppConfig's lookup (active whatsapp config for the org)
      findFirst: vi.fn(async () => (tenant.orgId ? { id: "cfg1", verifyToken: tenant.verifyToken, appSecret: tenant.appSecret } : null)),
    },
  },
}))
// Processing-path deps are imported but never reached for the guard/signature cases below.
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

const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp"
// Empty-but-valid Meta payload: passes signature, then returns {ok:true} (no `value`) before processing.
const payload = JSON.stringify({ entry: [{ changes: [{ value: {} }] }] })
const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

function req(body: string, sig: string | null, url: string = BASE): NextRequest {
  return {
    url, nextUrl: new URL(url),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sig : null) },
  } as unknown as NextRequest
}

beforeEach(() => { vi.clearAllMocks(); tenant.orgId = null; tenant.verifyToken = null; tenant.appSecret = null })
afterEach(() => { delete process.env.WHATSAPP_APP_SECRET })

describe("WhatsApp webhook POST — ?t tenant-secret guard", () => {
  it("REJECTS (401) when ?t addresses a tenant with NO appSecret — even if env-signed", async () => {
    process.env.WHATSAPP_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    tenant.orgId = "org_acme"; tenant.appSecret = null // org+config exist, but no own appSecret
    // Signed with the env secret → must STILL 401 (no env fallback when ?t addresses a tenant).
    expect((await POST(req(payload, sign(payload, "LEADDRIVE_ENV_SECRET"), `${BASE}?t=acme`))).status).toBe(401)
  })

  it("passes (200) when ?t tenant has its OWN appSecret and the payload is signed with it", async () => {
    process.env.WHATSAPP_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    tenant.orgId = "org_acme"; tenant.appSecret = "ACME_SECRET"
    expect((await POST(req(payload, sign(payload, "ACME_SECRET"), `${BASE}?t=acme`))).status).toBe(200)
  })

  it("401 when ?t tenant has its own appSecret but the payload is signed with the ENV secret", async () => {
    process.env.WHATSAPP_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    tenant.orgId = "org_acme"; tenant.appSecret = "ACME_SECRET"
    expect((await POST(req(payload, sign(payload, "LEADDRIVE_ENV_SECRET"), `${BASE}?t=acme`))).status).toBe(401)
  })

  it("no ?t (legacy LeadDrive path) → env fallback: env-signed payload passes (200)", async () => {
    process.env.WHATSAPP_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    expect((await POST(req(payload, sign(payload, "LEADDRIVE_ENV_SECRET"), BASE))).status).toBe(200)
  })
})
