// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { projectAttendanceCorrectionFacts } from "@/lib/mtm/attendance-correction-facts"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const date = "2026-10-12"
const at = (clock: string) => new Date(`${date}T${clock}:00.000Z`)
const now = new Date("2026-10-13T12:00:00Z")
const employees = [{ id: "fixture-agent-a", name: "Сотрудник А", teamId: "fixture-team", teamName: "Демо-команда" },
  { id: "fixture-agent-b", name: "Сотрудник Б", teamId: "fixture-team", teamName: "Демо-команда" }]
const workdays = employees.map((employee, index) => {
  const workday = { id: `fixture-day-${index}`, agentId: employee.id, workDate: at("00:00"), status: "COMPLETED", startedAt: at("05:00"), completedAt: at("14:00"), pausedAt: null, totalPausedSeconds: 0,
    events: index === 0 ? [] : [{ id: "fixture-start", type: "START", occurredAt: at("05:00"), appliedAt: at("05:00"), clientEventId: null, serverReceivedAt: at("05:01") }] }
  const facts = workforceWorkdayCorrectionFacts(workday)
  const correction = { id: `fixture-correction-${index}`, requestId: `fixture-request-${index}`, source: "REQUEST_APPROVAL", occurredAt: now,
    actorUser: { id: "fixture-reviewer", name: "Проверяющий В" }, beforeFacts: index === 0 ? { kind: "MISSING", workDate: date } : { ...facts, status: "STARTED", completedAt: null }, afterFacts: facts }
  return { ...workday, correctionProjection: projectAttendanceCorrectionFacts(workday, [correction], now) }
})
function fixture(from: string, to: string) { return buildMtmAttendanceReport({ employees, workdays, from, to, now, rules: [], calendar: [] }) }
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const parsed = new URL(url, "https://fixture.invalid")
    if (parsed.pathname.endsWith("/rules")) return response({ today: date })
    if (parsed.pathname.endsWith("/views")) return response([])
    return response(fixture(parsed.searchParams.get("from")!, parsed.searchParams.get("to")!))
  }))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function capture(locale: string, mode: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `attendance-correction-${mode}-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1600px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
}
it.each(["ru", "az", "en"])("renders correction history in all real report forms in %s", async (locale) => {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  const t = messages.mtmAttendance
  const provider = { locale, messages, timeZone: "Asia/Baku", children: createElement(MtmAttendanceReportWorkspace) }
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)))
  const click = async (label: string) => act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)!.click())
  expect(container.querySelectorAll('[data-testid="attendance-day-row"]')).toHaveLength(2)
  expect(container.textContent).toContain(t.reportCorrectionMissing)
  expect(container.textContent).toContain("Проверяющий В")
  // Two 09:00–18:00 days without a break, each less the automatic 1:00 lunch (owner, 2026-10-16: «вычитать обед самому»).
  expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain("16:00")
  capture(locale, "day")
  await click(t.reportJournal)
  const rows = container.querySelectorAll('[data-testid="attendance-journal-event"]')
  expect(rows).toHaveLength(3) // Two decisions + one original START; no invented FINISH.
  expect(rows[0].querySelectorAll("td")[3].textContent).toBe("—")
  expect(rows[2].querySelectorAll("td")[3].textContent).toBe("—")
  expect(rows[1].textContent).toContain(t.reportEventStart)
  expect(container.textContent).not.toContain(t.reportEventFinish)
  capture(locale, "journal")
  await click(t.reportMonth)
  expect(container.querySelector('[data-testid="attendance-correction-history"]')?.textContent).toContain(t.reportCorrectionMissing)
  expect(container.querySelector('[data-testid="attendance-correction-history"]')?.textContent).toContain("Проверяющий В")
  expect(container.textContent).toContain("8:00 *")
  expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_|latitude|longitude/)
  capture(locale, "month")
})
