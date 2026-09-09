import { describe, expect, it, vi } from "vitest"
import {
  fetchOperationalWeekJsonWithTimeout,
  isOperationalWeekApiEnvelope,
  isOperationalWeekCachedFacts,
  isOperationalWeekWorkdayMutationEnvelope,
  nextOperationalWeekTaskAttentionBoundary,
  operationalWeekGpsPresentationFreshness,
  operationalWeekTaskPresentationAttention,
  OperationalWeekRequestTimeoutError,
} from "@/lib/mtm/operational-week-client"

function day() {
  return {
    date: "2026-08-03",
    isToday: true,
    label: null,
    summary: { planned: 0, actual: 0, cancelled: 0 },
    workday: { id: null, state: "NOT_STARTED", startedAt: null, pausedAt: null, finishedAt: null, lastEventAt: null },
    routes: [],
    unplannedVisits: [],
    tasks: [],
  }
}

function facts() {
  return {
    timezone: "Asia/Baku",
    today: "2026-08-03",
    generatedAt: null,
    snapshotId: null,
    lastSourceAt: null,
    scopeRole: "AGENT",
    selectedAgent: { id: "agent-1", name: "Aysel", regionId: null, teamId: null, role: "AGENT", regionName: null, teamName: null },
    days: [day()],
    gps: { freshness: "NO_LOCATION", recordedAt: null, accuracy: null, battery: null, reason: null, onlineSeconds: 120, delayedSeconds: 900 },
    summary: { planned: 0, actual: 0, cancelled: 0, percentage: null, numerator: null, denominator: null, formula: null },
    tasks: [],
    planChanges: [],
    pendingPlanChanges: [],
    contract: { completeness: "COMPLETE", reasons: [], limits: [] },
    workdayCapability: {
      enabled: true,
      canMutateSelf: false,
      endpoint: "/api/v1/mtm/week/workday",
      availableActions: [],
      workdayId: null,
      date: null,
      requiresPriorDayClosure: false,
      activeState: null,
      activeStartedAt: null,
      outsideSelectedWindow: false,
    },
  }
}

describe("SWM-17 client contract guards", () => {
  it("accepts the two versioned API success modes", () => {
    expect(isOperationalWeekApiEnvelope({
      success: true,
      data: {
        protocolVersion: 1,
        mode: "FILTERS_ONLY",
        selectionRequired: true,
        today: "2026-08-03",
        timezone: "Asia/Baku",
        filters: {},
      },
    })).toBe(true)
    expect(isOperationalWeekApiEnvelope({
      success: true,
      data: {
        protocolVersion: 1,
        mode: "WEEK",
        today: "2026-08-03",
        period: { timezone: "Asia/Baku" },
        filters: {},
        selectedAgent: { id: "agent-1", name: "Aysel" },
        days: [day()],
      },
    })).toBe(true)
  })

  it("rejects malformed HTTP-200 bodies instead of treating them as an empty success", () => {
    expect(isOperationalWeekApiEnvelope({})).toBe(false)
    expect(isOperationalWeekApiEnvelope({ success: true, data: {} })).toBe(false)
    expect(isOperationalWeekApiEnvelope({
      success: true,
      data: { protocolVersion: 1, mode: "WEEK", today: "2026-08-03", period: { timezone: "UTC" }, filters: {}, days: [day()] },
    })).toBe(false)
  })

  it("accepts only structurally safe cached week facts", () => {
    expect(isOperationalWeekCachedFacts(facts())).toBe(true)
    expect(isOperationalWeekCachedFacts(null)).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), selectedAgent: null })).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), days: "not-an-array" })).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), workdayCapability: {} })).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), workdayCapability: { ...facts().workdayCapability, availableActions: [null] } })).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), contract: { completeness: "PARTIAL", reasons: [7], limits: [] } })).toBe(false)
    expect(isOperationalWeekCachedFacts({ ...facts(), days: [{ ...day(), routes: [null] }] })).toBe(false)
    expect(isOperationalWeekCachedFacts({
      ...facts(),
      days: [{
        ...day(),
        routes: [{
          id: "route-1",
          name: "Monday",
          status: "PUBLISHED",
          publishedVersion: 1,
          pointsTruncated: false,
          points: [{
            id: "point-1",
            order: 1,
            status: "PLANNED",
            routeId: "route-1",
            visitId: null,
            organizationId: "customer-1",
            organizationName: {},
            organizationType: null,
            contactId: null,
            contactName: null,
            contactType: null,
            specialtyName: null,
            address: null,
            plannedAt: null,
            actualAt: null,
            cancellationReason: null,
            cancellationSource: null,
          }],
        }],
      }],
    })).toBe(false)
    expect(isOperationalWeekCachedFacts({
      ...facts(),
      planChanges: [{ id: "change-1", type: "ADD_STOP", status: "SUBMITTED", reason: {}, routeId: null, pointLabel: null, requestedAt: null }],
    })).toBe(false)
  })

  it("accepts only the versioned active-task queue shape in cached facts", () => {
    const task = {
      id: "task-1",
      title: "Revisit pharmacy",
      status: "IN_PROGRESS",
      priority: "HIGH",
      scheduledStartAt: "2026-08-03T08:00:00.000Z",
      dueAt: "2026-08-03T09:00:00.000Z",
      returnReason: "Attach readable evidence",
      version: 4,
      attention: "RETURNED",
      routePointId: null,
    }
    expect(isOperationalWeekCachedFacts({
      ...facts(),
      tasks: [task],
      days: [{ ...day(), tasks: [task] }],
    })).toBe(true)
    expect(isOperationalWeekCachedFacts({ ...facts(), tasks: [{ ...task, attention: "LIVE" }] })).toBe(false)
    const unversionedTask: Partial<typeof task> = { ...task }
    delete unversionedTask.version
    expect(isOperationalWeekCachedFacts({ ...facts(), tasks: [unversionedTask] })).toBe(false)
  })

  it("accepts only a complete workday mutation success envelope", () => {
    const valid = {
      success: true,
      data: {
        workday: { id: "workday-1", status: "ACTIVE" },
        event: { id: "event-1", workdayId: "workday-1", type: "START" },
        availableActions: ["PAUSE", "FINISH"],
      },
    }
    expect(isOperationalWeekWorkdayMutationEnvelope(valid)).toBe(true)
    expect(isOperationalWeekWorkdayMutationEnvelope({})).toBe(false)
    expect(isOperationalWeekWorkdayMutationEnvelope({ success: true, data: {} })).toBe(false)
    expect(isOperationalWeekWorkdayMutationEnvelope({
      ...valid,
      data: { ...valid.data, event: { ...valid.data.event, workdayId: "another-workday" } },
    })).toBe(false)
  })

  it("never presents retained GPS evidence as live after a failed response", () => {
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "ready")).toBe("ONLINE")
    expect(operationalWeekGpsPresentationFreshness("DELAYED", "refreshing")).toBe("DELAYED")
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "rateLimited")).toBe("STALE")
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "error")).toBe("STALE")
    expect(operationalWeekGpsPresentationFreshness("DELAYED", "snapshot")).toBe("STALE")
    expect(operationalWeekGpsPresentationFreshness("NO_LOCATION", "offline")).toBe("NO_LOCATION")
  })

  it("ages a ready GPS assertion at the server-provided thresholds", () => {
    const recordedAt = "2026-08-03T10:00:00.000Z"
    const evidence = (seconds: number) => ({ recordedAt, nowMs: Date.parse(recordedAt) + seconds * 1_000, onlineSeconds: 120, delayedSeconds: 900 })
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "ready", evidence(120))).toBe("ONLINE")
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "ready", evidence(121))).toBe("DELAYED")
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "ready", evidence(901))).toBe("STALE")
    expect(operationalWeekGpsPresentationFreshness("DELAYED", "ready", evidence(30))).toBe("DELAYED")
    expect(operationalWeekGpsPresentationFreshness("ONLINE", "ready", { ...evidence(30), recordedAt: null })).toBe("STALE")
  })

  it("ages active and returned task attention strictly after the due boundary", () => {
    const dueAt = "2026-08-03T09:00:00.000Z"
    const dueAtMs = Date.parse(dueAt)

    expect(operationalWeekTaskPresentationAttention("ACTIVE", dueAt, dueAtMs)).toBe("ACTIVE")
    expect(operationalWeekTaskPresentationAttention("ACTIVE", dueAt, dueAtMs + 1)).toBe("OVERDUE")
    expect(operationalWeekTaskPresentationAttention("ACTIVE", null, dueAtMs + 1)).toBe("ACTIVE")
    expect(operationalWeekTaskPresentationAttention("ACTIVE", "not-a-date", dueAtMs + 1)).toBe("ACTIVE")
    expect(operationalWeekTaskPresentationAttention("OVERDUE", dueAt, dueAtMs - 1)).toBe("OVERDUE")
    expect(operationalWeekTaskPresentationAttention("RETURNED", dueAt, dueAtMs)).toBe("RETURNED")
    expect(operationalWeekTaskPresentationAttention("RETURNED", dueAt, dueAtMs + 1)).toBe("OVERDUE")
  })

  it("schedules the next ACTIVE task transition at due time plus one millisecond", () => {
    const nowMs = Date.parse("2026-08-03T08:00:00.000Z")
    const firstDueMs = Date.parse("2026-08-03T09:00:00.000Z")
    const tasks = [
      { attention: "RETURNED" as const, dueAt: "2026-08-03T08:30:00.000Z" },
      { attention: "ACTIVE" as const, dueAt: "2026-08-03T10:00:00.000Z" },
      { attention: "ACTIVE" as const, dueAt: "2026-08-03T09:00:00.000Z" },
      { attention: "ACTIVE" as const, dueAt: null },
    ]

    expect(nextOperationalWeekTaskAttentionBoundary(tasks, nowMs)).toBe(Date.parse("2026-08-03T08:30:00.000Z") + 1)
    expect(nextOperationalWeekTaskAttentionBoundary(tasks, Date.parse("2026-08-03T08:30:00.001Z"))).toBe(firstDueMs + 1)
    expect(nextOperationalWeekTaskAttentionBoundary(tasks, firstDueMs)).toBe(firstDueMs + 1)
    expect(nextOperationalWeekTaskAttentionBoundary(tasks, firstDueMs + 1)).toBe(Date.parse("2026-08-03T10:00:00.000Z") + 1)
    expect(nextOperationalWeekTaskAttentionBoundary([], nowMs)).toBeNull()
  })

  it("aborts a stalled request at the bounded timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    })))
    try {
      const pending = fetchOperationalWeekJsonWithTimeout("/api/v1/mtm/week", {}, 25)
      const assertion = expect(pending).rejects.toBeInstanceOf(OperationalWeekRequestTimeoutError)
      await vi.advanceTimersByTimeAsync(25)
      await assertion
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it("keeps the deadline active while a response body is stalled", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      }),
    } as Response)))
    try {
      const pending = fetchOperationalWeekJsonWithTimeout("/api/v1/mtm/week", {}, 25)
      const assertion = expect(pending).rejects.toBeInstanceOf(OperationalWeekRequestTimeoutError)
      await vi.advanceTimersByTimeAsync(25)
      await assertion
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
