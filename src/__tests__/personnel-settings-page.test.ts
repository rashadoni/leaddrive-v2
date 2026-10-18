// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ role: "admin" }))
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }))
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { role: session.role } }) }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (run: () => unknown) => run() }))
const { default: PersonnelSettingsPage } = await import("@/app/(dashboard)/mtm/attendance/settings/page")
const { MtmAttendanceSettingsHub } = await import("@/components/mtm/attendance-settings-hub")
const { MtmAttendanceRulesForm } = await import("@/components/mtm/attendance-rules-form")
const { MtmAttendanceCalendar } = await import("@/components/mtm/attendance-calendar")
const { MtmAttendancePolicySettings } = await import("@/components/mtm/attendance-policy-settings")
const { attendanceWorkWeek } = await import("@/lib/mtm/attendance-settings-cards")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
type Child = ReactElement<{ href?: string; isAdmin?: boolean; children?: unknown }>
async function open(params: Record<string, string>) {
  return await PersonnelSettingsPage({ searchParams: Promise.resolve(params) }) as Child
}

// Owner, 2026-10-14: nine Settings tabs were too many to explain to HR.
describe("Personnel → Settings page", () => {
  beforeEach(() => { session.role = "admin" })

  it("opens one page of cards without a tab row", async () => {
    const page = await open({})
    expect(page.type).toBe(MtmAttendanceSettingsHub)
    expect(page.props.isAdmin).toBe(true)
  })

  it("opens a card's editor with a way back; hours and holidays are separate cards", async () => {
    for (const [tab, editor] of [["hours", MtmAttendanceRulesForm], ["holidays", MtmAttendanceCalendar]] as const) {
      const children = (await open({ tab })).props.children as (Child | null)[]
      expect(children[0]!.props.href).toBe("/mtm/attendance/settings")
      expect(children.some(child => child?.type === editor)).toBe(true)
    }
  })

  it("opens the attendance switches moved here from MTM settings (owner, 2026-10-18)", async () => {
    for (const card of ["reminders", "approval", "checks"] as const) {
      const children = (await open({ tab: card })).props.children as (Child | null)[]
      const editor = children.find(child => child?.type === MtmAttendancePolicySettings) as ReactElement<{ card: string; canChange: boolean }> | undefined
      expect(editor?.props).toEqual({ card, canChange: true })
    }
  })

  it("sends a manager asking for an administrator card, or anyone with an unknown one, to the cards", async () => {
    expect((await open({ tab: "nothing" })).type).toBe(MtmAttendanceSettingsHub)
    session.role = "manager"
    for (const tab of ["location", "reminders", "approval", "checks"]) {
      const page = await open({ tab })
      expect(page.type).toBe(MtmAttendanceSettingsHub)
      expect(page.props.isAdmin).toBe(false)
    }
  })
})

describe("working week summary", () => {
  const name = (day: number) => ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][day]
  it.each([
    [[0, 6], "Пн–Пт"],
    [[0], "Пн–Сб"],
    [[0, 3, 6], "Пн, Вт, Чт, Пт"],
    [[5, 6], "Пн–Чт, Вс"],
  ])("weekend %j → %s", (weekend, text) => expect(attendanceWorkWeek(weekend, name)).toBe(text))
})

describe("Settings cards", () => {
  let container: HTMLDivElement, root: Root
  const json = (body: unknown) => new Response(JSON.stringify(body))
  const fetchMock = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input), "https://crm.test")
    if (url.pathname.endsWith("/rules")) return json({ success: true, data: { today: "2026-10-14",
      current: { id: "r", effectiveFrom: "2026-01-01", timezone: "Asia/Baku", startTime: "09:00", endTime: "18:00", lunchMinutes: 60, lateGraceMinutes: 10, weekendDays: [0, 6], createdAt: null, createdBy: null } } })
    if (url.pathname.endsWith("/calendar")) return json({ success: true, data: { today: "2026-10-14", canManage: true,
      days: [{ kind: "PUBLIC_HOLIDAY" }, { kind: "COMPANY_HOLIDAY" }, { kind: "EXCEPTION_WORKDAY" }] } })
    if (url.pathname.endsWith("/review")) return json({ success: true, data: { items: [{ id: "a" }, { id: "b" }] } })
    return json({ error: "unexpected" })
  })
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  async function render(isAdmin: boolean, locale = "ru", messages = ru) {
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale, timeZone: "Asia/Baku", messages }, createElement(MtmAttendanceSettingsHub, { isAdmin }))))
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  const card = (key: string) => container.querySelector<HTMLAnchorElement>(`[data-testid="attendance-settings-card-${key}"]`)

  it("groups twelve cards for an administrator, each opening its editor", async () => {
    await render(true)
    const cards = Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid^="attendance-settings-card-"]'))
    // Reminders, request approval and the checks of marks came from MTM → Settings (owner, 2026-10-18).
    expect(cards.map(link => link.getAttribute("href"))).toEqual(["hours", "holidays", "shifts", "day-kinds", "reminders", "leave", "requests", "approval", "qr", "location", "checks", "access"].map(key => `/mtm/attendance/settings?tab=${key}`))
    expect(Array.from(container.querySelectorAll("h2")).map(heading => heading.textContent)).toEqual(Object.values(ru.personnel.settingsGroups))
    // A card alone in its row takes the whole row (owner: no half-empty rows).
    expect(cards.filter(link => link.className.includes("md:col-span-2")).map(link => link.dataset.testid))
      .toEqual(["reminders", "approval", "checks", "access"].map(card => `attendance-settings-card-${card}`))
    // Suspicious marks are a daily queue on Today, not a setting (owner, 2026-10-15).
    expect(card("review")).toBeNull()
  })

  it("shows current values where it can read them", async () => {
    await render(true)
    expect(card("hours")!.textContent).toContain("пн–пт, 09:00–18:00 · опоздание после 10 мин")
    expect(card("holidays")!.textContent).toContain(ru.personnel.settingsHolidaysValue.replace("{count}", "2"))
    expect(card("qr")!.textContent).toContain(ru.personnel.settingsCards.qr.hint)
    expect(card("checks")!.textContent).toContain(ru.personnel.settingsCards.checks.hint)
  })

  it("hides the administrator cards from a manager", async () => {
    await render(false)
    for (const key of ["location", "reminders", "approval", "checks"]) expect(card(key)).toBeNull()
    expect(container.querySelectorAll('[data-testid^="attendance-settings-card-"]')).toHaveLength(8)
    // Rows stay full: without the administrator card the QR card takes its row alone.
    expect(card("qr")!.className).toContain("md:col-span-2")
    expect(card("access")!.className).toContain("md:col-span-2")
  })

  it("names weekdays in Azerbaijani, never the root-locale fallback", async () => {
    await render(true, "az", az)
    expect(card("hours")!.textContent).toMatch(/^.*b\.e\.–c\., 09:00–18:00/)
  })
})
