import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { attendancePdfText } from "./helpers/attendance-pdf"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceReportMarks, attendanceEndpointBranch, summarizeAttendanceBranches, type AttendanceLocationReportEvidence, type AttendanceReportMark } from "@/lib/mtm/attendance-location-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { AttendanceViewConfigSchema, DEFAULT_ATTENDANCE_BRANCH_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const date = "2026-10-12"
const at = (hour: string) => `${date}T${hour}:00.000Z`
const base = buildMtmAttendanceReport({ from: date, to: date, now: at("20:00"), rules: [], calendar: [],
  employees: [{ id: "a", name: "Fixture employee", teamId: "team-a", teamName: "Fixture team" }],
  workdays: [{ id: "day", agentId: "a", workDate: date, status: "COMPLETED", startedAt: at("05:00"), completedAt: at("14:00"), totalPausedSeconds: 3600,
    events: [ ["start", "START", "05:00"], ["pause", "PAUSE", "08:00"], ["resume", "RESUME", "09:00"], ["finish", "FINISH", "14:00"] ].map(([id, type, time]) => ({ id, type, occurredAt: at(time), claimedAt: at(time), serverReceivedAt: at(time) })) }] })
const row = base.rows[0]
const evidence = (id: string, state = "INSIDE"): AttendanceLocationReportEvidence => ({ eventId: id, action: id === "start" ? "START" : "FINISH", claimedAt: new Date(at(id === "start" ? "05:00" : "14:00")), serverReceivedAt: new Date(at("14:00")), locationState: state,
  branchId: "branch", branchRevisionId: "revision-one", branchName: "=Fictional original branch", distanceMeters: 7 })
const mark = (state: AttendanceReportMark["state"], action: "START" | "FINISH" = "START"): AttendanceReportMark => ({ eventId: `${state}:${action}`, action, state, claimedAt: at("05:00"), serverReceivedAt: at("05:00"),
  branch: ["INSIDE", "OUTSIDE", "UNCERTAIN"].includes(state) ? { id: "branch", revisionId: "revision-one", name: "=Fictional original branch" } : null, distanceMeters: null })
const config: AttendanceViewConfig = { version: 1, mode: "BRANCH", columns: [...DEFAULT_ATTENDANCE_BRANCH_COLUMNS], filters: { from: date, to: date, form: "ALL" }, showTotals: true }
const t = (key: string, values?: Record<string, string | number>) => values ? `${key} ${JSON.stringify(values)}` : key

describe("attendance location report preserves evidence meaning", () => {
  it("excludes pause evidence and every private field, preserving the historical revision", () => {
    const injected = { ...evidence("start"), latitude: 40.987654, longitude: 49.123456, installationId: "PRIVATE_DEVICE", note: "PRIVATE_BREAK" }
    const marks = attendanceReportMarks(row, new Map([["start", injected], ["pause", { ...injected, eventId: "pause", action: "PAUSE" }], ["finish", evidence("finish", "OUTSIDE")]]))
    expect(marks).toHaveLength(2)
    expect(marks[0]).toMatchObject({ state: "INSIDE", branch: { revisionId: "revision-one", name: "=Fictional original branch" } })
    expect(JSON.stringify(marks)).not.toMatch(/latitude|longitude|installationId|PRIVATE_/)
    expect(attendanceEndpointBranch({ ...row, locationMarks: marks }, "START")).toBe("=Fictional original branch")
    expect(attendanceEndpointBranch({ ...row, locationMarks: marks }, "FINISH")).toBe("—")
    expect(attendanceEndpointBranch({ ...row, startedAt: at("06:00"), locationMarks: marks }, "START")).toBe("—")
  })
  it.each(["BREAK_PRIVACY", "UNRECOGNIZED"])("hides branch/distance for private or unknown state %s", state => {
    const marks = attendanceReportMarks(row, new Map([["start", evidence("start", state)]]))
    expect(marks[0]).toMatchObject({ state: "NOT_RECORDED", branch: null, distanceMeters: null })
  })
  it("leaves legacy endpoints unknown and rejects mismatched evidence", () => {
    const marks = attendanceReportMarks(row, new Map([["start", { ...evidence("start"), claimedAt: new Date(at("06:00")) }]]))
    const summary = summarizeAttendanceBranches([{ ...row, locationMarks: marks }])
    expect(summary.rows).toEqual([{ key: "state:NOT_RECORDED", branch: null, state: "NOT_RECORDED", arrivals: null, departures: null, employees: null, outside: null, uncertain: null, noLocation: null, noConsent: null }])
    expect(summary.totals).toMatchObject({ arrivals: 0, departures: 0, employees: 0, outside: 0, unknown: 2 })
    const table = buildAttendanceTable({ ...base, rows: [{ ...row, locationMarks: marks }] }, config, "en", t)
    expect(table.rows[0].cells.slice(1)).toEqual(["—", "—", "—", "—", "—"])
    expect(table.totals[1]).toContain('"arrivals":"—"')
  })
  it("counts distinct people across historical branch revisions, keeping no-GPS/no-consent separate", () => {
    const summary = summarizeAttendanceBranches([
      { ...row, locationMarks: [mark("INSIDE"), mark("OUTSIDE", "FINISH"), mark("NOT_RECORDED")] },
      { ...row, date: "2026-10-13", locationMarks: [{ ...mark("UNCERTAIN"), branch: { id: "branch", revisionId: "revision-two", name: "Renamed fixture branch" } }, mark("NO_CONSENT", "FINISH")] },
      { ...row, employeeId: "b", locationMarks: [mark("UNAVAILABLE")] },
    ])
    expect(summary.totals).toEqual({ arrivals: 3, departures: 2, employees: 2, outside: 1, uncertain: 1, noLocation: 1, noConsent: 1, unknown: 1 })
    expect(summary.rows.filter(item => item.branch)).toHaveLength(2)
    expect(summary.rows.find(item => item.state === "NO_CONSENT")).toMatchObject({ departures: 1, outside: null, uncertain: null, noConsent: 1 })
  })
  it("supports persisted branch columns and rejects columns belonging to another row type", () => {
    expect(AttendanceViewConfigSchema.parse({ ...config, columns: ["noConsent", "branch", "noLocation"] }).columns).toEqual(["noConsent", "branch", "noLocation"])
    expect(AttendanceViewConfigSchema.safeParse({ ...config, columns: ["branch", "worked"] }).success).toBe(false)
    expect(AttendanceViewConfigSchema.safeParse({ ...config, mode: "DAY", columns: ["arrivalBranch", "departureBranch", "markLocation"] }).success).toBe(true)
  })
  it("exports the same branch cells and scoped totals to real XLSX/PDF, with formula-safe names", async () => {
    const report = { ...base, rows: [{ ...row, locationMarks: [mark("INSIDE"), mark("OUTSIDE", "FINISH")] }, { ...row, employeeId: "b", teamId: "team-b", locationMarks: [mark("NO_CONSENT")] }] }
    const table = buildAttendanceTable(report, { ...config, filters: { ...config.filters, teamId: "team-a" } }, "en", t)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].cells).toEqual(["=Fictional original branch", 1, 1, 1, 1, 0])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    expect(workbook.worksheets[0].getRow(2).values).toEqual([undefined, "'=Fictional original branch", 1, 1, 1, 1, 0])
    const pdf = attendancePdfText(buildAttendancePdf(table))
    expect(pdf).toContain("Fictional original branch")
    expect(pdf).not.toMatch(/PRIVATE_|latitude|longitude|installationId|locationReportNoConsent/)
    expect(table.totals[1]).toContain('"employees":1')
  })
})
