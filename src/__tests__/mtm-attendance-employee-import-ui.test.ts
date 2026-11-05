// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceEmployeeImport } from "@/components/mtm/attendance-employee-import"
import type { AttendanceImportPreview, AttendanceImportRow } from "@/lib/mtm/attendance-employee-import-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const ru = messages.ru.personnel
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const row = (number: number, status: AttendanceImportRow["status"], extra: Partial<AttendanceImportRow> = {}): AttendanceImportRow =>
  ({ row: number, name: `Fictional ${number}`, phone: `+99450000${String(number).padStart(4, "0")}`, status, key: String(number).padStart(32, "a"), agentId: null, errors: [], warnings: [], changes: [], ...extra })
const preview = (rows: AttendanceImportRow[]): AttendanceImportPreview => ({ fileName: "staff.xlsx", fileErrors: [], rows, summary: {
  total: rows.length, new: rows.filter(item => item.status === "NEW").length, update: rows.filter(item => item.status === "UPDATE").length,
  unchanged: rows.filter(item => item.status === "UNCHANGED").length, error: rows.filter(item => item.status === "ERROR").length } })

let root: Root, host: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>(), onLoaded = vi.fn()
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  fetchMock.mockReset(); onLoaded.mockReset(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(locale = "ru") {
  // eslint-disable-next-line react/no-children-prop -- the provider's props type requires `children`
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceEmployeeImport, { disabled: false, onLoaded }) })))
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-import-open"]')!.click())
}
async function choose() {
  const input = host.querySelector<HTMLInputElement>('[data-testid="attendance-import-file"]')!
  const file = new File([new Uint8Array([1, 2, 3])], "staff.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const action = (call: Parameters<typeof fetch>) => (call[1]?.body as FormData).get("action")
const apply = async () => { await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-import-apply"]')!.click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe("Personnel → «Загрузить сотрудников»", () => {
  it.each(["ru", "az", "en"])("offers the template and the current list and never shows a raw key in %s", async locale => {
    await render(locale)
    expect(host.querySelector<HTMLAnchorElement>('[data-testid="attendance-import-template"]')!.getAttribute("href")).toBe(`/api/v1/mtm/attendance/employees/import?file=template&locale=${locale}`)
    expect(host.querySelector<HTMLAnchorElement>('[data-testid="attendance-import-current"]')!.getAttribute("href")).toBe(`/api/v1/mtm/attendance/employees/import?file=current&locale=${locale}`)
    expect(host.textContent).not.toMatch(/personnel\.|import[A-Z]/)
  })

  it("checks the file without writing, shows tiles and reasons, then writes only NEW and UPDATE rows in chunks of 25", async () => {
    const rows = [...Array.from({ length: 30 }, (_, index) => row(index + 2, "NEW")),
      row(40, "UPDATE", { agentId: "a1", changes: [{ field: "position", from: "Operator", to: "Senior operator" }] }), row(41, "UNCHANGED"),
      row(42, "ERROR", { errors: [{ code: "BRANCH_UNKNOWN", column: "branch" }] }), row(43, "ERROR", { errors: [{ code: "PHONE_DUPLICATE", column: "phone", otherRow: 44 }] })]
    fetchMock.mockImplementation(async (_url, init) => {
      const body = init!.body as FormData
      if (body.get("action") === "preview") return ok(preview(rows))
      const chosen = JSON.parse(String(body.get("rows"))) as Array<{ row: number }>
      return ok({ results: chosen.map(item => ({ row: item.row, outcome: item.row === 40 ? "UPDATED" : item.row === 31 ? "FAILED" : "CREATED", code: item.row === 31 ? "MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN" : undefined })) })
    })
    await render(); await choose()
    expect(fetchMock.mock.calls.map(action)).toEqual(["preview"])
    for (const [status, count] of [["NEW", "30"], ["UPDATE", "1"], ["UNCHANGED", "1"], ["ERROR", "2"]]) expect(host.querySelector(`[data-testid="attendance-import-tile-${status}"] strong`)!.textContent).toBe(count)
    expect(host.querySelector('[data-testid="attendance-import-apply"]')!.textContent).toBe("Загрузить 31 сотрудника")
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-import-tab-ERROR"]')!.click())
    expect(host.textContent).toContain(ru.importError_BRANCH_UNKNOWN)
    expect(host.textContent).toContain(ru.importError_PHONE_DUPLICATE.replace("{row}", "44"))
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-import-tab-UPDATE"]')!.click())
    expect(host.textContent).toContain("должность: Operator → Senior operator")

    await apply()
    const writes = fetchMock.mock.calls.filter(call => action(call) === "apply").map(call => JSON.parse(String((call[1]!.body as FormData).get("rows"))) as Array<{ row: number; key: string }>)
    expect(writes.map(chunk => chunk.length)).toEqual([25, 6])
    expect(writes.flat().map(item => item.row)).toEqual([...Array.from({ length: 30 }, (_, index) => index + 2), 40])
    expect(writes[0]![0]).toEqual({ row: 2, key: rows[0]!.key })
    expect(host.querySelector('[data-testid="attendance-import-result"]')!.textContent).toContain("Готово: добавлено 29, обновлено 1.")
    expect(host.textContent).toContain(ru.importFailure_MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN)
    expect(onLoaded).toHaveBeenCalledTimes(1)
  })

  it("stops on a dropped connection and says the same file can be loaded again", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(index + 2, "NEW"))
    let writes = 0
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init!.body as FormData).get("action") === "preview") return ok(preview(rows))
      writes += 1
      if (writes === 2) throw new TypeError("network")
      return ok({ results: rows.slice(0, 25).map(item => ({ row: item.row, outcome: "CREATED" })) })
    })
    await render(); await choose(); await apply()
    expect(writes).toBe(2)
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(ru.importInterrupted.replace("{done}", "25").replace("{total}", "30"))
  })

  it("names a missing column instead of a table, and offers another file", async () => {
    fetchMock.mockResolvedValue(ok({ fileName: "staff.xlsx", rows: [], summary: { total: 3, new: 0, update: 0, unchanged: 0, error: 3 }, fileErrors: [{ code: "MISSING_COLUMN", column: "phone" }] }))
    await render(); await choose()
    expect(host.querySelector('[data-testid="attendance-import-file-errors"]')!.textContent).toContain("В файле нет колонки «Телефон WhatsApp».")
    expect(host.querySelector('[data-testid="attendance-import-apply"]')).toBeNull()
  })
})
