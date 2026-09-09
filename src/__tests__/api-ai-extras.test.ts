import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/* ── Prisma mock ─────────────────────────────────────────────────── */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAlert: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    aiGuardrail: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    aiInteractionLog: { findMany: vi.fn(), count: vi.fn() },
    aiPendingAction: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    costEmployee: { findMany: vi.fn() },
    overheadCost: { findMany: vi.fn() },
    clientService: { findMany: vi.fn() },
    pricingParameters: { findFirst: vi.fn() },
    costModelSnapshot: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    fieldPermission: { findMany: vi.fn(), upsert: vi.fn() },
    sharingRule: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    deal: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    activity: { create: vi.fn() },
    event: { findFirst: vi.fn(), updateMany: vi.fn() },
    eventParticipant: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    ticket: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    ticketComment: { create: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    aiChatSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    aiChatMessage: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    aiAgentConfig: { findFirst: vi.fn() },
    kbArticle: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    pricingProfile: { findFirst: vi.fn() },
    additionalSale: { create: vi.fn() },
    company: { findUnique: vi.fn() },
    emailTemplate: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  PAGE_SIZE: { DEFAULT: 20 },
  NOREPLY_EMAIL: "noreply@leaddrivecrm.org",
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/entity-fields", () => ({
  ENTITY_FIELDS: { deal: [{ name: "name" }, { name: "value" }] },
  ENTITY_TYPES: ["deal"],
}))

vi.mock("@/lib/ai/tool-executor", () => ({
  executeTool: vi.fn().mockResolvedValue({ success: true, data: { result: "ok" } }),
}))

vi.mock("@/lib/portal-auth", () => ({
  getPortalUser: vi.fn(),
  createPortalToken: vi.fn().mockResolvedValue("jwt-token-123"),
}))

vi.mock("@/lib/sanitize", () => ({
  sanitizeForPrompt: vi.fn().mockImplementation((s: string) => s),
  sanitizeLog: vi.fn().mockImplementation((s: string) => s),
}))

vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn() }))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw") },
}))

/* ── Imports ──────────────────────────────────────────────────────── */
import { GET as GET_ALERTS, POST as POST_ALERTS } from "@/app/api/v1/ai-alerts/route"
import { GET as GET_GUARDRAILS, POST as POST_GUARDRAILS } from "@/app/api/v1/ai-guardrails/route"
import { GET as GET_INTERACTION_LOGS } from "@/app/api/v1/ai-interaction-logs/route"
import { POST as POST_OBSERVATIONS } from "@/app/api/v1/ai-observations/route"
import { POST as POST_APPROVE } from "@/app/api/v1/ai/approve-action/route"
import { GET as GET_FIELD_PERMS } from "@/app/api/v1/settings/field-permissions/route"
import { GET as GET_INVOICE_SETTINGS, PUT as PUT_INVOICE_SETTINGS } from "@/app/api/v1/settings/invoice/route"
import { GET as GET_PERMISSIONS } from "@/app/api/v1/settings/permissions/route"
import { GET as GET_SHARING_RULES, POST as POST_SHARING_RULES } from "@/app/api/v1/settings/sharing-rules/route"
import { PUT as PUT_SHARING_RULE, DELETE as DELETE_SHARING_RULE } from "@/app/api/v1/settings/sharing-rules/[id]/route"
import { POST as POST_ADD_PRICING } from "@/app/api/v1/deals/[id]/add-to-pricing/route"
import { GET as GET_PARTICIPANTS, POST as POST_PARTICIPANTS } from "@/app/api/v1/events/[id]/participants/route"
import { POST as POST_CONFIRM_ALL } from "@/app/api/v1/events/[id]/confirm-all/route"
import { POST as POST_SET_PASSWORD } from "@/app/api/v1/public/portal-auth/set-password/route"
import { GET as GET_PORTAL_TICKET, POST as POST_PORTAL_TICKET } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { GET as GET_TENANT_BRANDING } from "@/app/api/v1/public/tenant-branding/route"
import { GET as GET_EVENT_REGISTER_INFO, POST as POST_EVENT_REGISTER } from "@/app/api/v1/public/events/[id]/register/route"

import { prisma, logAudit } from "@/lib/prisma"
import { executeTool } from "@/lib/ai/tool-executor"
import { getSession, getOrgId, requireAuth, isAuthError } from "@/lib/api-auth"
import { getPortalUser } from "@/lib/portal-auth"

/* ── Helpers ──────────────────────────────────────────────────────── */
const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }
const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
  vi.mocked(isAuthError).mockReturnValue(false)
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/ai-alerts
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-alerts", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_ALERTS(makeReq("http://localhost:3000/api/v1/ai-alerts"))
    expect(res.status).toBe(401)
  })

  it("returns alerts and unread count", async () => {
    vi.mocked(prisma.aiAlert.findMany).mockResolvedValue([{ id: "a1", type: "high_latency" }] as any)
    vi.mocked(prisma.aiAlert.count).mockResolvedValue(1)

    const res = await GET_ALERTS(makeReq("http://localhost:3000/api/v1/ai-alerts"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.alerts).toHaveLength(1)
    expect(json.data.unreadCount).toBe(1)
  })
})

describe("POST /api/v1/ai-alerts (mark as read)", () => {
  it("marks all alerts as read", async () => {
    vi.mocked(prisma.aiAlert.updateMany).mockResolvedValue({ count: 5 } as any)
    const res = await POST_ALERTS(
      makeReq("http://localhost:3000/api/v1/ai-alerts", {
        method: "POST",
        body: JSON.stringify({ markAll: true }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/ai-guardrails
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-guardrails", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_GUARDRAILS(makeReq("http://localhost:3000/api/v1/ai-guardrails"))
    expect(res.status).toBe(401)
  })

  it("returns guardrails list", async () => {
    vi.mocked(prisma.aiGuardrail.findMany).mockResolvedValue([{ id: "g1", ruleName: "No PII" }] as any)
    const res = await GET_GUARDRAILS(makeReq("http://localhost:3000/api/v1/ai-guardrails"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.guardrails).toHaveLength(1)
  })
})

describe("POST /api/v1/ai-guardrails", () => {
  it("returns 400 when ruleName missing", async () => {
    const res = await POST_GUARDRAILS(
      makeReq("http://localhost:3000/api/v1/ai-guardrails", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates guardrail successfully", async () => {
    vi.mocked(prisma.aiGuardrail.create).mockResolvedValue({ id: "g2", ruleName: "No prices" } as any)
    const res = await POST_GUARDRAILS(
      makeReq("http://localhost:3000/api/v1/ai-guardrails", {
        method: "POST",
        body: JSON.stringify({ ruleName: "No prices", ruleType: "restriction" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.ruleName).toBe("No prices")
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/ai-interaction-logs
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-interaction-logs", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_INTERACTION_LOGS(makeReq("http://localhost:3000/api/v1/ai-interaction-logs"))
    expect(res.status).toBe(401)
  })

  it("returns paginated logs", async () => {
    vi.mocked(prisma.aiInteractionLog.findMany).mockResolvedValue([{ id: "l1" }] as any)
    vi.mocked(prisma.aiInteractionLog.count).mockResolvedValue(1)

    const res = await GET_INTERACTION_LOGS(makeReq("http://localhost:3000/api/v1/ai-interaction-logs?page=1&limit=10"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.logs).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/ai-observations
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/ai-observations", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_OBSERVATIONS(
      makeReq("http://localhost:3000/api/v1/ai-observations", {
        method: "POST",
        body: JSON.stringify({ tab: "analytics" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when tab missing", async () => {
    const res = await POST_OBSERVATIONS(
      makeReq("http://localhost:3000/api/v1/ai-observations", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns fallback when no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY
    vi.mocked(prisma.costEmployee.findMany).mockResolvedValue([])
    vi.mocked(prisma.overheadCost.findMany).mockResolvedValue([])
    vi.mocked(prisma.clientService.findMany).mockResolvedValue([])
    vi.mocked(prisma.pricingParameters.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.costModelSnapshot.findFirst).mockResolvedValue(null)

    const res = await POST_OBSERVATIONS(
      makeReq("http://localhost:3000/api/v1/ai-observations", {
        method: "POST",
        body: JSON.stringify({ tab: "analytics" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.fallback).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/ai/approve-action
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/ai/approve-action", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when actionId or decision missing", async () => {
    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid decision value", async () => {
    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "maybe" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when pending action not found", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue(null)
    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it("rejects action successfully", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue({
      id: "a1",
      toolName: "create_deal",
      toolInput: {},
      userId: "u1",
      expiresAt: new Date(Date.now() + 60000),
    } as any)
    vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "reject" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe("rejected")
  })

  /* ── Concurrency: the claim is what stops a duplicate send ───────────── */

  it("409s the loser of a concurrent approve and never executes the tool", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue({
      id: "a1",
      toolName: "send_email",
      toolInput: { to: "customer@example.com" },
      userId: "u1",
      expiresAt: new Date(Date.now() + 60000),
    } as any)
    // The other request already flipped it out of "pending".
    vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    expect(res.status).toBe(409)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("claims the action before executing it", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue({
      id: "a1",
      toolName: "send_email",
      toolInput: { to: "customer@example.com" },
      userId: "u1",
      expiresAt: new Date(Date.now() + 60000),
    } as any)
    vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(executeTool).mockResolvedValue({ success: true, data: { id: "e1" } } as any)

    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    expect(res.status).toBe(200)
    // The guarded claim must scope on status:"pending" — without that predicate
    // the UPDATE is not exclusive and both callers would proceed to send.
    const claim = vi.mocked(prisma.aiPendingAction.updateMany).mock.calls[0][0] as any
    expect(claim.where).toMatchObject({ id: "a1", organizationId: "org-1", status: "pending" })
    expect(claim.data.status).toBe("executing")
    expect(executeTool).toHaveBeenCalled()
  })

  it("marks a failed execution terminal instead of re-arming it as pending", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue({
      id: "a1",
      toolName: "send_email",
      toolInput: { to: "customer@example.com" },
      userId: "u1",
      expiresAt: new Date(Date.now() + 60000),
    } as any)
    vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(executeTool).mockResolvedValue({ success: false, error: "smtp down" } as any)

    const res = await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.data.status).toBe("failed")

    const settle = vi.mocked(prisma.aiPendingAction.updateMany).mock.calls.at(-1)![0] as any
    expect(settle.data.status).toBe("failed")
    // The regression being pinned: a failed send must NOT become clickable again.
    const wrotePending = vi
      .mocked(prisma.aiPendingAction.updateMany)
      .mock.calls.some((c: any[]) => c[0]?.data?.status === "pending")
    expect(wrotePending).toBe(false)
  })

  it("records the approver in the audit trail", async () => {
    vi.mocked(prisma.aiPendingAction.findFirst).mockResolvedValue({
      id: "a1",
      toolName: "create_deal",
      toolInput: {},
      userId: "author-u9",
      expiresAt: new Date(Date.now() + 60000),
    } as any)
    vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(executeTool).mockResolvedValue({ success: true, data: {} } as any)

    await POST_APPROVE(
      makeReq("http://localhost:3000/api/v1/ai/approve-action", {
        method: "POST",
        body: JSON.stringify({ actionId: "a1", decision: "approve" }),
      }),
    )
    const call = vi.mocked(logAudit).mock.calls.at(-1)!
    expect(call[1]).toBe("ai_action_approved")
    expect(call[5]).toMatchObject({ userId: "user-1" })
    // Author preserved separately — approver ≠ author must stay reconstructable.
    expect((call[5] as any).newValue).toMatchObject({ requestedBy: "author-u9" })
  })
})

describe("GET /api/v1/settings/field-permissions", () => {
  it("returns permission matrix", async () => {
    vi.mocked(prisma.fieldPermission.findMany).mockResolvedValue([])
    const res = await GET_FIELD_PERMS(makeReq("http://localhost:3000/api/v1/settings/field-permissions?entityType=deal"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deal).toBeDefined()
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/PUT /api/v1/settings/invoice
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/settings/invoice", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_INVOICE_SETTINGS(makeReq("http://localhost:3000/api/v1/settings/invoice"))
    expect(res.status).toBe(401)
  })

  it("returns invoice settings", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      settings: { invoice: { numberPrefix: "INV-", defaultTaxRate: 0.18 } },
    } as any)

    const res = await GET_INVOICE_SETTINGS(makeReq("http://localhost:3000/api/v1/settings/invoice"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.numberPrefix).toBe("INV-")
  })
})

describe("PUT /api/v1/settings/invoice", () => {
  it("returns 400 for invalid data", async () => {
    const res = await PUT_INVOICE_SETTINGS(
      makeReq("http://localhost:3000/api/v1/settings/invoice", {
        method: "PUT",
        body: JSON.stringify({ defaultTaxRate: 5 }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/settings/permissions
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/settings/permissions", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_PERMISSIONS(makeReq("http://localhost:3000/api/v1/settings/permissions"))
    expect(res.status).toBe(401)
  })

  it("returns default permissions when none saved", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    const res = await GET_PERMISSIONS(makeReq("http://localhost:3000/api/v1/settings/permissions"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.admin).toBeDefined()
    expect(json.data.admin.settings).toBe("full")
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/settings/sharing-rules
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/settings/sharing-rules", () => {
  it("returns sharing rules", async () => {
    vi.mocked(prisma.sharingRule.findMany).mockResolvedValue([{ id: "r1", name: "Sales View" }] as any)
    const res = await GET_SHARING_RULES(makeReq("http://localhost:3000/api/v1/settings/sharing-rules"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/settings/sharing-rules", () => {
  it("returns 400 for missing fields", async () => {
    const res = await POST_SHARING_RULES(
      makeReq("http://localhost:3000/api/v1/settings/sharing-rules", {
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates sharing rule", async () => {
    vi.mocked(prisma.sharingRule.create).mockResolvedValue({ id: "r2", name: "New Rule" } as any)
    const res = await POST_SHARING_RULES(
      makeReq("http://localhost:3000/api/v1/settings/sharing-rules", {
        method: "POST",
        body: JSON.stringify({
          entityType: "deal",
          name: "New Rule",
          ruleType: "role",
          accessLevel: "read",
        }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("New Rule")
  })
})

/* ═══════════════════════════════════════════════════════════════════
   PUT/DELETE /api/v1/settings/sharing-rules/[id]
   ═══════════════════════════════════════════════════════════════════ */
describe("PUT /api/v1/settings/sharing-rules/[id]", () => {
  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.sharingRule.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT_SHARING_RULE(
      makeReq("http://localhost:3000/api/v1/settings/sharing-rules/r1", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      }),
      makeParams("r1"),
    )
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/settings/sharing-rules/[id]", () => {
  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.sharingRule.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE_SHARING_RULE(
      makeReq("http://localhost:3000/api/v1/settings/sharing-rules/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes rule successfully", async () => {
    vi.mocked(prisma.sharingRule.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE_SHARING_RULE(
      makeReq("http://localhost:3000/api/v1/settings/sharing-rules/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/deals/[id]/add-to-pricing
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/deals/[id]/add-to-pricing", () => {
  it("returns 401 when no orgId", async () => {
    // withRls resolves session.orgId before the getOrgId fallback, so both must be nulled.
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST_ADD_PRICING(
      makeReq("http://localhost:3000/api/v1/deals/d1/add-to-pricing", {
        method: "POST",
        body: JSON.stringify({ type: "addon", name: "SSL", effectiveDate: "2026-05-01" }),
      }),
      makeParams("d1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when deal not found", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null)
    const res = await POST_ADD_PRICING(
      makeReq("http://localhost:3000/api/v1/deals/d1/add-to-pricing", {
        method: "POST",
        body: JSON.stringify({ type: "addon", name: "SSL", effectiveDate: "2026-05-01" }),
      }),
      makeParams("d1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 400 when deal has no company", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ id: "d1", companyId: null, company: null } as any)
    const res = await POST_ADD_PRICING(
      makeReq("http://localhost:3000/api/v1/deals/d1/add-to-pricing", {
        method: "POST",
        body: JSON.stringify({ type: "addon", name: "SSL", effectiveDate: "2026-05-01" }),
      }),
      makeParams("d1"),
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/events/[id]/participants
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/events/[id]/participants", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_PARTICIPANTS(makeReq("http://localhost:3000/api/v1/events/e1/participants"), makeParams("e1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when event not found", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue(null)
    const res = await GET_PARTICIPANTS(makeReq("http://localhost:3000/api/v1/events/e1/participants"), makeParams("e1"))
    expect(res.status).toBe(404)
  })

  it("returns participants list", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e1" } as any)
    vi.mocked(prisma.eventParticipant.findMany).mockResolvedValue([{ id: "p1", name: "Alice" }] as any)
    const res = await GET_PARTICIPANTS(makeReq("http://localhost:3000/api/v1/events/e1/participants"), makeParams("e1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/events/[id]/participants", () => {
  it("creates participant and updates count", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e1" } as any)
    vi.mocked(prisma.eventParticipant.create).mockResolvedValue({ id: "p2", name: "Bob" } as any)
    vi.mocked(prisma.eventParticipant.count).mockResolvedValue(2)
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_PARTICIPANTS(
      makeReq("http://localhost:3000/api/v1/events/e1/participants", {
        method: "POST",
        body: JSON.stringify({ name: "Bob", email: "bob@test.com" }),
      }),
      makeParams("e1"),
    )
    expect(res.status).toBe(201)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/events/[id]/confirm-all
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/events/[id]/confirm-all", () => {
  it("returns 401 when no orgId", async () => {
    // withRls resolves session.orgId before the getOrgId fallback, so both must be nulled.
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST_CONFIRM_ALL(
      makeReq("http://localhost:3000/api/v1/events/e1/confirm-all", { method: "POST" }),
      makeParams("e1"),
    )
    expect(res.status).toBe(401)
  })

  it("confirms all participants", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e1", name: "Conf", startDate: new Date() } as any)
    vi.mocked(prisma.eventParticipant.findMany).mockResolvedValue([])
    vi.mocked(prisma.eventParticipant.updateMany).mockResolvedValue({ count: 3 } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {}, name: "Acme" } as any)

    const res = await POST_CONFIRM_ALL(
      makeReq("http://localhost:3000/api/v1/events/e1/confirm-all", { method: "POST" }),
      makeParams("e1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.confirmed).toBe(3)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/public/portal-auth/set-password
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/public/portal-auth/set-password", () => {
  it("returns 400 when token missing", async () => {
    const res = await POST_SET_PASSWORD(
      makeReq("http://localhost:3000/api/v1/public/portal-auth/set-password", {
        method: "POST",
        body: JSON.stringify({ password: "ValidPortal123!", confirmPassword: "ValidPortal123!" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when password too short", async () => {
    const res = await POST_SET_PASSWORD(
      makeReq("http://localhost:3000/api/v1/public/portal-auth/set-password", {
        method: "POST",
        body: JSON.stringify({ token: "tok1", password: "123", confirmPassword: "123" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when passwords dont match", async () => {
    const res = await POST_SET_PASSWORD(
      makeReq("http://localhost:3000/api/v1/public/portal-auth/set-password", {
        method: "POST",
        body: JSON.stringify({ token: "tok1", password: "ValidPortal123!", confirmPassword: "Different456!" }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/public/portal-tickets/[id]
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/public/portal-tickets/[id]", () => {
  it("returns 401 when no portal user", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null as any)
    const res = await GET_PORTAL_TICKET(makeReq("http://localhost:3000/api/v1/public/portal-tickets/t1"), makeParams("t1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when ticket not found", async () => {
    vi.mocked(getPortalUser).mockResolvedValue({
      contactId: "c1",
      organizationId: "org-1",
      companyId: "comp1",
      fullName: "John",
      email: "j@test.com",
    } as any)
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const res = await GET_PORTAL_TICKET(makeReq("http://localhost:3000/api/v1/public/portal-tickets/t1"), makeParams("t1"))
    expect(res.status).toBe(404)
  })
})

describe("POST /api/v1/public/portal-tickets/[id] (add comment)", () => {
  it("returns 400 when comment empty", async () => {
    vi.mocked(getPortalUser).mockResolvedValue({
      contactId: "c1",
      organizationId: "org-1",
      companyId: "comp1",
      fullName: "John",
      email: "j@test.com",
    } as any)
    const res = await POST_PORTAL_TICKET(
      makeReq("http://localhost:3000/api/v1/public/portal-tickets/t1", {
        method: "POST",
        body: JSON.stringify({ comment: "" }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/public/tenant-branding
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/public/tenant-branding", () => {
  it("returns null when slug missing", async () => {
    const res = await GET_TENANT_BRANDING(makeReq("http://localhost:3000/api/v1/public/tenant-branding"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeNull()
  })

  it("returns null when org not found", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
    const res = await GET_TENANT_BRANDING(makeReq("http://localhost:3000/api/v1/public/tenant-branding?slug=unknown"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeNull()
  })

  it("returns branding for active org", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Acme Corp",
      slug: "acme",
      logo: "/logo.png",
      branding: { primaryColor: "#000" },
      isActive: true,
    } as any)

    const res = await GET_TENANT_BRANDING(makeReq("http://localhost:3000/api/v1/public/tenant-branding?slug=acme"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Acme Corp")
    expect(json.data.suspended).toBe(false)
  })

  it("returns suspended flag for inactive org", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Inactive Inc",
      slug: "inactive",
      logo: null,
      branding: null,
      isActive: false,
    } as any)

    const res = await GET_TENANT_BRANDING(makeReq("http://localhost:3000/api/v1/public/tenant-branding?slug=inactive"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.suspended).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/POST /api/v1/public/events/[id]/register
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/public/events/[id]/register", () => {
  it("returns 404 when event not found", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue(null)
    const res = await GET_EVENT_REGISTER_INFO(
      makeReq("http://localhost:3000/api/v1/public/events/e1/register"),
      makeParams("e1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns event info with canRegister flag", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({
      id: "e1",
      name: "Launch",
      status: "registration_open",
      maxParticipants: 100,
      registeredCount: 10,
    } as any)

    const res = await GET_EVENT_REGISTER_INFO(
      makeReq("http://localhost:3000/api/v1/public/events/e1/register"),
      makeParams("e1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.canRegister).toBe(true)
    expect(json.data.isFull).toBe(false)
  })
})

describe("POST /api/v1/public/events/[id]/register", () => {
  it("returns 404 when event not found", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue(null)
    const res = await POST_EVENT_REGISTER(
      makeReq("http://localhost:3000/api/v1/public/events/e1/register", {
        method: "POST",
        body: JSON.stringify({ name: "Alice", email: "alice@test.com" }),
      }),
      makeParams("e1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 400 when registration closed", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({
      id: "e1",
      status: "completed",
      maxParticipants: 100,
      registeredCount: 50,
      organizationId: "org-1",
    } as any)

    const res = await POST_EVENT_REGISTER(
      makeReq("http://localhost:3000/api/v1/public/events/e1/register", {
        method: "POST",
        body: JSON.stringify({ name: "Alice", email: "alice@test.com" }),
      }),
      makeParams("e1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid email", async () => {
    vi.mocked(prisma.event.findFirst).mockResolvedValue({
      id: "e1",
      status: "registration_open",
      maxParticipants: 100,
      registeredCount: 50,
      organizationId: "org-1",
    } as any)

    const res = await POST_EVENT_REGISTER(
      makeReq("http://localhost:3000/api/v1/public/events/e1/register", {
        method: "POST",
        body: JSON.stringify({ name: "Alice", email: "not-an-email" }),
      }),
      makeParams("e1"),
    )
    expect(res.status).toBe(400)
  })
})
