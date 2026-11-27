import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * An approved AI renewal proposal opens the renewal deal on the organization's own first open
 * stage of its default pipeline — not a hard-coded "PROPOSAL" its pipeline may not have (CLAUDE.md:
 * stage names are never hard-coded; owner 2026-11-26, «Продление»).
 */

const mocks = vi.hoisted(() => ({
  findOrganizations: vi.fn(),
  findShadowActions: vi.fn(),
  updateShadowAction: vi.fn(),
  updateManyShadowActions: vi.fn(),
  deleteManyShadowActions: vi.fn(),
  findUsers: vi.fn(),
  withTenantCollectionFence: vi.fn(),
  evaluateGuardrails: vi.fn(),
  claimShadowAction: vi.fn(),
  executeAdvisorShadowAction: vi.fn(),
  logAudit: vi.fn(),
  isAiFeatureEnabled: vi.fn(),
  checkAiBudget: vi.fn(),
  getAdvisorPayload: vi.fn(),
  persistAdvisorSignalSnapshot: vi.fn(),
  findMentionsForSocialAiDraft: vi.fn(),
  createSocialMentionAiDraft: vi.fn(),
  findViralMentions: vi.fn(),
  filterNewViralCandidates: vi.fn(),
  writeViralShadowAction: vi.fn(),
  sendEmail: vi.fn(),
  findDeal: vi.fn(),
  createDeal: vi.fn(),
  findPipeline: vi.fn(),
  findStage: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: mocks.findOrganizations },
    aiShadowAction: {
      findMany: mocks.findShadowActions,
      update: mocks.updateShadowAction,
      updateMany: mocks.updateManyShadowActions,
      deleteMany: mocks.deleteManyShadowActions,
    },
    user: { findMany: mocks.findUsers },
    deal: { findFirst: mocks.findDeal },
    pipeline: { findFirst: mocks.findPipeline },
    pipelineStage: { findFirst: mocks.findStage },
  },
  logAudit: mocks.logAudit,
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (callback: () => Promise<unknown>) => callback()),
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: mocks.isAiFeatureEnabled,
  checkAiBudget: mocks.checkAiBudget,
}))
vi.mock("@/lib/ai/advisor/service", () => ({ getAdvisorPayload: mocks.getAdvisorPayload }))
vi.mock("@/lib/ai/advisor/snapshots", () => ({
  persistAdvisorSignalSnapshot: mocks.persistAdvisorSignalSnapshot,
}))
vi.mock("@/lib/social/ai-draft-service", () => ({
  findMentionsForSocialAiDraft: mocks.findMentionsForSocialAiDraft,
  createSocialMentionAiDraft: mocks.createSocialMentionAiDraft,
}))
vi.mock("@/lib/ai/social-viral", () => ({
  findViralMentions: mocks.findViralMentions,
  filterNewViralCandidates: mocks.filterNewViralCandidates,
  writeViralShadowAction: mocks.writeViralShadowAction,
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withTenantCollectionFence,
}))
vi.mock("@/lib/ai/advisor/execution-guardrails", () => ({
  evaluateAdvisorExecutionGuardrails: mocks.evaluateGuardrails,
}))
vi.mock("@/lib/ai/advisor/execution", () => ({
  advisorAlertNotificationType: vi.fn(() => "info"),
  advisorShadowActionAuditName: vi.fn(() => "action"),
  advisorShadowExecutionAuditValue: vi.fn(() => ({})),
  advisorTaskPriority: vi.fn(() => "medium"),
  claimAdvisorShadowActionForExecution: mocks.claimShadowAction,
  executeAdvisorShadowAction: mocks.executeAdvisorShadowAction,
}))

vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }))
vi.mock("@/lib/deal-stage-vocabulary", () => ({ orgStageVocabulary: vi.fn(async () => ({ closedStages: ["Qazanıldı", "Uduzdu"] })) }))
vi.mock("@/lib/deals/deal-events", () => ({
  withDealEvents: vi.fn(async (_client: unknown, _org: string, _ids: string[], fn: (tx: unknown) => Promise<{ value: unknown }>) =>
    (await fn({ deal: { create: mocks.createDeal } })).value),
}))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/cron/ai-auto-actions/route"

const renewalAction = {
  id: "shadow-renewal-1",
  organizationId: "org-1",
  featureName: "ai_auto_renewal",
  entityType: "contract",
  entityId: "ctr-1",
  actionType: "send_renewal_proposal",
  payload: {
    contractNumber: "DG-7", companyId: "co-1", companyName: "Müştəri MMC", contactId: "ct-1", contactEmail: "client@example.test",
    emailSubject: "Yenilənmə", emailBody: "<p>Təklif</p>", proposedValue: 132000, currency: "AZN", endDate: "2026-12-31T00:00:00.000Z",
  },
  riskLevel: "low",
  approved: true,
  reviewedBy: "user-1",
  reviewedAt: new Date("2026-11-26T09:00:00.000Z"),
  executionStatus: "approved",
  executedAt: null,
  failureReason: null,
  createdAt: new Date("2026-11-26T08:00:00.000Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrganizations.mockResolvedValue([])
  mocks.findShadowActions.mockResolvedValue([renewalAction])
  mocks.updateShadowAction.mockResolvedValue({ ...renewalAction, executionStatus: "executed" })
  mocks.deleteManyShadowActions.mockResolvedValue({ count: 0 })
  mocks.findUsers.mockResolvedValue([])
  mocks.evaluateGuardrails.mockResolvedValue({ allowed: true })
  mocks.claimShadowAction.mockResolvedValue(true)
  mocks.executeAdvisorShadowAction.mockResolvedValue(false)
  mocks.isAiFeatureEnabled.mockResolvedValue(false)
  mocks.checkAiBudget.mockResolvedValue({ allowed: true })
  mocks.sendEmail.mockResolvedValue({ success: true })
  mocks.findDeal.mockResolvedValue(null)
  mocks.createDeal.mockResolvedValue({ id: "deal-1" })
  mocks.findPipeline.mockResolvedValue({ id: "pipe-1" })
  mocks.findStage.mockResolvedValue({ name: "Təklif" })
})

describe("an approved AI renewal proposal", () => {
  it("opens the renewal deal on the default pipeline's first open stage", async () => {
    const response = await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))
    expect(response.status).toBe(200)
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "client@example.test" }))
    expect(mocks.findStage).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", pipelineId: "pipe-1", isWon: false, isLost: false, name: { notIn: ["Qazanıldı", "Uduzdu"] } }),
      orderBy: { sortOrder: "asc" },
    }))
    expect(mocks.createDeal).toHaveBeenCalledWith({ data: expect.objectContaining({ pipelineId: "pipe-1", stage: "Təklif", currency: "AZN", valueAmount: 132000 }) })
  })

  it("an organization without a pipeline gets the deal's default stage", async () => {
    mocks.findPipeline.mockResolvedValue(null)
    await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))
    expect(mocks.findStage).not.toHaveBeenCalled()
    const data = mocks.createDeal.mock.calls[0][0].data
    expect(data.stage).toBe("LEAD")
    expect(data).not.toHaveProperty("pipelineId")
  })

  it("does not open a second renewal deal", async () => {
    mocks.findDeal.mockResolvedValue({ id: "deal-0" })
    await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))
    expect(mocks.createDeal).not.toHaveBeenCalled()
  })
})
