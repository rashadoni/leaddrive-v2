/**
 * The handover when the one automatic callback rings out.
 *
 * "Once" means one dial. After it, the machine is done — what these tests prove
 * is that the broken conversation lands in front of a person exactly once, and
 * that nothing else ever grows a task out of this path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  taskCreate: vi.fn(),
  leadFindFirst: vi.fn(),
  notification: vi.fn(),
  boardSlot: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findFirst: mocks.callLogFindFirst },
    task: { findFirst: mocks.taskFindFirst, create: mocks.taskCreate },
    lead: { findFirst: mocks.leadFindFirst },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.notification }))
vi.mock("@/lib/tasks/sales-board", () => ({ resolveSalesBoardSlot: mocks.boardSlot }))

import { recordUnansweredCallback } from "@/lib/voice-agent/callback-fallback-task"

const ORG = "org-test"

function callbackCall(overrides: Record<string, unknown> = {}) {
  return {
    continuesCallId: "call-original",
    wasAnswered: false,
    leadId: "lead-1",
    userId: "user-1",
    ...overrides,
  }
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.callLogFindFirst.mockResolvedValue(callbackCall())
  mocks.taskFindFirst.mockResolvedValue(null)
  mocks.taskCreate.mockResolvedValue({ id: "task-1" })
  mocks.leadFindFirst.mockResolvedValue({ assignedTo: "user-owner" })
  mocks.notification.mockResolvedValue(undefined)
  mocks.boardSlot.mockResolvedValue({ divisionId: "div-1", columnKey: "todo", position: 0 })
})

describe("recordUnansweredCallback", () => {
  it("files the handover on the sales board for the lead owner", async () => {
    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: true, taskId: "task-1" })
    expect(mocks.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        assignedTo: "user-owner",
        priority: "high",
        divisionId: "div-1",
        customFields: { callbackFallbackCallId: "call-cb" },
      }),
    }))
    expect(mocks.notification).toHaveBeenCalled()
  })

  it("ignores every ordinary unanswered call", async () => {
    // The queue machinery owns those. This path exists only for the callback.
    mocks.callLogFindFirst.mockResolvedValue(callbackCall({ continuesCallId: null }))

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: false, reason: "not-a-callback" })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  it("does nothing when the callback was answered", async () => {
    mocks.callLogFindFirst.mockResolvedValue(callbackCall({ wasAnswered: true }))

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: false, reason: "was-answered" })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  it("files the task once no matter how often the webhook repeats", async () => {
    mocks.taskFindFirst.mockResolvedValue({ id: "task-existing" })

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: false, reason: "already-recorded" })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  it("refuses to file a task against an empty seat", async () => {
    // A task nobody owns is a task nobody does — same rule as commitments.
    mocks.callLogFindFirst.mockResolvedValue(callbackCall({ userId: null }))
    mocks.leadFindFirst.mockResolvedValue({ assignedTo: null })

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: false, reason: "no-assignee" })
    expect(mocks.taskCreate).not.toHaveBeenCalled()
  })

  it("survives the board being unresolvable", async () => {
    mocks.boardSlot.mockRejectedValue(new Error("no board"))

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: true, taskId: "task-1" })
    // Filed without board placement rather than not filed at all.
    expect(mocks.taskCreate.mock.calls[0][0].data).not.toHaveProperty("divisionId")
  })

  it("reports an error instead of throwing into the webhook", async () => {
    mocks.callLogFindFirst.mockRejectedValue(new Error("db down"))

    await expect(recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" }))
      .resolves.toEqual({ created: false, reason: "error" })
  })

  it("does not let a failed notification undo the filed task", async () => {
    mocks.notification.mockRejectedValue(new Error("push down"))

    const result = await recordUnansweredCallback({ organizationId: ORG, callLogId: "call-cb" })

    expect(result).toEqual({ created: true, taskId: "task-1" })
  })
})
