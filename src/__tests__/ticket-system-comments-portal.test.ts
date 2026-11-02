import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the product writes on a ticket by itself, as the customer then reads it.
 *
 * Found 2026-10-18: the AI auto-actions cron writes a public comment with no
 * author — the SLA acknowledgement («We have received your request …») and the
 * knowledge-base suggestion — and the portal takes any authorless comment
 * without a sender prefix for the customer's own reply. The customer read the
 * support team's acknowledgement under their own name, on their side of the
 * thread.
 *
 * The real cron writes the comments; the real portal route reads them back.
 */

const mocks = vi.hoisted(() => ({
  findOrganizations: vi.fn(),
  findShadowActions: vi.fn(),
  updateShadowAction: vi.fn(),
  deleteManyShadowActions: vi.fn(),
  findUsers: vi.fn(),
  findTickets: vi.fn(),
  findTicket: vi.fn(),
  findUniqueTicket: vi.fn(),
  updateTicket: vi.fn(),
  updateManyTickets: vi.fn(),
  createComment: vi.fn(),
  isAiFeatureEnabled: vi.fn(),
  getPortalUser: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: mocks.findOrganizations },
    aiShadowAction: {
      findMany: mocks.findShadowActions,
      update: mocks.updateShadowAction,
      deleteMany: mocks.deleteManyShadowActions,
    },
    user: { findMany: mocks.findUsers },
    ticket: {
      findMany: mocks.findTickets,
      findFirst: mocks.findTicket,
      findUnique: mocks.findUniqueTicket,
      update: mocks.updateTicket,
      updateMany: mocks.updateManyTickets,
    },
    ticketComment: { create: mocks.createComment },
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (work: () => Promise<unknown>) => work()),
  runWithTenant: vi.fn(async (_orgId: string, work: () => Promise<unknown>) => work()),
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: mocks.isAiFeatureEnabled,
  checkAiBudget: vi.fn(async () => ({ allowed: true })),
}))
vi.mock("@/lib/ai/support-feature", () => ({ isSupportAiEnabled: vi.fn(async () => true) }))
vi.mock("@/lib/ai/advisor/service", () => ({ getAdvisorPayload: vi.fn(async () => ({ signals: [] })) }))
vi.mock("@/lib/ai/advisor/snapshots", () => ({ persistAdvisorSignalSnapshot: vi.fn() }))
vi.mock("@/lib/ai/advisor/execution-guardrails", () => ({
  evaluateAdvisorExecutionGuardrails: vi.fn(async () => ({ allowed: true })),
}))
vi.mock("@/lib/ai/advisor/execution", () => ({
  advisorAlertNotificationType: vi.fn(() => "info"),
  advisorShadowActionAuditName: vi.fn(() => "action"),
  advisorShadowExecutionAuditValue: vi.fn(() => ({})),
  advisorTaskPriority: vi.fn(() => "medium"),
  claimAdvisorShadowActionForExecution: vi.fn(async () => true),
  executeAdvisorShadowAction: vi.fn(async () => false),
}))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: mocks.getPortalUser }))

import { NextRequest } from "next/server"
import { POST as runAutoActions } from "@/app/api/cron/ai-auto-actions/route"
import { GET as portalTicket } from "@/app/api/v1/public/portal-tickets/[id]/route"

const NOW = new Date()
const CUSTOMER = { contactId: "contact-1", organizationId: "org-1", companyId: null, fullName: "Aysel Məmmədova", email: "aysel@example.az" }

function approved(id: string, featureName: string, actionType: string, payload: Record<string, unknown>) {
  return {
    id, organizationId: "org-1", featureName, entityType: "ticket", entityId: "tk-1", actionType, payload,
    riskLevel: "low", approved: true, reviewedBy: "user-1", reviewedAt: NOW, executionStatus: "approved",
    executedAt: null, failureReason: null, createdAt: NOW,
  }
}

/** The cron runs once: an acknowledgement due now, and two actions an admin approved. */
async function cronWrites(): Promise<string[]> {
  mocks.findOrganizations.mockResolvedValue([{ id: "org-1" }])
  mocks.isAiFeatureEnabled.mockImplementation(async (_orgId: string, feature: string) => feature === "ai_auto_acknowledge")
  mocks.findTickets.mockResolvedValue([{
    id: "tk-1", ticketNumber: "WA-0007", subject: "Order missing", contactId: "contact-1",
    createdAt: new Date(NOW.getTime() - 3 * 3_600_000),
    slaFirstResponseDueAt: new Date(NOW.getTime() + 3_600_000),
  }])
  mocks.findUniqueTicket.mockResolvedValue({ assignedTo: null })
  mocks.findShadowActions.mockResolvedValue([
    approved("sa-1", "ai_auto_acknowledge_shadow", "send_template", {
      ticketNumber: "WA-0007",
      message: "We have received your request WA-0007. A specialist will respond within 2h. Thank you for your patience.",
    }),
    approved("sa-2", "ai_auto_kb_close_shadow", "kb_close_ticket", { articleId: "kb-12", articleTitle: "Tracking a delivery" }),
  ])
  mocks.updateShadowAction.mockImplementation(async ({ data }: { data: object }) => ({ ...data }))

  const res = await runAutoActions(new NextRequest("http://localhost/api/cron/ai-auto-actions", { method: "POST" }))
  expect(res.status).toBe(200)
  return mocks.createComment.mock.calls.map(([args]) => (args as { data: { comment: string } }).data.comment)
}

/** The customer opens the ticket in the portal; the stored comments come back in this order. */
async function customerReads(comments: Array<{ comment: string; userId: string | null }>) {
  mocks.findTicket.mockResolvedValue({
    id: "tk-1", ticketNumber: "WA-0007", subject: "Order missing", description: null, status: "in_progress",
    category: "general", categoryRef: null, satisfactionRating: null, satisfactionComment: null,
    createdAt: NOW, updatedAt: NOW, resolvedAt: null, closedAt: null,
    slaDueAt: null, slaFirstResponseDueAt: null, firstResponseAt: null,
    comments: comments.map((c, i) => ({ id: `c${i}`, ...c, isInternal: false, createdAt: NOW, attachments: [] })),
  })
  const res = await portalTicket(new NextRequest("http://localhost/api/v1/public/portal-tickets/tk-1"), { params: Promise.resolve({ id: "tk-1" }) })
  expect(res.status).toBe(200)
  return (await res.json()).data.comments as Array<{ comment: string; author: string; isAgent: boolean; authorName: string }>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deleteManyShadowActions.mockResolvedValue({ count: 0 })
  mocks.findUsers.mockResolvedValue([])
  mocks.createComment.mockResolvedValue({})
  mocks.updateTicket.mockResolvedValue({})
  mocks.updateManyTickets.mockResolvedValue({ count: 1 })
  mocks.getPortalUser.mockResolvedValue(CUSTOMER)
})

describe("a comment the product wrote on a ticket", () => {
  it("reaches the customer as the support team's, not as their own words", async () => {
    const written = await cronWrites()
    expect(written).toHaveLength(3)

    const thread = await customerReads([
      { comment: "Where is my order?", userId: null }, // the customer's own portal reply
      ...written.map((comment) => ({ comment, userId: null })),
    ])

    expect(thread[0]).toMatchObject({ comment: "Where is my order?", author: "customer", isAgent: false, authorName: "Aysel Məmmədova" })
    for (const comment of thread.slice(1)) {
      expect(comment).toMatchObject({ author: "agent", isAgent: true, authorName: "Support" })
    }
    expect(thread[1].comment).toMatch(/^We have received your request WA-0007\. A specialist will respond within \d+h\./)
    expect(thread[2].comment).toBe("We have received your request WA-0007. A specialist will respond within 2h. Thank you for your patience.")
    expect(thread[3].comment).toMatch(/^📖 Knowledge-base article that answers this: \*\*Tracking a delivery\*\*/)
    expect(JSON.stringify(thread)).not.toContain("[Система]")
  })

  it("is the support team's also when the cron wrote it before it marked its comments", async () => {
    const thread = await customerReads([
      { comment: "We have received your request TK-0031. A specialist will respond within 4h. Thank you for your patience.", userId: null },
      { comment: "📖 Knowledge-base article that answers this: **Reset a password**\n\nArticle ID: kb-3\n\nIf this solved your issue, great! If not, reply and we'll dig deeper.", userId: null },
      // Not the cron's text, only near it: still the customer's.
      { comment: "We have received your request — but nobody answered", userId: null },
    ])

    expect(thread.map((c) => c.author)).toEqual(["agent", "agent", "customer"])
    expect(thread[2].authorName).toBe("Aysel Məmmədova")
  })
})
