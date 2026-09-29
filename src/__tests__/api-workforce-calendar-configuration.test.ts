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
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "UTC" } as never)
  vi.mocked(listWorkforceCalendarOverrides).mockResolvedValue([])
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
        days: [{ date: start, kind: "PUBLIC_HOLIDAY", name: "Public day" }],
      },
    })
    expect(listWorkforceCalendarOverrides).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      currentDate: today,
      start,
      endExclusive,
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
      day: { date, kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
    })
    expect(createWorkforceCalendarOverride).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      createdByUserId: AUTH.userId,
      currentDate: today,
      draft: { date, kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
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
})
