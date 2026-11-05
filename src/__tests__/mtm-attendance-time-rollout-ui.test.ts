// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceTimeRollout } from "@/components/mtm/attendance-time-rollout"
import { buildTimeLeaflet, TIME_LEAFLET_URL } from "@/lib/mtm/attendance-time-leaflet"
import type { AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
type Employee = AttendanceEmployeeDirectory["employees"][number]
const person = (id: string, unit: Partial<Employee>, timeSince: string | null, extra: Partial<Employee> = {}): Employee => ({ id, name: id, role: "EMPLOYEE", status: "ACTIVE", teamName: null, departmentId: null,
  departmentName: null, position: null, teamId: null, managerId: null, included: true, participationVersion: null, includedFrom: null, history: [], timeSince, ...unit, ...extra })

let root: Root, host: HTMLDivElement
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render(employees: Employee[], onShowMissing = vi.fn(), locale = "ru") {
  // eslint-disable-next-line react/no-children-prop -- the provider's props type requires `children`
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceTimeRollout, { employees, onShowMissing }) })))
  return onShowMissing
}

describe("Personnel → «Кто уже в Time»", () => {
  const sales = { departmentId: "d-sales", departmentName: "Satış" }, store = { teamId: "t-store", teamName: "Anbar" }
  const staff = [person("a", sales, "2026-11-03T08:00:00Z"), person("b", sales, null), person("c", sales, null), person("d", store, "2026-11-04T08:00:00Z"),
    person("e", {}, null), person("gone", sales, null, { status: "INACTIVE" }), person("off", sales, null, { included: false })]

  it("counts per department only the people being tracked, least-reached first, and opens the ones not in yet", async () => {
    const onShowMissing = await render(staff)
    expect(host.textContent).toContain("В приложение вошли 2 из 5.")
    expect([...host.querySelectorAll('[data-testid="attendance-time-unit"]')].map(row => row.textContent)).toEqual([
      expect.stringMatching(/^Без отдела0 из 1/), expect.stringMatching(/^Satış1 из 3.*2 не вошли$/), expect.stringMatching(/^Anbar1 из 1$/)])
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[data-testid="attendance-time-missing"]')[1]!.click())
    expect(onShowMissing).toHaveBeenCalledWith("dep:d-sales")
    expect(host.querySelector<HTMLAnchorElement>('[data-testid="attendance-time-leaflet"]')!.getAttribute("href")).toBe("/api/v1/mtm/attendance/employees/leaflet")
  })

  it.each(["az", "en"])("speaks %s without a raw key, and shows nothing when nobody is tracked", async locale => {
    await render(staff, vi.fn(), locale)
    expect(host.textContent).not.toMatch(/personnel\.|time[A-Z]\w+/)
    await render([person("x", {}, null, { included: false })], vi.fn(), locale)
    expect(host.querySelector('[data-testid="attendance-time-rollout"]')).toBeNull()
  })

  it("prints one A4 page with the QR to the Time page", async () => {
    const pdf = await buildTimeLeaflet({ companyName: "Zeytun Pharma", companySlug: "zeytun" })
    const text = pdf.toString("latin1")
    expect(text.startsWith("%PDF-")).toBe(true)
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1)
    expect(text).toContain("/Subtype /Image")
    expect(TIME_LEAFLET_URL).toBe("https://app.leaddrivecrm.org/time")
  })
})
