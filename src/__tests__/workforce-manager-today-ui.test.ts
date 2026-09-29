// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  translate: vi.fn((key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  )),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => mocks.translate,
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => (
    createElement("a", { href, ...props }, children)
  ),
}))

import {
  WorkforceManagerToday,
  type WorkforceManagerTodayData,
} from "@/components/workforce/workforce-manager-today"

const data: WorkforceManagerTodayData = {
  date: "2026-08-31",
  timezone: "UTC",
  summary: { started: 0, paused: 0, completed: 0, notStarted: 2, previousOpen: 1 },
  summaryScope: "LOADED_PAGE",
  pagination: { pageSize: 25, nextCursor: "agent-2" },
  people: [
    {
      id: "agent-private-1",
      name: "Aysel Aliyeva",
      role: "AGENT",
      status: "NOT_STARTED",
      workday: null,
      previousOpenWorkday: null,
      plan: {
        state: "ASSIGNED", source: "EFFECTIVE_PUBLISHED_SCHEDULE", templateName: "Baku day",
        timezone: "UTC", plannedStartAt: "2026-08-31T09:00:00.000Z", plannedEndAt: "2026-08-31T18:00:00.000Z",
      },
      calendar: { state: "SCHEDULED", attendanceExpected: true, noShowEligible: true, excused: false },
      attendance: { state: "NO_SHOW", acceptedStartRecorded: false },
      exceptions: [{ type: "NO_SHOW", status: "OPEN" }],
      boundaries: {
        rawEvidence: "EXCLUDED", location: "EXCLUDED", reasons: "EXCLUDED", actors: "EXCLUDED",
        caseIdentifiers: "EXCLUDED", presenceConclusion: "NOT_INFERRED",
      },
    },
    {
      id: "agent-private-2",
      name: "Murad Hasanov",
      role: "AGENT",
      status: "NOT_STARTED",
      workday: null,
      previousOpenWorkday: { id: "workday-private", workDate: "2026-08-30T00:00:00.000Z", status: "PAUSED" },
      plan: {
        state: "NON_WORKING_DAY", source: "CALENDAR", templateName: null,
        timezone: null, plannedStartAt: null, plannedEndAt: null,
      },
      calendar: { state: "APPROVED_LEAVE", attendanceExpected: false, noShowEligible: false, excused: true },
      attendance: { state: "NOT_EXPECTED", acceptedStartRecorded: false },
      exceptions: null,
      boundaries: {
        rawEvidence: "EXCLUDED", location: "EXCLUDED", reasons: "EXCLUDED", actors: "EXCLUDED",
        caseIdentifiers: "EXCLUDED", presenceConclusion: "NOT_INFERRED",
      },
    },
  ],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("Workforce manager Today UI", () => {
  it("has complete EN/RU/AZ copy for manager states and boundaries", () => {
    const required = [
      "managerLoadedPeople", "managerSummaryBoundary", "managerPlanTitle", "managerPlannedWindow",
      "managerExceptionsTitle", "managerExceptionsRestricted", "managerExceptionsNone",
      "managerOpenExceptionQueue", "managerPresenceBoundary", "managerLoadMore", "managerLoadingMore",
    ]
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforcePage
      for (const key of required) expect(messages[key], `${locale}.${key}`).toEqual(expect.any(String))
      for (const state of ["STARTED", "PAUSED", "COMPLETED", "NO_SHOW", "SCHEDULED_NOT_STARTED", "NOT_EXPECTED", "SCHEDULE_UNAVAILABLE"]) {
        expect(messages.managerAttendanceState[state], `${locale}.${state}`).toEqual(expect.any(String))
      }
    }
  })

  it("renders schedule, calendar and authorized exceptions without private identifiers", async () => {
    const onLoadMore = vi.fn()
    await act(async () => {
      root.render(createElement(WorkforceManagerToday, { data, loadingMore: false, onLoadMore }))
    })

    expect(container.textContent).toContain("Aysel Aliyeva")
    expect(container.textContent).toContain("managerAttendanceState.NO_SHOW")
    expect(container.textContent).toContain("timesheetExceptionType.NO_SHOW")
    expect(container.textContent).toContain("Murad Hasanov")
    expect(container.textContent).toContain("managerCalendarState.APPROVED_LEAVE")
    expect(container.textContent).toContain("managerExceptionsRestricted")
    expect(container.textContent).not.toMatch(/agent-private|workday-private|case-|PRIVATE_REASON|PRIVATE_EVIDENCE/)
    const reviewLink = container.querySelector<HTMLAnchorElement>('a[href="/workforce/exceptions"]')
    expect(reviewLink).not.toBeNull()
    expect(reviewLink?.getAttribute("href")).toBe("/workforce/exceptions")

    const loadMore = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("managerLoadMore"))
    expect(loadMore).not.toBeUndefined()
    await act(async () => loadMore?.click())
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
