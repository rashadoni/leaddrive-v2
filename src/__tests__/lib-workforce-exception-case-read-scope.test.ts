import { describe, expect, it, vi } from "vitest"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import {
  MAX_WORKFORCE_EXCEPTION_SCOPE_SEGMENTS,
  resolveWorkforceExceptionCaseReadScopes,
} from "@/lib/workforce/exception-case-read-scope"

const definition = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "UTC",
  daysOfWeek: [1, 2, 3, 4, 5],
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    agentId: "agent-1",
    segmentId: null,
    expectedWorkDate: null,
    workdayEvent: { occurredAt: new Date("2026-08-31T09:00:00.000Z") },
    workday: null,
    ...overrides,
  }
}

function segment(overrides: Record<string, unknown> = {}) {
  return {
    id: "segment-1",
    siteId: "site-1",
    sequence: 1,
    startTime: "09:00",
    template: {
      id: "template-1",
      name: "Team day",
      teamId: "team-1",
      isDefault: false,
      version: 1,
      status: "ACTIVE",
      timezone: "UTC",
      activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      retiredAt: null,
      definition,
      definitionHash: workforceShiftDefinitionHash(definition),
    },
    ...overrides,
  }
}

describe("Workforce exception case read scopes", () => {
  it("resolves direct event cases in one historical-team batch", async () => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ requestId: "case-1", teamId: "team-1" }]),
      workforceShiftSegment: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const result = await resolveWorkforceExceptionCaseReadScopes(db as never, {
      organizationId: "org-workforce",
      candidates: [candidate()],
      resolutionAt: new Date("2026-08-31T12:00:00.000Z"),
    })

    expect(result.candidates).toEqual([{ id: "case-1", agentId: "agent-1", siteId: null }])
    expect(result.historicalTeamByCaseId.get("case-1")).toBe("team-1")
    expect(db.workforceShiftSegment.findMany).not.toHaveBeenCalled()
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("derives a schedule-only no-show scope only from its tenant-bound first segment", async () => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ requestId: "case-1", teamId: "team-1" }]),
      workforceShiftSegment: { findMany: vi.fn().mockResolvedValue([segment()]) },
    }
    const result = await resolveWorkforceExceptionCaseReadScopes(db as never, {
      organizationId: "org-workforce",
      candidates: [candidate({
        segmentId: "segment-1",
        expectedWorkDate: new Date("2026-08-31T00:00:00.000Z"),
        workdayEvent: null,
      })],
      resolutionAt: new Date("2026-08-31T12:00:00.000Z"),
    })

    expect(result.candidates).toEqual([{ id: "case-1", agentId: "agent-1", siteId: "site-1" }])
    expect(result.historicalTeamByCaseId.get("case-1")).toBe("team-1")
    expect(result.scheduleOnlyContextByCaseId.get("case-1")).toEqual({
      workDate: "2026-08-31",
      calendarTeamId: "team-1",
      templateId: "template-1",
      templateName: "Team day",
      timezone: "UTC",
      plannedStartAt: "2026-08-31T09:00:00.000Z",
      plannedEndAt: "2026-08-31T18:00:00.000Z",
    })
    expect(db.workforceShiftSegment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-workforce", id: { in: ["segment-1"] } },
    }))
  })

  it("fails the historical team closed when schedule-only provenance is corrupt", async () => {
    const db = {
      $queryRaw: vi.fn(),
      workforceShiftSegment: { findMany: vi.fn().mockResolvedValue([
        segment({ template: { ...segment().template, definitionHash: "0".repeat(64) } }),
      ]) },
    }
    const result = await resolveWorkforceExceptionCaseReadScopes(db as never, {
      organizationId: "org-workforce",
      candidates: [candidate({
        segmentId: "segment-1",
        expectedWorkDate: new Date("2026-08-31T00:00:00.000Z"),
        workdayEvent: null,
      })],
      resolutionAt: new Date("2026-08-31T12:00:00.000Z"),
    })

    expect(result.historicalTeamByCaseId.get("case-1")).toBeNull()
    expect(result.scheduleOnlyContextByCaseId.has("case-1")).toBe(false)
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it("rejects a candidate set beyond the fixed metadata bound", async () => {
    const db = {
      $queryRaw: vi.fn(),
      workforceShiftSegment: { findMany: vi.fn() },
    }
    const candidates = Array.from({ length: MAX_WORKFORCE_EXCEPTION_SCOPE_SEGMENTS + 1 }, (_, index) => candidate({
      id: `case-${index}`,
      agentId: `agent-${index}`,
    }))
    await expect(resolveWorkforceExceptionCaseReadScopes(db as never, {
      organizationId: "org-workforce",
      candidates,
      resolutionAt: new Date("2026-08-31T12:00:00.000Z"),
    })).rejects.toThrow("safe limit")
  })
})
