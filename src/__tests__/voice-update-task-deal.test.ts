import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Editing tasks and deals by voice (owner request, 2026-09-21).
 *
 * The voice path runs the same command the REST route runs — these tests are
 * about what is different for voice, and about the guarantees a receipt makes:
 * what the user confirmed is the whole mutation, a record edited after the
 * receipt was read is refused rather than overwritten, the board still decides
 * who may close a task, and nothing is announced before the transaction
 * commits.
 */

const effects = vi.hoisted(() => ({
  logAudit: vi.fn(),
  executeWorkflows: vi.fn(async () => {}),
  fireWebhooks: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  recalcProjectCompletion: vi.fn(async () => {}),
  spawnNextRecurringTask: vi.fn(async () => {}),
  activityCreateMany: vi.fn(async () => ({ count: 1 })),
}))

const db = vi.hoisted(() => ({
  taskFindFirst: vi.fn(),
  taskUpdateMany: vi.fn(async () => ({ count: 1 })),
  taskUpdate: vi.fn(),
  taskActivityCreateMany: vi.fn(async () => ({ count: 1 })),
  dealFindFirst: vi.fn(),
  dealUpdateMany: vi.fn(async () => ({ count: 1 })),
  userFindFirst: vi.fn(async () => ({ id: "user-2" })),
  divisionFindFirst: vi.fn(async () => ({ headUserId: null, parentDivisionId: null, parent: null })),
  boardPermissionFindUnique: vi.fn(async () => null),
  applyRecordFilter: vi.fn(async (_o: string, _u: string, _r: string, _t: string, where: object) => where),
}))

const client = vi.hoisted(() => ({
  task: { findFirst: db.taskFindFirst, updateMany: db.taskUpdateMany, update: db.taskUpdate },
  taskActivity: { createMany: db.taskActivityCreateMany },
  taskCollaborator: { deleteMany: vi.fn(), createMany: vi.fn() },
  deal: { findFirst: db.dealFindFirst, updateMany: db.dealUpdateMany },
  user: { findFirst: db.userFindFirst, count: vi.fn(async () => 0) },
  division: { findFirst: db.divisionFindFirst },
  boardPermission: { findUnique: db.boardPermissionFindUnique },
  boardColumn: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  contact: { findFirst: vi.fn(async () => ({ id: "contact-1" })) },
  company: { findFirst: vi.fn(async () => ({ id: "company-1" })) },
  pipeline: { findFirst: vi.fn() },
  pipelineStage: { findFirst: vi.fn() },
  activity: { createMany: effects.activityCreateMany },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { ...client, $transaction: async (fn: (tx: unknown) => unknown) => fn(client) },
  logAudit: effects.logAudit,
}))
vi.mock("@/lib/sharing-rules", () => ({ applyRecordFilter: db.applyRecordFilter }))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: effects.executeWorkflows }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: effects.fireWebhooks }))
vi.mock("@/lib/notifications", () => ({ createNotification: effects.createNotification }))
vi.mock("@/lib/project-rollup", () => ({ recalcProjectCompletion: effects.recalcProjectCompletion }))
vi.mock("@/lib/recurrence/spawn", () => ({ spawnNextRecurringTask: effects.spawnNextRecurringTask }))
vi.mock("@/lib/resolve-related", () => ({ resolveRelated: vi.fn(async () => ({ name: "x" })) }))
vi.mock("@/lib/custom-fields-validation", () => ({ validateRequiredCustomFields: vi.fn(async () => null) }))
vi.mock("@/lib/tasks/task-types", () => ({
  isValidTaskType: vi.fn(async () => true),
  isValidEventType: vi.fn(async () => true),
}))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async () => ({})),
  requireFieldPermissions: vi.fn(async () => ({})),
  filterWritableFields: vi.fn((data: Record<string, unknown>) => data),
  filterEntityFields: vi.fn((data: Record<string, unknown>) => data),
}))

import { updateTaskCommand } from "@/lib/crm-commands/task/update-task"
import { updateDealCommand } from "@/lib/crm-commands/deal/update-deal"
import {
  dispatchCollectedCommandEffects,
  type CrmCommandPostCommitEffect,
} from "@/lib/crm-commands/execution-context"

const VERSION = new Date("2026-09-21T09:00:00.000Z")
const LATER = new Date("2026-09-21T09:05:00.000Z")

const voice = (role: "admin" | "sales" = "admin") => ({
  organizationId: "org-1",
  userId: "user-1",
  role,
  source: "voice" as const,
  voiceSessionId: "voice-1",
})

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    title: "Call Ali",
    status: "pending",
    assignedTo: "user-1",
    createdBy: "user-1",
    divisionId: null,
    projectId: null,
    relatedType: null,
    relatedId: null,
    boardColumnKey: null,
    recurrenceRule: null,
    customFields: null,
    updatedAt: VERSION,
    ...overrides,
  }
}

function deal(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    name: "Azmart",
    stage: "Negotiation",
    valueAmount: 1000,
    currency: "AZN",
    assignedTo: "user-1",
    pipelineId: null,
    stageChangedAt: null,
    companyId: null,
    contactId: null,
    status: "open",
    updatedAt: VERSION,
    ...overrides,
  }
}

function anyEffectFired(): boolean {
  return [effects.logAudit, effects.executeWorkflows, effects.fireWebhooks, effects.createNotification]
    .some((mock) => mock.mock.calls.length > 0)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.taskFindFirst.mockResolvedValue(task())
  db.taskUpdateMany.mockResolvedValue({ count: 1 })
  db.dealFindFirst.mockResolvedValue(deal())
  db.dealUpdateMany.mockResolvedValue({ count: 1 })
  db.userFindFirst.mockResolvedValue({ id: "user-2" })
  db.applyRecordFilter.mockImplementation(async (_o, _u, _r, _t, where) => where)
})

describe("a voice task update", () => {
  it("must carry the version the user reviewed", async () => {
    await expect(updateTaskCommand(voice(), "task-1", { status: "completed" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    expect(db.taskUpdateMany).not.toHaveBeenCalled()
  })

  // The receipt is the whole mutation: a field outside the voice list could
  // only arrive by something other than the user's sentence.
  it("refuses a field that voice does not offer", async () => {
    await expect(updateTaskCommand(voice(), "task-1", {
      projectId: "project-9",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_FIELD" })
    expect(db.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("refuses a task that changed after the receipt was read", async () => {
    db.taskFindFirst.mockResolvedValue(task({ updatedAt: LATER }))
    await expect(updateTaskCommand(voice(), "task-1", {
      title: "Call Ali back",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "STALE_WRITE" })
    expect(db.taskUpdateMany).not.toHaveBeenCalled()
  })

  // The check above and the write are separated by other queries; the write
  // itself must carry the version too.
  it("refuses it when the task changes between the check and the write", async () => {
    db.taskUpdateMany.mockResolvedValue({ count: 0 })
    await expect(updateTaskCommand(voice(), "task-1", {
      title: "Call Ali back",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "STALE_WRITE" })
    expect(db.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", organizationId: "org-1", updatedAt: VERSION },
    }))
  })

  it("only reaches a task the user may see", async () => {
    db.applyRecordFilter.mockImplementation(async (_o, _u, _r, _t, where) => ({ ...where, assignedTo: "user-1" }))
    db.taskFindFirst.mockResolvedValue(null)
    await expect(updateTaskCommand(voice("sales"), "task-1", {
      title: "x",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(db.applyRecordFilter).toHaveBeenCalledWith("org-1", "user-1", "sales", "task", expect.anything())
  })

  // "Закрой задачу" on a board goes through the same gate as a drag to Done:
  // moving to done is for managers and the board's head.
  it("leaves closing a board task to the board's own permissions", async () => {
    db.taskFindFirst.mockResolvedValue(task({ divisionId: "division-1", status: "in_progress" }))
    await expect(updateTaskCommand(voice("sales"), "task-1", {
      status: "done",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(db.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("announces nothing until the transaction commits, then all of it", async () => {
    db.taskFindFirst
      .mockResolvedValueOnce(task({ recurrenceRule: "weekly", projectId: "project-1" }))
      .mockResolvedValueOnce(task({ status: "completed", recurrenceRule: "weekly", projectId: "project-1" }))
    const postCommitEffects: CrmCommandPostCommitEffect[] = []
    await updateTaskCommand(voice(), "task-1", {
      status: "completed",
      expectedUpdatedAt: VERSION.toISOString(),
    }, { transaction: client as never, postCommitEffects })

    expect(anyEffectFired()).toBe(false)
    expect(db.taskActivityCreateMany).toHaveBeenCalled()

    dispatchCollectedCommandEffects(postCommitEffects)
    await vi.waitFor(() => expect(effects.spawnNextRecurringTask).toHaveBeenCalled())
    expect(effects.logAudit).toHaveBeenCalledWith(
      "org-1", "update", "task", "task-1", "Call Ali",
      expect.objectContaining({ userId: "user-1" }),
    )
    expect(effects.createNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Task Completed" }))
    expect(effects.recalcProjectCompletion).toHaveBeenCalledWith("project-1", "org-1")
  })
})

describe("a voice deal update", () => {
  // A stage move can mark a deal won, which pays cashback and surveys the
  // customer. Not from a spoken sentence.
  it.each(["stage", "pipelineId", "probability", "lostReason"])("refuses %s", async (field) => {
    await expect(updateDealCommand(voice(), "deal-1", {
      [field]: field === "probability" ? 90 : "x",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_FIELD" })
    expect(db.dealUpdateMany).not.toHaveBeenCalled()
  })

  it("refuses a deal that changed after the receipt was read", async () => {
    db.dealFindFirst.mockResolvedValue(deal({ updatedAt: LATER }))
    await expect(updateDealCommand(voice(), "deal-1", {
      valueAmount: 2000,
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "STALE_WRITE" })
    expect(db.dealUpdateMany).not.toHaveBeenCalled()
  })

  it("writes under the reviewed version and refuses when it moved", async () => {
    db.dealUpdateMany.mockResolvedValue({ count: 0 })
    await expect(updateDealCommand(voice(), "deal-1", {
      valueAmount: 2000,
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "STALE_WRITE" })
    expect(db.dealUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "deal-1", organizationId: "org-1", updatedAt: VERSION },
    }))
  })

  it("refuses an assignee who is no longer an active colleague", async () => {
    db.userFindFirst.mockResolvedValue(null)
    await expect(updateDealCommand(voice(), "deal-1", {
      assignedTo: "user-gone",
      expectedUpdatedAt: VERSION.toISOString(),
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
  })

  it("announces nothing until the transaction commits, then records who did it", async () => {
    const postCommitEffects: CrmCommandPostCommitEffect[] = []
    await updateDealCommand(voice(), "deal-1", {
      valueAmount: 2000,
      expectedUpdatedAt: VERSION.toISOString(),
    }, { transaction: client as never, postCommitEffects })

    expect(anyEffectFired()).toBe(false)
    dispatchCollectedCommandEffects(postCommitEffects)
    await vi.waitFor(() => expect(effects.fireWebhooks).toHaveBeenCalled())
    expect(effects.logAudit).toHaveBeenCalledWith(
      "org-1", "update", "deal", "deal-1", "Azmart",
      expect.objectContaining({ userId: "user-1", newValue: { valueAmount: 2000 } }),
    )
    expect(effects.activityCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ subject: "Value: 1,000 → 2,000", createdBy: "user-1" })],
    }))
  })
})
