import { beforeEach, describe, expect, it, vi } from "vitest"

const taskFindFirst = vi.hoisted(() => vi.fn())
const taskFindMany = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const taskUpdateMany = vi.hoisted(() => vi.fn())
const taskAggregate = vi.hoisted(() => vi.fn())
const callRowLock = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())
const orgFindFirst = vi.hoisted(() => vi.fn())
const divisionFindFirst = vi.hoisted(() => vi.fn())
const userFindFirst = vi.hoisted(() => vi.fn())
const businessHoursFindFirst = vi.hoisted(() => vi.fn())
const leadFindFirst = vi.hoisted(() => vi.fn())
const pipelineFindFirst = vi.hoisted(() => vi.fn())
const createNotification = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    task: {
      findFirst: taskFindFirst,
      findMany: taskFindMany,
      create: taskCreate,
      updateMany: taskUpdateMany,
      aggregate: taskAggregate,
    },
    organization: { findFirst: orgFindFirst },
    division: { findFirst: divisionFindFirst },
    user: { findFirst: userFindFirst },
    businessHours: { findFirst: businessHoursFindFirst },
    lead: { findFirst: leadFindFirst },
    pipeline: { findFirst: pipelineFindFirst },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }))

import { recordCallCommitment } from "@/lib/commitments/record-call-commitment"

const INSIGHT = {
  version: 1 as const,
  sentiment: "positive" as const,
  sentimentScore: 0.8,
  summary: "",
  topics: [],
  actionItems: [{ text: "Sabah saat 10:00-da zəng et", owner: "agent" as const, dueDateHint: "sabah saat 10:00" }],
  competitorMentions: [],
  coachingHints: [],
}

function call() {
  return {
    organizationId: "org-1",
    callId: "call-1",
    leadId: "lead-1",
    insight: INSIGHT,
    callAt: new Date("2026-08-14T06:00:00.000Z"),
    assigneeId: "seller-1",
  }
}

describe("where a promise from a call lands", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskFindFirst.mockResolvedValue(null)
    taskFindMany.mockResolvedValue([])
    taskUpdateMany.mockResolvedValue({ count: 1 })
    callRowLock.mockResolvedValue([{
      id: "call-1",
      callMode: "human",
      disposition: null,
    }])
    transaction.mockImplementation(async (operation: (tx: unknown) => unknown) => operation({
      $queryRaw: callRowLock,
      task: {
        findFirst: taskFindFirst,
        findMany: taskFindMany,
        create: taskCreate,
        updateMany: taskUpdateMany,
      },
    }))
    taskCreate.mockImplementation(async ({ data }: { data: { id?: string } }) => ({
      id: data.id ?? "task-1",
    }))
    createNotification.mockResolvedValue(undefined)
    taskAggregate.mockResolvedValue({ _min: { boardPosition: 2048 } })
    userFindFirst.mockResolvedValue({ email: null, name: "Seller" })
    businessHoursFindFirst.mockResolvedValue({ timezone: "Asia/Baku" })
    leadFindFirst.mockResolvedValue({ pipelineId: null })
    pipelineFindFirst.mockResolvedValue(null)
    orgFindFirst.mockResolvedValue({
      features: ["inboxLeadQualification", "salesBoard:div-1"],
    })
    divisionFindFirst.mockResolvedValue({ id: "div-1", boardColumns: [{ key: "backlog" }] })
  })

  it("puts it on the board where the team already works, at the end of the first column", async () => {
    // A board-less task is not hidden, but this tenant has thousands of them
    // and the sales team works one board — the same one the inbox files a
    // chat request on. A promise made on a call belongs beside it.
    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({ created: true })
    expect(taskCreate.mock.calls[0][0].data).toMatchObject({
      divisionId: "div-1",
      boardColumnKey: "backlog",
      // Above the current first card, not under every older one: the board
      // sorts by position ascending and a fresh promise is what matters most.
      boardPosition: 1024,
    })
  })

  it("uses the call identity as the task identity", async () => {
    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({
      created: true,
      taskId: "call_callback_call-1",
    })
    expect(taskCreate.mock.calls[0][0].data.id).toBe("call_callback_call-1")
  })

  it("converges concurrent analysis retries on one task and one notification", async () => {
    const rows = new Map<string, unknown>()
    let generated = 0
    taskFindFirst.mockResolvedValue(null)
    taskCreate.mockImplementation(async ({ data }: { data: { id?: string } }) => {
      const id = data.id ?? `generated-${++generated}`
      if (rows.has(id)) {
        const duplicate = new Error("duplicate task id") as Error & { code: string }
        duplicate.code = "P2002"
        throw duplicate
      }
      rows.set(id, data)
      return { id }
    })

    const results = await Promise.all([
      recordCallCommitment(call()),
      recordCallCommitment(call()),
    ])

    expect([...rows.keys()]).toEqual(["call_callback_call-1"])
    expect(results).toContainEqual(expect.objectContaining({
      created: true,
      taskId: "call_callback_call-1",
    }))
    expect(results).not.toContainEqual(expect.objectContaining({ reason: "failed" }))
    expect(createNotification).toHaveBeenCalledTimes(1)
  })

  it("does not recreate a reminder after a human corrected the call outcome", async () => {
    const order: string[] = []
    callRowLock.mockImplementation(async (...args: unknown[]) => {
      order.push("call-lock")
      expect(args.slice(1)).toEqual(["org-1", "call-1"])
      return [{ id: "call-1", callMode: "human", disposition: "interested" }]
    })
    taskFindMany.mockImplementation(async () => {
      order.push("task-read")
      return []
    })
    taskCreate.mockImplementation(async () => {
      order.push("task-create")
      return { id: "call_callback_call-1" }
    })

    const result = await recordCallCommitment(call())

    expect(result).toEqual({ created: false, reason: "superseded" })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["call-lock"])
    expect(taskCreate).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("enriches a manual callback without changing its promised time, owner or relation", async () => {
    const manualDue = new Date("2026-08-15T13:30:00.000Z")
    const updatedAt = new Date("2026-08-14T08:00:00.000Z")
    const manual = {
      id: "call_callback_call-1",
      title: "Callback",
      description: null,
      priority: "medium",
      dueDate: manualDue,
      assignedTo: "seller-manual",
      relatedType: "lead",
      relatedId: "lead-manual",
      divisionId: null,
      boardColumnKey: null,
      boardPosition: 0,
      deletedAt: null,
      updatedAt,
      customFields: {
        commitmentCallId: "call-1",
        callbackSource: "manual-disposition",
        brand: "VIP",
      },
    }
    taskFindFirst.mockResolvedValue(manual)
    taskFindMany.mockResolvedValue([manual])
    callRowLock.mockResolvedValue([{
      id: "call-1",
      callMode: "human",
      disposition: "callback",
    }])

    const result = await recordCallCommitment(call())

    expect(result).toEqual({ created: false, reason: "already-recorded" })
    expect(taskCreate).not.toHaveBeenCalled()
    expect(taskUpdateMany).toHaveBeenCalledTimes(1)
    const [{ where, data }] = taskUpdateMany.mock.calls[0]
    expect(where).toEqual({
      id: "call_callback_call-1",
      organizationId: "org-1",
      updatedAt,
      deletedAt: null,
    })
    expect(data).toMatchObject({
      title: "Sabah saat 10:00-da zəng et",
      description: expect.stringContaining("Sabah saat 10:00-da zəng et"),
      priority: "high",
      divisionId: "div-1",
      boardColumnKey: "backlog",
      customFields: {
        commitmentCallId: "call-1",
        callbackSource: "manual-disposition",
        commitmentStatedByCustomer: true,
        brand: "VIP",
      },
    })
    for (const preserved of ["dueDate", "assignedTo", "relatedType", "relatedId"]) {
      expect(data).not.toHaveProperty(preserved)
    }
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("does not overwrite a callback title already edited by a person", async () => {
    const manual = {
      id: "call_callback_call-1",
      title: "VIP qiymət zəngi",
      description: null,
      priority: "medium",
      dueDate: new Date("2026-08-15T13:30:00.000Z"),
      assignedTo: "seller-manual",
      relatedType: "lead",
      relatedId: "lead-manual",
      divisionId: null,
      boardColumnKey: null,
      boardPosition: 0,
      deletedAt: null,
      updatedAt: new Date("2026-08-14T08:00:00.000Z"),
      customFields: {
        commitmentCallId: "call-1",
        callbackSource: "manual-disposition",
      },
    }
    taskFindFirst.mockResolvedValue(manual)
    taskFindMany.mockResolvedValue([manual])
    callRowLock.mockResolvedValue([{
      id: "call-1",
      callMode: "human",
      disposition: "callback",
    }])

    await recordCallCommitment(call())

    const [{ data }] = taskUpdateMany.mock.calls[0]
    expect(data).not.toHaveProperty("title")
    expect(data.description).toContain("Sabah saat 10:00-da zəng et")
  })

  it("starts a fresh column in the middle so cards can be dropped either side", async () => {
    taskAggregate.mockResolvedValue({ _min: { boardPosition: null } })

    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({ created: true })
    // Zero would leave no room above; the drag arithmetic works in 1024 steps.
    expect(taskCreate.mock.calls[0][0].data.boardPosition).toBe(1024)
  })

  it("keeps stacking newer promises above older ones", async () => {
    taskAggregate.mockResolvedValue({ _min: { boardPosition: 1024 } })
    await recordCallCommitment(call())
    expect(taskCreate.mock.calls[0][0].data.boardPosition).toBe(0)
  })

  it("falls back to the old inbox board so nothing moves under a tenant that never opted in", async () => {
    // A migration, not an outage: a tenant with only the historical flag keeps
    // filing exactly where it always did.
    orgFindFirst.mockResolvedValue({
      features: ["inboxLeadQualification", "inboxLeadQualificationBoard:div-legacy"],
    })
    divisionFindFirst.mockResolvedValue({ id: "div-legacy", boardColumns: [{ key: "backlog" }] })

    await recordCallCommitment(call())

    expect(taskCreate.mock.calls[0][0].data).toMatchObject({ divisionId: "div-legacy" })
  })

  it("prefers the sales board when a tenant has chosen one", async () => {
    orgFindFirst.mockResolvedValue({
      features: ["inboxLeadQualificationBoard:div-legacy", "salesBoard:div-sales"],
    })
    divisionFindFirst.mockResolvedValue({ id: "div-sales", boardColumns: [{ key: "backlog" }] })

    await recordCallCommitment(call())

    // Two settings for one job is how half the work ends up on a board called
    // "social media" and the other half nowhere in particular.
    expect(taskCreate.mock.calls[0][0].data).toMatchObject({ divisionId: "div-sales" })
  })

  it("leaves the board off when the tenant has not configured one", async () => {
    orgFindFirst.mockResolvedValue({ features: [] })

    await recordCallCommitment(call())

    const data = taskCreate.mock.calls[0][0].data
    // Guessing a destination is worse than the general list, which at least is
    // honest about being a list.
    expect(data.divisionId).toBeUndefined()
    expect(data.boardColumnKey).toBeUndefined()
  })

  it("still records the promise when the board lookup fails", async () => {
    divisionFindFirst.mockRejectedValue(new Error("board store unavailable"))

    const result = await recordCallCommitment(call())

    // The board is where it is seen; the task is the thing that must exist.
    expect(result).toMatchObject({ created: true })
    expect(taskCreate).toHaveBeenCalled()
  })

  it("prefers the board the lead's pipeline names over the organization's", async () => {
    leadFindFirst.mockResolvedValue({ pipelineId: "pipe-wholesale" })
    pipelineFindFirst.mockResolvedValue({ taskBoardId: "div-wholesale" })
    divisionFindFirst.mockResolvedValue({ id: "div-wholesale", boardColumns: [{ key: "backlog" }] })

    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({ created: true })
    expect(divisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "div-wholesale" }) }),
    )
    expect(taskCreate.mock.calls[0][0].data.divisionId).toBe("div-wholesale")
  })

  it("falls back to the organization board when the pipeline names none", async () => {
    leadFindFirst.mockResolvedValue({ pipelineId: "pipe-retail" })
    pipelineFindFirst.mockResolvedValue({ taskBoardId: null })

    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({ created: true })
    // Assert which board was ASKED for: divisionFindFirst answers any query,
    // so checking the created task alone would pass even against the wrong id.
    expect(divisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "div-1" }) }),
    )
  })

  it("falls back to the organization board when the pipeline's board is gone", async () => {
    leadFindFirst.mockResolvedValue({ pipelineId: "pipe-wholesale" })
    pipelineFindFirst.mockResolvedValue({ taskBoardId: "div-archived" })
    // Archived board: the lookup filters on isActive, so it answers nothing.
    divisionFindFirst.mockImplementation(async (args: { where: { id: string } }) => (
      args.where.id === "div-1" ? { id: "div-1", boardColumns: [{ key: "backlog" }] } : null
    ))

    const result = await recordCallCommitment(call())

    expect(result).toMatchObject({ created: true })
    // Without the fallback the promise silently reaches no board at all.
    expect(taskCreate.mock.calls[0][0].data.divisionId).toBe("div-1")
  })

  it("uses the tenant's own due window instead of the built-in default", async () => {
    orgFindFirst.mockResolvedValue({ features: ["salesBoard:div-1", "commitmentDueDays:5"] })
    // No date in the customer's words, so the tenant setting decides.
    const undated = {
      ...call(),
      insight: { ...INSIGHT, actionItems: [{ text: "Qiymət göndər", owner: "agent" as const, dueDateHint: null }] },
    }

    const result = await recordCallCommitment(undated)

    expect(result).toMatchObject({ created: true })
    const due = taskCreate.mock.calls[0][0].data.dueDate as Date
    const days = (due.getTime() - undated.callAt.getTime()) / 86_400_000
    expect(days).toBe(5)
    expect(taskCreate.mock.calls[0][0].data.description).toContain("5 günlük")
  })
})
