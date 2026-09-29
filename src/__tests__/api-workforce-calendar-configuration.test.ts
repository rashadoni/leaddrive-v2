import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionScheduleConfigurationAuth: vi.fn((_permission, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/calendar-configuration", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/calendar-configuration")>(
    "@/lib/workforce/calendar-configuration",
  )
  return {
    ...actual,
    listWorkforceCalendarOverrides: vi.fn(),
    createWorkforceCalendarOverride: vi.fn(),
    searchWorkforceCalendarAgents: vi.fn(),
    searchWorkforceCalendarTeams: vi.fn(),
  }
})

import { GET, POST } from "@/app/api/v1/workforce/configuration/calendar/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceCalendarConfigurationError,
  createWorkforceCalendarOverride,
  listWorkforceCalendarOverrides,
  searchWorkforceCalendarAgents,
  searchWorkforceCalendarTeams,
} from "@/lib/workforce/calendar-configuration"

const AUTH = { orgId: "org-workforce", userId: "scheduler-1", role: "admin" }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const callPost = POST as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request(path: string, method: "GET" | "POST", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? undefined : {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.25",
      "user-agent": "calendar-route-test",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(listWorkforceCalendarOverrides).mockReset()
  vi.mocked(createWorkforceCalendarOverride).mockReset()
  vi.mocked(searchWorkforceCalendarAgents).mockReset()
  vi.mocked(searchWorkforceCalendarTeams).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "UTC" } as never)
  vi.mocked(listWorkforceCalendarOverrides).mockResolvedValue([])
  vi.mocked(searchWorkforceCalendarTeams).mockResolvedValue({
    teams: [{ id: "team-north", name: "North team", code: "NORTH", isActive: true }],
    selectedTeam: null,
    query: "",
    limit: 100,
    hasMore: false,
  })
  vi.mocked(searchWorkforceCalendarAgents).mockResolvedValue({
    agents: [{
      id: "agent-one",
      name: "Employee One",
      externalCode: "EMP-001",
      status: "ACTIVE",
      currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
    }],
    selectedAgent: null,
    query: "",
    limit: 100,
    hasMore: false,
  })
})

describe("Workforce calendar configuration API", () => {
  it("binds read and write to their exact accountable schedule permissions", () => {
    expect(GET).toBeTypeOf("function")
    expect(POST).toBeTypeOf("function")
    expect(vi.mocked(withWorkforceSessionScheduleConfigurationAuth).mock.calls.map(([permission]) => permission))
      .toEqual(["SCHEDULE_READ", "SCHEDULE_WRITE"])
  })

  it("returns a server-clocked future organization inventory with safe fields only", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const start = addDateKeyDays(today, 2)
    const endExclusive = addDateKeyDays(start, 20)
    vi.mocked(listWorkforceCalendarOverrides).mockResolvedValue([
      { date: start, kind: "PUBLIC_HOLIDAY", name: "Public day" },
    ])

    const response = await callGet(request(
      `/api/v1/workforce/configuration/calendar?start=${start}&endExclusive=${endExclusive}`,
      "GET",
    ), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      data: {
        timezone: "UTC",
        currentDate: today,
        start,
        endExclusive,
        scope: "ORGANIZATION",
        team: null,
        agent: null,
        teamDirectory: {
          items: [{ id: "team-north", name: "North team", code: "NORTH", isActive: true }],
          query: "",
          limit: 100,
          hasMore: false,
        },
        agentDirectory: {
          items: [{
            id: "agent-one",
            name: "Employee One",
            externalCode: "EMP-001",
            status: "ACTIVE",
            currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
          }],
          query: "",
          limit: 100,
          hasMore: false,
        },
        days: [{ date: start, kind: "PUBLIC_HOLIDAY", name: "Public day" }],
      },
    })
    expect(listWorkforceCalendarOverrides).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      currentDate: today,
      start,
      endExclusive,
      scope: "ORGANIZATION",
      teamId: undefined,
      agentId: undefined,
    })
    expect(Object.keys(payload.data.days[0]).sort()).toEqual(["date", "kind", "name"])
  })

  it("rejects unknown create fields before any writer call", async () => {
    const tomorrow = addDateKeyDays(currentDateKey(new Date(), "UTC"), 1)
    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      date: tomorrow,
      kind: "COMPANY_HOLIDAY",
      name: "Company day",
      routePlanningAllowed: false,
    }), AUTH)

    expect(response.status).toBe(400)
    expect(createWorkforceCalendarOverride).not.toHaveBeenCalled()
  })

  it("creates a future exception from the server date and returns no storage metadata", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const date = addDateKeyDays(today, 3)
    vi.mocked(createWorkforceCalendarOverride).mockResolvedValue({
      day: { date, kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
      team: null,
      agent: null,
      created: true,
    })

    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      date,
      kind: "EXCEPTION_WORKDAY",
      name: "Inventory day",
    }), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data).toEqual({
      timezone: "UTC",
      currentDate: today,
      scope: "ORGANIZATION",
      team: null,
      agent: null,
      day: { date, kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
    })
    expect(createWorkforceCalendarOverride).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      createdByUserId: AUTH.userId,
      currentDate: today,
      draft: { scope: "ORGANIZATION", date, kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
      audit: expect.objectContaining({
        actorUserId: AUTH.userId,
        ipAddress: "203.0.113.25",
        userAgent: "calendar-route-test",
      }),
    }))
    expect(Object.keys(payload.data.day).sort()).toEqual(["date", "kind", "name"])
  })

  it("uses 200 for an exact state replay and maps bounded domain errors", async () => {
    const date = addDateKeyDays(currentDateKey(new Date(), "UTC"), 3)
    vi.mocked(createWorkforceCalendarOverride).mockResolvedValueOnce({
      day: { date, kind: "COMPANY_HOLIDAY", name: "Company day" },
      team: null,
      agent: null,
      created: false,
    })
    const replay = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      date,
      kind: "COMPANY_HOLIDAY",
      name: "Company day",
    }), AUTH)
    expect(replay.status).toBe(200)

    vi.mocked(createWorkforceCalendarOverride).mockRejectedValueOnce(new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
      "Existing override",
    ))
    const conflict = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      date,
      kind: "COMPANY_HOLIDAY",
      name: "Company day",
    }), AUTH)
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
    })
  })

  it("falls back to UTC for an invalid tenant timezone", async () => {
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Not/A_Zone" } as never)
    const response = await callGet(request("/api/v1/workforce/configuration/calendar", "GET"), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.timezone).toBe("UTC")
    expect(payload.data.currentDate).toBe(currentDateKey(new Date(), "UTC"))
  })

  it("returns a named tenant team scope and bounded active-team search metadata", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const start = addDateKeyDays(today, 2)
    const endExclusive = addDateKeyDays(start, 20)
    const team = { id: "team-north", name: "North team", code: "NORTH", isActive: true }
    vi.mocked(searchWorkforceCalendarTeams).mockResolvedValue({
      teams: [team],
      selectedTeam: team,
      query: "north",
      limit: 25,
      hasMore: true,
    })
    vi.mocked(listWorkforceCalendarOverrides).mockResolvedValue([
      { date: start, kind: "EXCEPTION_WORKDAY", name: "North inventory" },
    ])

    const response = await callGet(request(
      `/api/v1/workforce/configuration/calendar?scope=TEAM&teamId=team-north&teamQuery=north&teamLimit=25&start=${start}&endExclusive=${endExclusive}`,
      "GET",
    ), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({
      scope: "TEAM",
      team,
      teamDirectory: { items: [team], query: "north", limit: 25, hasMore: true },
      days: [{ date: start, kind: "EXCEPTION_WORKDAY", name: "North inventory" }],
    })
    expect(searchWorkforceCalendarTeams).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      query: "north",
      limit: 25,
      selectedTeamId: "team-north",
    })
    expect(listWorkforceCalendarOverrides).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      currentDate: today,
      start,
      endExclusive,
      scope: "TEAM",
      teamId: "team-north",
      agentId: undefined,
    })
  })

  it("rejects missing and cross-tenant team selections with one response before listing days", async () => {
    vi.mocked(searchWorkforceCalendarTeams).mockResolvedValue({
      teams: [],
      selectedTeam: null,
      query: "",
      limit: 100,
      hasMore: false,
    })
    const response = await callGet(request(
      "/api/v1/workforce/configuration/calendar?scope=TEAM&teamId=team-unavailable",
      "GET",
    ), AUTH)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
    })
    expect(listWorkforceCalendarOverrides).not.toHaveBeenCalled()
  })

  it("creates one team override without accepting caller-owned Route fields", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const date = addDateKeyDays(today, 3)
    const team = { id: "team-north", name: "North team", code: "NORTH", isActive: true }
    vi.mocked(createWorkforceCalendarOverride).mockResolvedValue({
      day: { date, kind: "COMPANY_HOLIDAY", name: "North team day" },
      team,
      agent: null,
      created: true,
    })

    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      scope: "TEAM",
      teamId: "team-north",
      date,
      kind: "COMPANY_HOLIDAY",
      name: "North team day",
    }), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data).toEqual({
      timezone: "UTC",
      currentDate: today,
      scope: "TEAM",
      team,
      agent: null,
      day: { date, kind: "COMPANY_HOLIDAY", name: "North team day" },
    })
    expect(createWorkforceCalendarOverride).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      draft: {
        scope: "TEAM",
        teamId: "team-north",
        date,
        kind: "COMPANY_HOLIDAY",
        name: "North team day",
      },
    }))
  })

  it("maps every unavailable team write target to the same not-found response", async () => {
    const date = addDateKeyDays(currentDateKey(new Date(), "UTC"), 3)
    vi.mocked(createWorkforceCalendarOverride).mockRejectedValueOnce(
      new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
        "The selected active team is unavailable",
      ),
    )

    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      scope: "TEAM",
      teamId: "team-unavailable",
      date,
      kind: "COMPANY_HOLIDAY",
      name: "Unavailable team day",
    }), AUTH)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
    })
  })

  it("returns one tenant employee scope with a bounded PII-minimized directory", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const start = addDateKeyDays(today, 2)
    const endExclusive = addDateKeyDays(start, 20)
    const agent = {
      id: "agent-one",
      name: "Employee One",
      externalCode: "EMP-001",
      status: "SUSPENDED" as const,
      currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
    }
    vi.mocked(searchWorkforceCalendarAgents).mockResolvedValue({
      agents: [],
      selectedAgent: agent,
      query: "employee",
      limit: 25,
      hasMore: true,
    })
    vi.mocked(listWorkforceCalendarOverrides).mockResolvedValue([
      { date: start, kind: "COMPANY_HOLIDAY", name: "Personal schedule exception" },
    ])

    const response = await callGet(request(
      `/api/v1/workforce/configuration/calendar?scope=AGENT&agentId=agent-one&agentQuery=employee&agentLimit=25&start=${start}&endExclusive=${endExclusive}`,
      "GET",
    ), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({
      scope: "AGENT",
      team: null,
      agent,
      agentDirectory: { items: [], query: "employee", limit: 25, hasMore: true },
      days: [{ date: start, kind: "COMPANY_HOLIDAY", name: "Personal schedule exception" }],
    })
    expect(searchWorkforceCalendarAgents).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      query: "employee",
      limit: 25,
      selectedAgentId: "agent-one",
    })
    expect(listWorkforceCalendarOverrides).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      currentDate: today,
      start,
      endExclusive,
      scope: "AGENT",
      teamId: undefined,
      agentId: "agent-one",
    })
    expect(Object.keys(payload.data.agent).sort()).toEqual([
      "currentTeam",
      "externalCode",
      "id",
      "name",
      "status",
    ])
  })

  it("rejects every missing or cross-tenant employee read target before listing days", async () => {
    vi.mocked(searchWorkforceCalendarAgents).mockResolvedValue({
      agents: [],
      selectedAgent: null,
      query: "",
      limit: 100,
      hasMore: false,
    })
    const response = await callGet(request(
      "/api/v1/workforce/configuration/calendar?scope=AGENT&agentId=agent-unavailable",
      "GET",
    ), AUTH)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE",
    })
    expect(listWorkforceCalendarOverrides).not.toHaveBeenCalled()
  })

  it("creates one employee scheduling exception without accepting a team or caller-owned Route fields", async () => {
    const today = currentDateKey(new Date(), "UTC")
    const date = addDateKeyDays(today, 3)
    const agent = {
      id: "agent-one",
      name: "Employee One",
      externalCode: "EMP-001",
      status: "ACTIVE" as const,
      currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
    }
    vi.mocked(createWorkforceCalendarOverride).mockResolvedValue({
      day: { date, kind: "EXCEPTION_WORKDAY", name: "Personal inventory day" },
      team: null,
      agent,
      created: true,
    })

    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      scope: "AGENT",
      agentId: "agent-one",
      date,
      kind: "EXCEPTION_WORKDAY",
      name: "Personal inventory day",
    }), AUTH)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data).toEqual({
      timezone: "UTC",
      currentDate: today,
      scope: "AGENT",
      team: null,
      agent,
      day: { date, kind: "EXCEPTION_WORKDAY", name: "Personal inventory day" },
    })
    expect(createWorkforceCalendarOverride).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      draft: {
        scope: "AGENT",
        agentId: "agent-one",
        date,
        kind: "EXCEPTION_WORKDAY",
        name: "Personal inventory day",
      },
    }))

    const mixedTarget = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      scope: "AGENT",
      agentId: "agent-one",
      teamId: "team-north",
      date,
      kind: "EXCEPTION_WORKDAY",
      name: "Mixed target",
    }), AUTH)
    expect(mixedTarget.status).toBe(400)
  })

  it("maps every unavailable employee write target to the same not-found response", async () => {
    const date = addDateKeyDays(currentDateKey(new Date(), "UTC"), 3)
    vi.mocked(createWorkforceCalendarOverride).mockRejectedValueOnce(
      new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE",
        "The selected active employee is unavailable",
      ),
    )

    const response = await callPost(request("/api/v1/workforce/configuration/calendar", "POST", {
      scope: "AGENT",
      agentId: "agent-unavailable",
      date,
      kind: "COMPANY_HOLIDAY",
      name: "Unavailable employee day",
    }), AUTH)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE",
    })
  })
})
