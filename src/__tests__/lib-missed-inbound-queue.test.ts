import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/calls/access", () => ({
  accessibleCallWhere: vi.fn(() => ({ id: "accessible-call" })),
}))

import {
  MISSED_INBOUND_QUEUE_LIMIT,
  MissedInboundQueueError,
  claimMissedInboundQueueTask,
  listMissedInboundQueue,
} from "@/lib/calls/missed-inbound-queue"
import {
  MISSED_INBOUND_SOURCE_FIELD,
  MISSED_INBOUND_TASK_FIELD,
  missedInboundTaskId,
} from "@/lib/calls/missed-inbound-reconciliation"

const auth = {
  orgId: "org-1",
  userId: "manager-1",
  role: "manager" as const,
}

const task = {
  id: missedInboundTaskId("call-1"),
  status: "pending",
  assignedTo: null,
  customFields: {
    [MISSED_INBOUND_TASK_FIELD]: "call-1",
    [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
  },
}

const call = {
  id: "call-1",
  leadId: "lead-1",
  endedAt: new Date("2026-08-27T08:30:00.000Z"),
}

function harness() {
  const taskFindMany = vi.fn().mockResolvedValue([])
  const callLogFindMany = vi.fn().mockResolvedValue([])
  const taskFindFirst = vi.fn().mockResolvedValue(task)
  const callLogFindFirst = vi.fn().mockResolvedValue(call)
  const taskUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const taskUpdate = vi.fn()
  const callLogUpdate = vi.fn()
  const callLogUpdateMany = vi.fn()
  const leadUpdate = vi.fn()
  const leadUpdateMany = vi.fn()
  const taskActivityCreate = vi.fn().mockResolvedValue({ id: "activity-1" })
  const tx = {
    task: {
      findFirst: taskFindFirst,
      updateMany: taskUpdateMany,
      update: taskUpdate,
    },
    callLog: {
      findFirst: callLogFindFirst,
      update: callLogUpdate,
      updateMany: callLogUpdateMany,
    },
    lead: {
      update: leadUpdate,
      updateMany: leadUpdateMany,
    },
    taskActivity: { create: taskActivityCreate },
  }
  const transactionRejected = vi.fn()
  const transaction = vi.fn().mockImplementation(
    async (work: (client: typeof tx) => Promise<unknown>) => {
      try {
        return await work(tx)
      } catch (error) {
        transactionRejected(error)
        throw error
      }
    },
  )
  const client = {
    task: { findMany: taskFindMany },
    callLog: { findMany: callLogFindMany },
    $transaction: transaction,
  }

  return {
    client,
    taskFindMany,
    callLogFindMany,
    taskFindFirst,
    callLogFindFirst,
    taskUpdateMany,
    taskUpdate,
    callLogUpdate,
    callLogUpdateMany,
    leadUpdate,
    leadUpdateMany,
    taskActivityCreate,
    transaction,
    transactionRejected,
  }
}

describe("missed inbound manager queue", () => {
  it("lists only bounded, unassigned, open reconciler tasks and projects no phone data", async () => {
    const h = harness()
    h.taskFindMany.mockResolvedValueOnce([
      task,
      {
        id: "malformed-task",
        status: "pending",
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: 42,
          [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
        },
      },
      {
        id: "forged-task-id",
        status: "pending",
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: "call-forged",
          [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
        },
      },
      {
        id: missedInboundTaskId("call-wrong-source"),
        status: "pending",
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: "call-wrong-source",
          [MISSED_INBOUND_SOURCE_FIELD]: "other",
        },
      },
    ])
    h.callLogFindMany.mockResolvedValueOnce([call])

    await expect(listMissedInboundQueue(h.client as never, auth)).resolves.toEqual([
      {
        taskId: task.id,
        status: "pending",
        missedAt: "2026-08-27T08:30:00.000Z",
        leadId: "lead-1",
      },
    ])

    expect(MISSED_INBOUND_QUEUE_LIMIT).toBe(50)
    expect(h.taskFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: auth.orgId,
        assignedTo: null,
        deletedAt: null,
        divisionId: null,
        status: { notIn: ["completed", "done", "cancelled"] },
        AND: [
          {
            customFields: {
              path: [MISSED_INBOUND_SOURCE_FIELD],
              equals: "asterisk",
            },
          },
          {
            customFields: {
              path: [MISSED_INBOUND_TASK_FIELD],
              not: expect.anything(),
            },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        customFields: true,
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 100,
    })
    expect(h.callLogFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: auth.orgId,
        id: { in: ["call-1"] },
        leadId: { not: null },
        AND: [
          {
            provider: "asterisk",
            direction: "inbound",
            callMode: "human",
            status: "no-answer",
            providerOutcome: "no_answer",
            wasAnswered: false,
            endedAt: { not: null },
            providerCallId: { not: null },
            callEvents: {
              some: {
                provider: "asterisk",
                eventType: "asterisk_human_call_lifecycle",
                eventHash: { startsWith: "asterisk-human-lifecycle-v1:" },
                payload: { path: ["state"], equals: "no_answer" },
              },
            },
          },
          { id: "accessible-call" },
        ],
      },
      select: { id: true, leadId: true, endedAt: true },
    })
    expect(JSON.stringify(await listMissedInboundQueue(h.client as never, auth))).not.toMatch(
      /fromNumber|toNumber|targetPhoneE164|providerCallId|recordingUrl/u,
    )
  })

  it("omits reconciler tasks whose call is malformed, inaccessible, corrected, or has no lead", async () => {
    const h = harness()
    h.taskFindMany.mockResolvedValueOnce([
      task,
      {
        id: missedInboundTaskId("call-2"),
        status: "pending",
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: "call-2",
          [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
        },
      },
    ])
    h.callLogFindMany.mockResolvedValueOnce([])

    await expect(listMissedInboundQueue(h.client as never, auth)).resolves.toEqual([])
  })

  it("does not let a full page of rejected tasks starve the next valid missed call", async () => {
    const h = harness()
    const rejectedTasks = Array.from({ length: 100 }, (_, index) => ({
      id: missedInboundTaskId(`rejected-call-${index}`),
      status: "pending",
      customFields: {
        [MISSED_INBOUND_TASK_FIELD]: `rejected-call-${index}`,
        [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
      },
    }))
    const nextTask = {
      id: missedInboundTaskId("call-51"),
      status: "pending",
      customFields: {
        [MISSED_INBOUND_TASK_FIELD]: "call-51",
        [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
      },
    }
    const nextCall = {
      id: "call-51",
      leadId: "lead-51",
      endedAt: new Date("2026-08-27T08:31:00.000Z"),
    }
    const candidates = [...rejectedTasks, nextTask]
    h.taskFindMany.mockImplementation(async (args: {
      cursor?: { id: string }
      take?: number
    }) => {
      const cursorIndex = args.cursor
        ? candidates.findIndex((candidate) => candidate.id === args.cursor?.id)
        : -1
      const start = cursorIndex + 1
      return candidates.slice(start, start + (args.take ?? candidates.length))
    })
    h.callLogFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([nextCall])

    await expect(listMissedInboundQueue(h.client as never, auth)).resolves.toEqual([
      {
        taskId: nextTask.id,
        status: "pending",
        missedAt: "2026-08-27T08:31:00.000Z",
        leadId: "lead-51",
      },
    ])

    expect(h.taskFindMany).toHaveBeenCalledTimes(2)
    expect(h.taskFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: { id: rejectedTasks.at(-1)?.id },
      skip: 1,
      take: 100,
    }))
  })

  it("fails closed instead of showing an empty queue when the bounded scan is exhausted", async () => {
    const h = harness()
    const candidates = Array.from({ length: 501 }, (_, index) => ({
      id: missedInboundTaskId(`stale-call-${index}`),
      status: "pending",
      customFields: {
        [MISSED_INBOUND_TASK_FIELD]: `stale-call-${index}`,
        [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
      },
    }))
    h.taskFindMany.mockImplementation(async (args: {
      cursor?: { id: string }
      take?: number
    }) => {
      const cursorIndex = args.cursor
        ? candidates.findIndex((candidate) => candidate.id === args.cursor?.id)
        : -1
      const start = cursorIndex + 1
      return candidates.slice(start, start + (args.take ?? candidates.length))
    })
    h.callLogFindMany.mockResolvedValue([])

    await expect(listMissedInboundQueue(h.client as never, auth)).rejects.toThrow(
      "missed_inbound_queue_scan_limit",
    )
    expect(h.taskFindMany).toHaveBeenCalledTimes(6)
    expect(h.callLogFindMany).toHaveBeenCalledTimes(5)
    expect(h.taskFindMany).toHaveBeenNthCalledWith(6, expect.objectContaining({
      cursor: { id: candidates[499].id },
      skip: 1,
      take: 1,
    }))
  })

  it("claims through one exact task updateMany CAS and audits inside the same transaction", async () => {
    const h = harness()

    await expect(
      claimMissedInboundQueueTask(h.client as never, auth, task.id),
    ).resolves.toEqual({ taskId: task.id, leadId: "lead-1" })

    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.taskFindFirst).toHaveBeenCalledWith({
      where: {
        id: task.id,
        organizationId: auth.orgId,
        deletedAt: null,
        divisionId: null,
        status: { notIn: ["completed", "done", "cancelled"] },
      },
      select: { id: true, status: true, assignedTo: true, customFields: true },
    })
    expect(h.callLogFindFirst).toHaveBeenCalledWith({
      where: {
        id: "call-1",
        organizationId: auth.orgId,
        leadId: { not: null },
        AND: [
          {
            provider: "asterisk",
            direction: "inbound",
            callMode: "human",
            status: "no-answer",
            providerOutcome: "no_answer",
            wasAnswered: false,
            endedAt: { not: null },
            providerCallId: { not: null },
            callEvents: {
              some: {
                provider: "asterisk",
                eventType: "asterisk_human_call_lifecycle",
                eventHash: { startsWith: "asterisk-human-lifecycle-v1:" },
                payload: { path: ["state"], equals: "no_answer" },
              },
            },
          },
          { id: "accessible-call" },
        ],
      },
      select: { id: true, leadId: true },
    })
    expect(h.taskUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: task.id,
        organizationId: auth.orgId,
        assignedTo: null,
        deletedAt: null,
        divisionId: null,
        status: { notIn: ["completed", "done", "cancelled"] },
        AND: [
          {
            customFields: {
              path: [MISSED_INBOUND_TASK_FIELD],
              equals: "call-1",
            },
          },
          {
            customFields: {
              path: [MISSED_INBOUND_SOURCE_FIELD],
              equals: "asterisk",
            },
          },
        ],
      },
      data: { assignedTo: auth.userId },
    })
    expect(h.taskActivityCreate).toHaveBeenCalledWith({
      data: {
        organizationId: auth.orgId,
        taskId: task.id,
        userId: auth.userId,
        action: "assignee_changed",
        oldValue: null,
        newValue: auth.userId,
        metadata: { source: "missed_inbound_queue" },
      },
    })
    expect(h.taskUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.taskActivityCreate.mock.invocationCallOrder[0],
    )
    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.callLogUpdate).not.toHaveBeenCalled()
    expect(h.callLogUpdateMany).not.toHaveBeenCalled()
    expect(h.leadUpdate).not.toHaveBeenCalled()
    expect(h.leadUpdateMany).not.toHaveBeenCalled()
  })

  it("gives exactly one winner and one conflict when managers race for the same task", async () => {
    const h = harness()
    h.taskUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const results = await Promise.allSettled([
      claimMissedInboundQueueTask(h.client as never, auth, task.id),
      claimMissedInboundQueueTask(
        h.client as never,
        { ...auth, userId: "manager-2" },
        task.id,
      ),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ code: "already_claimed" }),
    })
    expect(h.taskUpdateMany).toHaveBeenCalledTimes(2)
    expect(h.taskActivityCreate).toHaveBeenCalledTimes(1)
  })

  it("returns a conflict when the winner committed before the loser reads", async () => {
    const h = harness()
    h.taskFindFirst.mockResolvedValueOnce({ ...task, assignedTo: "manager-2" })

    await expect(
      claimMissedInboundQueueTask(h.client as never, auth, task.id),
    ).rejects.toMatchObject({ code: "already_claimed" })

    expect(h.callLogFindFirst).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
    expect(h.taskActivityCreate).not.toHaveBeenCalled()
  })

  it.each([
    { label: "missing task", taskRow: null, callRow: call, expectsCallLookup: false },
    {
      label: "malformed marker",
      taskRow: { ...task, customFields: { [MISSED_INBOUND_TASK_FIELD]: 12 } },
      callRow: call,
      expectsCallLookup: false,
    },
    {
      label: "mismatched deterministic task identity",
      taskRow: { ...task, id: "forged-task-id" },
      callRow: call,
      expectsCallLookup: false,
    },
    {
      label: "wrong reconciler source",
      taskRow: {
        ...task,
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: "call-1",
          [MISSED_INBOUND_SOURCE_FIELD]: "other",
        },
      },
      callRow: call,
      expectsCallLookup: false,
    },
    {
      label: "inaccessible or corrected call",
      taskRow: task,
      callRow: null,
      expectsCallLookup: true,
    },
  ])("does not mutate for a $label", async ({ taskRow, callRow, expectsCallLookup }) => {
    const h = harness()
    h.taskFindFirst.mockResolvedValueOnce(taskRow)
    h.callLogFindFirst.mockResolvedValueOnce(callRow)

    await expect(
      claimMissedInboundQueueTask(h.client as never, auth, task.id),
    ).rejects.toBeInstanceOf(MissedInboundQueueError)
    expect(h.callLogFindFirst).toHaveBeenCalledTimes(expectsCallLookup ? 1 : 0)
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
    expect(h.taskActivityCreate).not.toHaveBeenCalled()
  })

  it("rejects the transaction when audit persistence fails so assignment cannot commit alone", async () => {
    const h = harness()
    h.taskActivityCreate.mockRejectedValueOnce(new Error("audit unavailable"))

    await expect(
      claimMissedInboundQueueTask(h.client as never, auth, task.id),
    ).rejects.toThrow("audit unavailable")
    expect(h.taskUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.transactionRejected).toHaveBeenCalledTimes(1)
  })

  it("imports only database types and the two pure call-access contracts", () => {
    const source = readFileSync(
      "src/lib/calls/missed-inbound-queue.ts",
      "utf8",
    )
    const imports = Array.from(
      source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      (match) => match[1],
    ).sort()

    expect(imports).toEqual([
      "@/lib/calls/access",
      "@/lib/calls/missed-inbound-reconciliation",
      "@/lib/tasks/status",
      "@prisma/client",
    ])
    for (const forbidden of [
      "fetch(",
      "getVoipProvider",
      "initiateCall",
      "executeWorkflows",
      "createNotification",
      "sendEmail",
      "sendSms",
      "deliverNotificationPush",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
