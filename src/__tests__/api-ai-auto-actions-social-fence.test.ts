import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { NextRequest } from "next/server"
import { POST } from "@/app/api/cron/ai-auto-actions/route"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrganizations.mockResolvedValue([])
  mocks.findShadowActions.mockResolvedValue([{
    id: "shadow-social-1",
    organizationId: "org-1",
    featureName: "ai_auto_social_triage_shadow",
    entityType: "social_mention",
    entityId: "mention-1",
    actionType: "create_task",
    payload: {
      title: "Review mention",
      description: "Review the social mention",
    },
    riskLevel: "high",
    approved: true,
    reviewedBy: "user-1",
    reviewedAt: new Date("2026-07-28T09:00:00.000Z"),
    executionStatus: "approved",
    executedAt: null,
    failureReason: null,
    createdAt: new Date("2026-07-28T08:00:00.000Z"),
  }])
  mocks.deleteManyShadowActions.mockResolvedValue({ count: 0 })
  mocks.findUsers.mockResolvedValue([])
  mocks.withTenantCollectionFence.mockResolvedValue({
    allowed: false,
    reason: "social_monitoring_collection_blocked",
  })
  mocks.evaluateGuardrails.mockResolvedValue({ allowed: true })
  mocks.claimShadowAction.mockResolvedValue(true)
  mocks.executeAdvisorShadowAction.mockResolvedValue(false)
  mocks.isAiFeatureEnabled.mockResolvedValue(false)
  mocks.checkAiBudget.mockResolvedValue({ allowed: true })
  mocks.getAdvisorPayload.mockResolvedValue({ signals: [] })
  mocks.persistAdvisorSignalSnapshot.mockResolvedValue(undefined)
  mocks.findMentionsForSocialAiDraft.mockResolvedValue([])
  mocks.findViralMentions.mockResolvedValue([])
  mocks.filterNewViralCandidates.mockResolvedValue([])
  mocks.writeViralShadowAction.mockResolvedValue(undefined)
})

describe("ai-auto-actions social collection fence", () => {
  it("leaves an approved Support action queued while the master switch is off", async () => {
    mocks.findShadowActions.mockResolvedValue([{
      id: "shadow-support-1",
      organizationId: "org-1",
      featureName: "ai_auto_triage_shadow",
      entityType: "ticket",
      entityId: "ticket-1",
      actionType: "update_ticket",
      payload: {},
      riskLevel: "low",
      approved: true,
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-07-28T09:00:00.000Z"),
      executionStatus: "approved",
      executedAt: null,
      failureReason: null,
      createdAt: new Date("2026-07-28T08:00:00.000Z"),
    }])
    mocks.isAiFeatureEnabled.mockImplementation(async (
      _organizationId: string,
      featureName: string,
    ) => featureName === "supportAiDisabled")

    const response = await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.executedApproved).toBe(0)
    expect(mocks.claimShadowAction).not.toHaveBeenCalled()
    expect(mocks.executeAdvisorShadowAction).not.toHaveBeenCalled()
    expect(mocks.updateShadowAction).not.toHaveBeenCalled()
  })

  it("does not claim or mutate a blocked social_mention shadow action", async () => {
    const response = await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: { executedApproved: 0 },
    })
    expect(mocks.withTenantCollectionFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.evaluateGuardrails).not.toHaveBeenCalled()
    expect(mocks.claimShadowAction).not.toHaveBeenCalled()
    expect(mocks.executeAdvisorShadowAction).not.toHaveBeenCalled()
    expect(mocks.updateManyShadowActions).not.toHaveBeenCalled()
    expect(mocks.updateShadowAction).not.toHaveBeenCalled()
    expect(mocks.logAudit).not.toHaveBeenCalled()
  })

  it("blocks social reply and viral reads before they can create new shadow actions", async () => {
    mocks.findOrganizations.mockResolvedValue([{ id: "org-1" }])
    mocks.findShadowActions.mockResolvedValue([])
    mocks.isAiFeatureEnabled.mockImplementation(async (
      _organizationId: string,
      featureName: string,
    ) => featureName === "ai_auto_social_reply" || featureName === "ai_auto_social_viral")

    const response = await POST(new NextRequest("https://crm.test/api/cron/ai-auto-actions"))

    expect(response.status).toBe(200)
    expect(mocks.withTenantCollectionFence).toHaveBeenCalledTimes(2)
    expect(mocks.withTenantCollectionFence).toHaveBeenNthCalledWith(1, "org-1", expect.any(Function))
    expect(mocks.withTenantCollectionFence).toHaveBeenNthCalledWith(2, "org-1", expect.any(Function))
    expect(mocks.findMentionsForSocialAiDraft).not.toHaveBeenCalled()
    expect(mocks.createSocialMentionAiDraft).not.toHaveBeenCalled()
    expect(mocks.findViralMentions).not.toHaveBeenCalled()
    expect(mocks.filterNewViralCandidates).not.toHaveBeenCalled()
    expect(mocks.writeViralShadowAction).not.toHaveBeenCalled()
  })

  it("keeps the social fence open until the execution audit write settles", async () => {
    let releaseAudit!: () => void
    const auditPending = new Promise<void>((resolve) => {
      releaseAudit = resolve
    })
    let auditStarted!: () => void
    const auditStartedPromise = new Promise<void>((resolve) => {
      auditStarted = resolve
    })
    mocks.withTenantCollectionFence.mockImplementation(async (
      _organizationId: string,
      callback: () => Promise<unknown>,
    ) => ({
      allowed: true,
      value: await callback(),
    }))
    mocks.executeAdvisorShadowAction.mockResolvedValue(true)
    mocks.updateShadowAction.mockResolvedValue({ executionStatus: "executed" })
    mocks.logAudit.mockImplementation(async () => {
      auditStarted()
      await auditPending
    })

    let settled = false
    const responsePromise = POST(
      new NextRequest("https://crm.test/api/cron/ai-auto-actions"),
    ).finally(() => {
      settled = true
    })

    await auditStartedPromise
    expect(settled).toBe(false)

    releaseAudit()
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(mocks.logAudit).toHaveBeenCalledTimes(1)
  })
})
