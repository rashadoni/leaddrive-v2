import { describe, expect, it, vi } from "vitest"
import {
  acquireMtmRouteScheduleLocks,
  buildMtmRouteDedupeKey,
  detectMtmRouteCoordination,
  detectMtmRouteConflicts,
  detectMtmRouteInternalScheduleConflicts,
  normalizeMtmRouteAssignments,
} from "@/lib/mtm/route-planning"
import { RouteCreateSchema } from "@/lib/mtm-validators"

describe("MTM route planning", () => {
  it("locks each agent schedule once in stable order", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0)

    await acquireMtmRouteScheduleLocks({ $executeRaw: executeRaw } as never, {
      organizationId: "org-1",
      date: "2026-07-13",
      agentIds: ["agent-2", "agent-1", "agent-2"],
    })

    expect(executeRaw).toHaveBeenCalledTimes(2)
    expect(executeRaw.mock.calls.map((call) => call[1])).toEqual([
      "mtm-route-schedule:org-1:2026-07-13:agent-1",
      "mtm-route-schedule:org-1:2026-07-13:agent-2",
    ])
  })

  it("turns a legacy agentId into one PRIMARY assignment", () => {
    expect(normalizeMtmRouteAssignments("agent-1", undefined)).toEqual({
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
    })
  })

  it("builds the same fingerprint when assignment input order changes", () => {
    const common = {
      date: "2026-07-13",
      primaryAgentId: "agent-1",
      points: [{ customerId: "c1" }, { customerId: "c2", plannedTime: "2026-07-13T10:00:00Z" }],
    }
    const first = buildMtmRouteDedupeKey({
      ...common,
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PARTICIPANT" },
      ],
    })
    const second = buildMtmRouteDedupeKey({
      ...common,
      assignments: [
        { agentId: "agent-2", role: "PARTICIPANT" },
        { agentId: "agent-1", role: "PRIMARY" },
      ],
    })
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it("keeps customer order in the fingerprint", () => {
    const base = {
      date: "2026-07-13",
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" as const }],
    }
    expect(buildMtmRouteDedupeKey({ ...base, points: [{ customerId: "c1" }, { customerId: "c2" }] }))
      .not.toBe(buildMtmRouteDedupeKey({ ...base, points: [{ customerId: "c2" }, { customerId: "c1" }] }))
  })

  it("keeps the selected contact in the route fingerprint", () => {
    const base = {
      date: "2026-07-13",
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" as const }],
    }
    expect(buildMtmRouteDedupeKey({ ...base, points: [{ customerId: "clinic-1", contactId: "doctor-1" }] }))
      .not.toBe(buildMtmRouteDedupeKey({ ...base, points: [{ customerId: "clinic-1", contactId: "doctor-2" }] }))
  })

  it("blocks only a real agent time collision and reports a joint customer meeting separately", () => {
    const conflicts = detectMtmRouteConflicts({
      primaryAgentId: "agent-1",
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PARTICIPANT" },
      ],
      points: [
        { customerId: "customer-1", plannedTime: "2026-07-13T09:00:00.000Z" },
        { customerId: "customer-2", plannedTime: "2026-07-13T10:00:00.000Z" },
      ],
    }, [{
      id: "existing-route",
      status: "PLANNED",
      agentId: "agent-3",
      assignments: [{ agentId: "agent-2", removedAt: null }],
      points: [{ customerId: "customer-2", plannedTime: "2026-07-13T10:00:00.000Z", deletedAt: null }],
    }])

    expect(conflicts).toEqual([
      { code: "AGENT_SCHEDULE_CONFLICT", routeId: "existing-route", agentIds: ["agent-2"] },
    ])

    expect(detectMtmRouteCoordination({
      primaryAgentId: "agent-1",
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PARTICIPANT" },
      ],
      points: [
        { customerId: "customer-1", plannedTime: "2026-07-13T09:00:00.000Z" },
        { customerId: "customer-2", plannedTime: "2026-07-13T10:00:00.000Z" },
      ],
    }, [{
      id: "existing-route",
      status: "PLANNED",
      agentId: "agent-3",
      assignments: [{ agentId: "agent-2", removedAt: null }],
      points: [{ customerId: "customer-2", plannedTime: "2026-07-13T10:00:00.000Z", deletedAt: null }],
    }])).toEqual([
      {
        code: "COORDINATED_MEETING",
        routeId: "existing-route",
        agentIds: ["agent-3"],
        customerIds: ["customer-2"],
        contactIds: [],
        plannedTimes: ["2026-07-13T10:00:00.000Z"],
      },
    ])
  })

  it("ignores completed routes and soft-removed assignments/points", () => {
    const conflicts = detectMtmRouteConflicts({
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [{ customerId: "customer-1" }],
    }, [
      { id: "done", status: "COMPLETED", agentId: "agent-1" },
      {
        id: "active",
        status: "PLANNED",
        agentId: "other",
        assignments: [{ agentId: "agent-1", removedAt: new Date() }],
        points: [{ customerId: "customer-1", deletedAt: new Date() }],
      },
    ])
    expect(conflicts).toEqual([])
  })

  it("allows different doctors at one clinic and highlights a same-doctor co-visit instead of blocking it", () => {
    const conflicts = detectMtmRouteConflicts({
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [
        { customerId: "clinic-1", contactId: "doctor-1", plannedTime: "2026-07-13T09:00:00.000Z" },
        { customerId: "clinic-1", contactId: "doctor-2", plannedTime: "2026-07-13T10:00:00.000Z" },
      ],
    }, [{
      id: "existing-route",
      status: "PLANNED",
      agentId: "other-agent",
      points: [{ customerId: "clinic-1", contactId: "doctor-2", plannedTime: "2026-07-13T10:00:00.000Z", deletedAt: null }],
    }])

    expect(conflicts).toEqual([])
    expect(detectMtmRouteCoordination({
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [
        { customerId: "clinic-1", contactId: "doctor-1", plannedTime: "2026-07-13T09:00:00.000Z" },
        { customerId: "clinic-1", contactId: "doctor-2", plannedTime: "2026-07-13T10:00:00.000Z" },
      ],
    }, [{
      id: "existing-route",
      status: "PLANNED",
      agentId: "other-agent",
      points: [{ customerId: "clinic-1", contactId: "doctor-2", plannedTime: "2026-07-13T10:00:00.000Z", deletedAt: null }],
    }])).toEqual([
      {
        code: "COORDINATED_MEETING",
        routeId: "existing-route",
        agentIds: ["other-agent"],
        customerIds: ["clinic-1"],
        contactIds: ["doctor-2"],
        plannedTimes: ["2026-07-13T10:00:00.000Z"],
      },
    ])
  })

  it("does not block the same agent when the booked times do not overlap", () => {
    expect(detectMtmRouteConflicts({
      primaryAgentId: "agent-1",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [{ customerId: "customer-1", plannedTime: "2026-07-13T09:00:00.000Z" }],
    }, [{
      id: "later-route",
      status: "PLANNED",
      agentId: "agent-1",
      points: [{ customerId: "customer-2", plannedTime: "2026-07-13T10:00:00.000Z", deletedAt: null }],
    }])).toEqual([])
  })

  it("finds duplicate stop times inside the route itself", () => {
    expect(detectMtmRouteInternalScheduleConflicts([
      { customerId: "customer-1", plannedTime: "2026-07-13T09:00:00.000Z" },
      { customerId: "customer-2", plannedTime: "2026-07-13T09:00:00Z" },
      { customerId: "customer-3", plannedTime: "2026-07-13T10:00:00.000Z" },
      { customerId: "customer-4" },
    ])).toEqual([{
      code: "ROUTE_POINT_TIME_CONFLICT",
      plannedTime: "2026-07-13T09:00:00.000Z",
      pointIndexes: [0, 1],
      customerIds: ["customer-1", "customer-2"],
    }])
  })

  it("validates one primary assignment and rejects duplicate route customers", () => {
    expect(RouteCreateSchema.safeParse({
      date: "2026-07-13",
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PARTICIPANT" },
      ],
      points: [{ customerId: "customer-1" }],
    }).success).toBe(true)

    const invalid = RouteCreateSchema.safeParse({
      date: "2026-07-13",
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PRIMARY" },
      ],
      points: [{ customerId: "customer-1" }, { customerId: "customer-1" }],
    })
    expect(invalid.success).toBe(false)

    expect(RouteCreateSchema.safeParse({
      date: "2026-07-13",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [
        { customerId: "clinic-1", contactId: "doctor-1" },
        { customerId: "clinic-1", contactId: "doctor-2" },
      ],
    }).success).toBe(true)
  })
})
