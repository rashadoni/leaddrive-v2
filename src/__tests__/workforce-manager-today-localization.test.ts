// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  WorkforceManagerToday,
  type WorkforceManagerTodayData,
} from "@/components/workforce/workforce-manager-today"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

// Routing is outside this regression; the real next-intl provider and hooks
// must resolve the production catalogs rather than echo mocked key strings.
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => (
    createElement("a", { href, ...props }, children)
  ),
}))

// createElement receives children in its third argument. Adapt the provider's
// required-children type for that call without replacing its implementation.
const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

const types = [
  "LATE_START", "UNDERTIME", "OVERTIME", "LONG_PAUSE", "NO_SHOW", "MISSED_FINISH",
  "DELAYED_CLAIM", "SITE_TRANSITION_REVIEW", "DEVICE_SECURITY_REVIEW", "ATTENDANCE_PROOF_REVIEW",
]
const statuses = ["OPEN", "ACKNOWLEDGED", "AWAITING_EMPLOYEE_RESPONSE", "HR_REVIEW", "RESOLVED", "DATA_INTEGRITY_REVIEW"]
const data: WorkforceManagerTodayData = {
  date: "2026-08-31", timezone: "UTC",
  summary: { started: 0, paused: 0, completed: 0, notStarted: 1, previousOpen: 0 },
  summaryScope: "LOADED_PAGE", pagination: { pageSize: 25, nextCursor: null },
  people: [{
    id: "private-agent-id", name: "Localized employee", role: "AGENT", status: "NOT_STARTED",
    workday: null, previousOpenWorkday: null,
    plan: {
      state: "ASSIGNED", source: "PERSISTED_NO_SHOW_CASE", templateName: "Published shift",
      timezone: "UTC", plannedStartAt: "2026-08-31T09:00:00.000Z", plannedEndAt: "2026-08-31T18:00:00.000Z",
    },
    calendar: { state: "SCHEDULED", attendanceExpected: true, noShowEligible: true, excused: false },
    attendance: { state: "NO_SHOW", acceptedStartRecorded: false },
    exceptions: types.flatMap(type => statuses.map(status => ({ type, status }))),
    boundaries: {
      rawEvidence: "EXCLUDED", location: "EXCLUDED", reasons: "EXCLUDED", actors: "EXCLUDED",
      caseIdentifiers: "EXCLUDED", presenceConclusion: "NOT_INFERRED",
    },
  }],
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("Manager Today with real EN/RU/AZ next-intl catalogs", () => {
  it.each(["en", "ru", "az"])("renders every supported exception type and status without missing keys in %s", async locale => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
    const intlErrors = vi.fn()
    await act(async () => {
      root.render(createElement(IntlProvider, {
        locale, messages, timeZone: "UTC", onError: intlErrors,
      }, createElement(WorkforceManagerToday, { data, loadingMore: false, onLoadMore: vi.fn() })))
    })

    const text = container.textContent ?? ""
    for (const type of types) {
      for (const status of statuses) {
        expect(text).toContain(`${messages.workforcePage.timesheetApprovalException[type]} · ${messages.workforcePage.timesheetExceptionStatus[status]}`)
      }
    }
    expect(text).toContain(messages.workforcePage.managerAttendanceState.NO_SHOW)
    expect(text).toContain(messages.workforcePage.managerPresenceBoundary)
    expect(text).not.toMatch(/workforcePage\.|timesheetExceptionType\.|private-agent-id/)
    expect(intlErrors).not.toHaveBeenCalled()
  })
})
