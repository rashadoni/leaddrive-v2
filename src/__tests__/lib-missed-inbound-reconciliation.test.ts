import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  MISSED_INBOUND_RECONCILED_EVENT_TYPE,
  MISSED_INBOUND_SOURCE_FIELD,
  MISSED_INBOUND_TASK_FIELD,
  missedInboundTaskId,
  reconcileMissedInboundCalls,
} from "@/lib/calls/missed-inbound-reconciliation"

type Candidate = {
  id: string
  organizationId: string
  providerCallId: string
  leadId: string | null
  contactId: string | null
  endedAt: Date
}

const candidate: Candidate = {
  id: "call-1",
  organizationId: "org-1",
  providerCallId: "87b33d58-bf40-4cf8-aa0a-bf5388f29d11",
  leadId: "lead-1",
  contactId: "contact-1",
  endedAt: new Date("2026-08-27T08:30:00.000Z"),
}

function taskFor(
  call: Candidate,
  patch: Record<string, unknown> = {},
) {
  return {
    id: missedInboundTaskId(call.id),
    organizationId: call.organizationId,
    status: "pending",
    deletedAt: null,
    completedAt: null,
    customFields: {
      [MISSED_INBOUND_TASK_FIELD]: call.id,
      [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
    },
    ...patch,
  }
}

function harness() {
  const callLogFindMany = vi.fn().mockResolvedValue([])
  const callLogFindFirst = vi.fn().mockResolvedValue(candidate)
  const callEventCreateMany = vi.fn().mockResolvedValue({ count: 1 })
  const taskCreateMany = vi.fn().mockResolvedValue({ count: 1 })
  const taskFindMany = vi.fn().mockImplementation(
    async (args: { where?: { deletedAt?: unknown } }) => {
      const deletedAt = args.where?.deletedAt
      if (deletedAt && typeof deletedAt === "object") return []
      return [taskFor(candidate)]
    },
  )
  const taskUpdate = vi.fn()
  const taskUpdateMany = vi.fn()
  const tx = {
    callLog: { findFirst: callLogFindFirst },
    callEvent: { createMany: callEventCreateMany },
    task: {
      createMany: taskCreateMany,
      findMany: taskFindMany,
      update: taskUpdate,
      updateMany: taskUpdateMany,
    },
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
    callLog: { findMany: callLogFindMany },
    $transaction: transaction,
  }

  return {
    client,
    tx,
    callLogFindMany,
    callLogFindFirst,
    callEventCreateMany,
    taskCreateMany,
    taskFindMany,
    taskUpdate,
    taskUpdateMany,
    transaction,
    transactionRejected,
  }
}

describe("missed inbound call reconciliation", () => {
  it("selects only bounded, proven, oldest-first Asterisk human misses", async () => {
    const h = harness()

    await reconcileMissedInboundCalls(h.client as never)

    expect(h.callLogFindMany).toHaveBeenCalledWith({
      where: {
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
          none: {
            provider: "asterisk",
            eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
          },
        },
      },
      select: {
        id: true,
        organizationId: true,
        providerCallId: true,
        leadId: true,
        contactId: true,
        endedAt: true,
      },
      orderBy: [{ endedAt: "asc" }, { id: "asc" }],
      take: 100,
    })
    const selector = h.callLogFindMany.mock.calls[0]?.[0]
    expect(selector?.select).not.toHaveProperty("fromNumber")
    expect(selector?.select).not.toHaveProperty("toNumber")
    expect(selector?.select).not.toHaveProperty("targetPhoneE164")
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it("persists the unique event fence before one generic unassigned task in the same transaction", async () => {
    const h = harness()
    h.callLogFindMany.mockResolvedValueOnce([candidate])

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toEqual({
      selected: 1,
      reconciled: 1,
      alreadyReconciled: 0,
      failed: 0,
    })

    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.callLogFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: candidate.id,
        organizationId: candidate.organizationId,
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        status: "no-answer",
        providerOutcome: "no_answer",
        wasAnswered: false,
        endedAt: candidate.endedAt,
        providerCallId: candidate.providerCallId,
        callEvents: expect.objectContaining({
          some: expect.objectContaining({
            eventType: "asterisk_human_call_lifecycle",
            payload: { path: ["state"], equals: "no_answer" },
          }),
          none: expect.objectContaining({
            eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
            eventHash: `asterisk-missed-inbound-reconciled-v1:${candidate.id}`,
          }),
        }),
      }),
      select: {
        id: true,
        organizationId: true,
        providerCallId: true,
        leadId: true,
        contactId: true,
        endedAt: true,
      },
    })
    expect(h.callEventCreateMany).toHaveBeenCalledWith({
      data: {
        organizationId: candidate.organizationId,
        callLogId: candidate.id,
        provider: "asterisk",
        providerCallId: candidate.providerCallId,
        eventType: MISSED_INBOUND_RECONCILED_EVENT_TYPE,
        eventHash: `asterisk-missed-inbound-reconciled-v1:${candidate.id}`,
        payload: { version: 1, state: "task_recorded" },
      },
      skipDuplicates: true,
    })
    expect(h.taskCreateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: missedInboundTaskId(candidate.id),
        organizationId: candidate.organizationId,
        title: expect.any(String),
        description: expect.any(String),
        status: "pending",
        priority: "high",
        dueDate: candidate.endedAt,
        assignedTo: null,
        relatedType: "lead",
        relatedId: candidate.leadId,
        customFields: {
          [MISSED_INBOUND_TASK_FIELD]: candidate.id,
          [MISSED_INBOUND_SOURCE_FIELD]: "asterisk",
        },
      }),
      skipDuplicates: true,
    })
    expect(h.callEventCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.taskCreateMany.mock.invocationCallOrder[0],
    )
    const taskData = h.taskCreateMany.mock.calls[0]?.[0]?.data
    const safeTaskText = JSON.stringify(taskData)
    expect(safeTaskText).not.toContain(candidate.providerCallId)
    expect(taskData).not.toHaveProperty("divisionId")
    expect(taskData).not.toHaveProperty("boardColumnKey")
    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("does not touch a task when another worker already owns the event fence", async () => {
    const h = harness()
    h.callLogFindMany.mockResolvedValueOnce([candidate])
    h.callEventCreateMany.mockResolvedValueOnce({ count: 0 })

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toEqual({
      selected: 1,
      reconciled: 0,
      alreadyReconciled: 1,
      failed: 0,
    })

    expect(h.taskCreateMany).not.toHaveBeenCalled()
    expect(h.taskFindMany).not.toHaveBeenCalled()
    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("writes nothing when the exact missed-call proof disappears during revalidation", async () => {
    const h = harness()
    h.callLogFindMany.mockResolvedValueOnce([candidate])
    h.callLogFindFirst.mockResolvedValueOnce(null)

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toEqual({
      selected: 1,
      reconciled: 0,
      alreadyReconciled: 1,
      failed: 0,
    })

    expect(h.callEventCreateMany).not.toHaveBeenCalled()
    expect(h.taskCreateMany).not.toHaveBeenCalled()
    expect(h.taskFindMany).not.toHaveBeenCalled()
    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("lets concurrent scans create exactly one marker and one task", async () => {
    const h = harness()
    h.callLogFindMany.mockResolvedValue([candidate])
    let markerExists = false
    h.callEventCreateMany.mockImplementation(async () => {
      if (markerExists) return { count: 0 }
      markerExists = true
      return { count: 1 }
    })

    const [left, right] = await Promise.all([
      reconcileMissedInboundCalls(h.client as never),
      reconcileMissedInboundCalls(h.client as never),
    ])

    expect(left.reconciled + right.reconciled).toBe(1)
    expect(left.alreadyReconciled + right.alreadyReconciled).toBe(1)
    expect(h.callEventCreateMany).toHaveBeenCalledTimes(2)
    expect(h.taskCreateMany).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: "completed",
      active: [taskFor(candidate, {
        status: "completed",
        completedAt: new Date("2026-08-27T09:00:00.000Z"),
      })],
      deleted: [],
    },
    {
      label: "soft-deleted",
      active: [],
      deleted: [taskFor(candidate, {
        deletedAt: new Date("2026-08-27T09:00:00.000Z"),
      })],
    },
  ])("keeps an existing $label deterministic task byte-for-byte unchanged", async ({ active, deleted }) => {
    const h = harness()
    h.callLogFindMany.mockResolvedValueOnce([candidate])
    h.taskCreateMany.mockResolvedValueOnce({ count: 0 })
    h.taskFindMany
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(deleted)

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toMatchObject({
      selected: 1,
      reconciled: 1,
      failed: 0,
    })

    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
    expect(h.taskFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: missedInboundTaskId(candidate.id),
        organizationId: candidate.organizationId,
        deletedAt: null,
      }),
    }))
    if (deleted.length > 0) {
      expect(h.taskFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          id: missedInboundTaskId(candidate.id),
          organizationId: candidate.organizationId,
          deletedAt: { not: null },
        }),
      }))
    }
  })

  it("fails the candidate transaction on a deterministic task identity collision", async () => {
    const h = harness()
    h.callLogFindMany.mockResolvedValueOnce([candidate])
    h.taskCreateMany.mockResolvedValueOnce({ count: 0 })
    h.taskFindMany
      .mockResolvedValueOnce([taskFor(candidate, {
        customFields: { unrelated: "collision" },
      })])
      .mockResolvedValueOnce([])

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toEqual({
      selected: 1,
      reconciled: 0,
      alreadyReconciled: 0,
      failed: 1,
    })

    expect(h.callEventCreateMany).toHaveBeenCalledTimes(1)
    expect(h.transactionRejected).toHaveBeenCalledTimes(1)
    expect(h.transactionRejected.mock.calls[0]?.[0]).toEqual(expect.any(Error))
    expect(h.taskUpdate).not.toHaveBeenCalled()
    expect(h.taskUpdateMany).not.toHaveBeenCalled()
  })

  it("rolls back one poison row and continues reconciling later candidates", async () => {
    const h = harness()
    const later: Candidate = {
      ...candidate,
      id: "call-2",
      providerCallId: "0b01be30-bd84-4e5f-bc71-bb77d22cf6bf",
      leadId: "lead-2",
      contactId: null,
      endedAt: new Date("2026-08-27T08:31:00.000Z"),
    }
    h.callLogFindMany.mockResolvedValueOnce([candidate, later])
    h.callLogFindFirst
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(later)
    h.taskCreateMany
      .mockRejectedValueOnce(new Error("poison deterministic task"))
      .mockResolvedValueOnce({ count: 1 })
    h.taskFindMany.mockResolvedValueOnce([taskFor(later)])

    await expect(reconcileMissedInboundCalls(h.client as never)).resolves.toEqual({
      selected: 2,
      reconciled: 1,
      alreadyReconciled: 0,
      failed: 1,
    })

    expect(h.transaction).toHaveBeenCalledTimes(2)
    expect(h.transactionRejected).toHaveBeenCalledTimes(1)
    expect(h.callEventCreateMany).toHaveBeenCalledTimes(2)
    expect(h.taskCreateMany).toHaveBeenCalledTimes(2)
    expect(h.taskCreateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: missedInboundTaskId(later.id),
        relatedType: "lead",
        relatedId: later.leadId,
      }),
    }))
  })

  it.each([
    { leadId: "lead-1", contactId: "contact-1", relatedType: "lead", relatedId: "lead-1" },
    { leadId: null, contactId: "contact-1", relatedType: "contact", relatedId: "contact-1" },
    { leadId: null, contactId: null, relatedType: "call", relatedId: "call-1" },
  ])("uses lead, then contact, then the internal call as the safe relation", async (relation) => {
    const h = harness()
    const row = { ...candidate, leadId: relation.leadId, contactId: relation.contactId }
    h.callLogFindMany.mockResolvedValueOnce([row])
    h.callLogFindFirst.mockResolvedValueOnce(row)
    h.taskFindMany.mockResolvedValueOnce([taskFor(row)])

    await reconcileMissedInboundCalls(h.client as never)

    expect(h.taskCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        relatedType: relation.relatedType,
        relatedId: relation.relatedId,
        assignedTo: null,
      }),
    }))
  })

  it("has a type-only Prisma import and no runtime dependency path", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/calls/missed-inbound-reconciliation.ts"),
      "utf8",
    )

    const imports = Array.from(
      source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      (match) => match[1],
    )
    expect(imports).toEqual(["@prisma/client"])
    expect(source).toMatch(/import\s+type\s+\{\s*Prisma\s*\}\s+from\s+["']@prisma\/client["']/u)

    for (const forbidden of [
      "executeWorkflows",
      "getVoipProvider",
      "createNotification",
      "sendEmail",
      "sendSms",
      "fetch(",
      "globalThis.fetch",
      "axios",
      "undici",
      "node:http",
      "node:https",
      "sendPushToUser",
      "placeCallback",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
