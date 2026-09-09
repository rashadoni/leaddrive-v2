import { beforeEach, describe, expect, it, vi } from "vitest"

const db = {
  aiShadowActionFindMany: vi.fn(),
  advisorPlaybookFindMany: vi.fn(),
  advisorPlaybookUpsert: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiShadowAction: {
      findMany: (...args: unknown[]) => db.aiShadowActionFindMany(...args),
    },
    advisorPlaybook: {
      findMany: (...args: unknown[]) => db.advisorPlaybookFindMany(...args),
      upsert: (...args: unknown[]) => db.advisorPlaybookUpsert(...args),
    },
  },
}))

import {
  advisorPlaybookPatternKey,
  advisorPlaybookGovernanceTemplate,
  buildAdvisorPlaybookCandidates,
  listAdvisorPlaybookCandidates,
  promoteAdvisorPlaybook,
} from "@/lib/ai/advisor/playbooks"

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-1",
    actionType: "create_task",
    entityType: "deal",
    entityId: "deal-1",
    approved: true,
    executionStatus: "executed",
    reviewedBy: "manager-1",
    reviewedAt: new Date("2026-06-10T10:00:00.000Z"),
    payload: {
      title: "Follow up stalled deal",
      advisor: {
        domain: "sales",
        actionLabel: "Create follow-up task",
        risk: "medium",
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.aiShadowActionFindMany.mockResolvedValue([])
  db.advisorPlaybookFindMany.mockResolvedValue([])
  db.advisorPlaybookUpsert.mockResolvedValue({ id: "playbook-1" })
})

describe("Advisor playbooks", () => {
  it("builds stable pattern keys without source signal ids", () => {
    expect(advisorPlaybookPatternKey(action({ payload: { advisor: { domain: "sales", actionLabel: "Create task", signalId: "one" } } }))).toBe("sales:deal:create_task:create_task")
    expect(advisorPlaybookPatternKey(action({ payload: { advisor: { domain: "sales", actionLabel: "Create task", signalId: "two" } } }))).toBe("sales:deal:create_task:create_task")
  })

  it("promotes only repeated approved patterns into candidates", () => {
    const candidates = buildAdvisorPlaybookCandidates([
      action({ id: "a1" }),
      action({ id: "a2", executionStatus: "queued" }),
      action({ id: "a3", approved: false, executionStatus: "rejected" }),
      action({ id: "single", actionType: "create_note", payload: { advisor: { domain: "sales", actionLabel: "Create note" } } }),
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      patternKey: "sales:deal:create_task:create_follow-up_task",
      name: "sales: Create follow-up task",
      approvalCount: 2,
      rejectionCount: 1,
      executionSuccessCount: 1,
      sourceActionIds: ["a1", "a2"],
      whyCandidate: "2 approved sales create_task actions repeated with 1 successful executions and 1 rejections.",
    })
    expect(candidates[0]?.approvalHistory).toEqual([
      expect.objectContaining({
        id: "a1",
        title: "Follow up stalled deal",
        approved: true,
        executionStatus: "executed",
        reviewedBy: "manager-1",
        reviewedAt: "2026-06-10T10:00:00.000Z",
        entityType: "deal",
        entityId: "deal-1",
      }),
      expect.objectContaining({ id: "a2" }),
      expect.objectContaining({ id: "a3", approved: false, executionStatus: "rejected" }),
    ])
  })

  it("marks candidates that already have playbooks", () => {
    const candidates = buildAdvisorPlaybookCandidates([
      action({ id: "a1" }),
      action({ id: "a2" }),
    ], [{ id: "playbook-1", patternKey: "sales:deal:create_task:create_follow-up_task" }])

    expect(candidates[0]?.existingPlaybookId).toBe("playbook-1")
  })

  it("queries recent reviewed Advisor actions for candidates", async () => {
    await listAdvisorPlaybookCandidates("org-1", new Date("2026-06-01T00:00:00.000Z"))

    expect(db.aiShadowActionFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        featureName: "advisor_signal",
        approved: { not: null },
        reviewedAt: { gte: new Date("2026-06-01T00:00:00.000Z") },
      },
      select: expect.objectContaining({
        id: true,
        actionType: true,
        entityId: true,
        payload: true,
        reviewedAt: true,
        reviewedBy: true,
      }),
      orderBy: { reviewedAt: "desc" },
      take: 500,
    })
  })

  it("builds tenant governance for playbook candidates", () => {
    const [candidate] = buildAdvisorPlaybookCandidates([
      action({ id: "a1" }),
      action({ id: "a2" }),
    ])
    const governance = advisorPlaybookGovernanceTemplate({
      candidate,
      ownerId: "admin-1",
      now: new Date("2026-06-20T00:00:00.000Z"),
    })

    expect(governance).toEqual({
      version: 1,
      ownerId: "admin-1",
      reviewDate: "2026-09-18T00:00:00.000Z",
      whyCandidate: "2 approved sales create_task actions repeated with 2 successful executions and 0 rejections.",
      approvalHistory: [
        expect.objectContaining({ id: "a1", reviewedBy: "manager-1" }),
        expect.objectContaining({ id: "a2", reviewedBy: "manager-1" }),
      ],
    })
  })

  it("creates promoted playbooks disabled by default", async () => {
    db.aiShadowActionFindMany.mockResolvedValue([
      action({ id: "a1" }),
      action({ id: "a2" }),
    ])

    await promoteAdvisorPlaybook({
      organizationId: "org-1",
      patternKey: "sales:deal:create_task:create_follow-up_task",
      promotedBy: "admin-1",
      since: new Date("2026-06-01T00:00:00.000Z"),
    })

    expect(db.advisorPlaybookUpsert).toHaveBeenCalledWith({
      where: {
        organizationId_patternKey: {
          organizationId: "org-1",
          patternKey: "sales:deal:create_task:create_follow-up_task",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-1",
        status: "disabled",
        maxAutonomyLevel: "L4",
        approvalCount: 2,
        promotedBy: "admin-1",
        payloadTemplate: expect.objectContaining({
          advisorGovernance: expect.objectContaining({
            version: 1,
            ownerId: "admin-1",
            whyCandidate: "2 approved sales create_task actions repeated with 2 successful executions and 0 rejections.",
            approvalHistory: [
              expect.objectContaining({ id: "a1" }),
              expect.objectContaining({ id: "a2" }),
            ],
          }),
        }),
      }),
      update: expect.objectContaining({
        approvalCount: 2,
        payloadTemplate: expect.objectContaining({
          advisorGovernance: expect.objectContaining({
            ownerId: "admin-1",
          }),
        }),
      }),
    })
  })
})
