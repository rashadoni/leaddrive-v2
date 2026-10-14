import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }))
const { default: PersonnelTimesheetPage } = await import("@/app/(dashboard)/mtm/attendance/timesheet/page")
const { MtmAttendanceReportWorkspace } = await import("@/components/mtm/attendance-report-workspace")
const { MtmAttendanceMonths } = await import("@/components/mtm/attendance-months")

type Props = { initialForm?: string; initialDate?: string; initialEmployeeId?: string; initialFilter?: string }
async function open(params: Record<string, string>) {
  return await PersonnelTimesheetPage({ searchParams: Promise.resolve(params) }) as ReactElement<Props & { children?: unknown }>
}

// Owner, 2026-10-14: nine timesheet tabs were too many to explain to HR. The
// page is one month grid now; links into the former tabs must still land.
describe("Personnel → Timesheet page", () => {
  it("opens the month grid with no tab row", async () => {
    const page = await open({})
    expect(page.type).toBe(MtmAttendanceReportWorkspace)
    expect(page.props).toMatchObject({ initialForm: "MONTH", initialFilter: undefined })
  })

  it.each([
    [{ tab: "late" }, { initialFilter: "late" }],
    [{ tab: "absence" }, { initialFilter: "absent" }],
    [{ tab: "overtime" }, { initialFilter: "overtime" }],
    [{ tab: "journal" }, { initialFilter: "missing-finish" }],
    [{ tab: "journal", date: "2026-10-13", employeeId: "e1" }, { initialFilter: undefined, initialDate: "2026-10-13", initialEmployeeId: "e1" }],
    [{ tab: "days", date: "2026-10-13" }, { initialFilter: undefined, initialDate: "2026-10-13" }],
    [{ filter: "missing-finish" }, { initialFilter: "missing-finish" }],
    [{ filter: "anything" }, { initialFilter: undefined }],
  ])("keeps the former link %j working", async (params, expected) => {
    const page = await open(params)
    expect(page.type).toBe(MtmAttendanceReportWorkspace)
    expect(page.props).toMatchObject({ initialForm: "MONTH", ...expected })
  })

  it.each([{ view: "months" }, { tab: "months" }])("opens a rarer report from More with a way back (%j)", async params => {
    const page = await open(params)
    const children = page.props.children as ReactElement<{ href?: string }>[]
    expect(children[0].props.href).toBe("/mtm/attendance/timesheet")
    expect(children[1].type).toBe(MtmAttendanceMonths)
  })
})
