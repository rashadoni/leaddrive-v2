// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const navigation = vi.hoisted(() => ({ pathname: "/mtm/attendance" }))
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => navigation.pathname }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }))

import { MtmAttendanceSectionTabs } from "@/components/mtm/attendance-section-tabs"
import { MtmModuleNavigation } from "@/components/mtm/mtm-module-navigation"
import { accessibleNavItems, activeNavBase, navItems } from "@/lib/nav-items"
import { readHint } from "./helpers/hint"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
const PERSONNEL = navItems.filter((item) => item.group === "Personnel")
const ALL = PERSONNEL.map((item) => item.href)

let container: HTMLDivElement, root: Root
async function render(pathname: string, hrefs: readonly string[] = ALL, element = createElement(MtmAttendanceSectionTabs, { hrefs })) {
  navigation.pathname = pathname
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "az", timeZone: "Asia/Baku", messages: az, children: element })))
}
const tabs = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="attendance-section-tabs"] a'))
const current = () => tabs().filter((tab) => tab.getAttribute("aria-current") === "page")

beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = "" })

describe("Personnel's own menu at the top of its pages (owner, 2026-10-20: as in the «Kadr uçotu» clip)", () => {
  it("shows the sidebar's Personnel items, in its order and words, as links", async () => {
    await render("/mtm/attendance")
    const nav = container.querySelector("nav")!
    expect(nav.getAttribute("aria-label")).toBe("Kadr uçotu")
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Bu gün", "Tabel", "Əməkdaşlar", "Hesabatlar", "Parametrlər"])
    expect(tabs().map((tab) => tab.getAttribute("href"))).toEqual(ALL)
    // Plain links: reachable with Tab and opened with Enter, nothing taken out of the order.
    for (const tab of tabs()) expect(tab.hasAttribute("tabindex")).toBe(false)
  })

  it.each([
    ["/mtm/attendance", "/mtm/attendance"],
    ["/mtm/attendance/review", "/mtm/attendance"],
    ["/mtm/attendance/requests", "/mtm/attendance"],
    ["/mtm/attendance/timesheet", "/mtm/attendance/timesheet"],
    ["/mtm/attendance/people", "/mtm/attendance/people"],
    ["/mtm/attendance/people/agent-1", "/mtm/attendance/people"],
    ["/mtm/attendance/reports", "/mtm/attendance/reports"],
    ["/mtm/attendance/settings", "/mtm/attendance/settings"],
  ])("on %s lights exactly the item the sidebar lights", async (pathname, expected) => {
    await render(pathname)
    expect(current().map((tab) => tab.getAttribute("href"))).toEqual([expected])
    const sidebar = activeNavBase(accessibleNavItems({ plan: "enterprise", role: "superadmin", modules: { personnel: true }, orgSettings: { attendanceEnabled: true } }), pathname)
    expect(sidebar).toBe(expected)
  })

  it("draws the chosen tab as dark text over an orange line, never a fill (calm colours, 2026-10-18)", async () => {
    await render("/mtm/attendance/timesheet")
    const [chosen] = current()
    expect(chosen.className).toContain("border-primary")
    expect(chosen.className).toContain("text-foreground")
    for (const tab of tabs()) expect(tab.className).not.toMatch(/\bbg-(?!transparent)/)
  })

  it("says in a hint what each tab opens", async () => {
    await render("/mtm/attendance")
    const hints = []
    for (const tab of tabs()) hints.push(await readHint(tab))
    expect(hints).toEqual(PERSONNEL.map((item) => az.personnel.sectionHints[item.tKey]))
    for (const hint of hints) expect(hint).toBeTruthy()
  })

  it("shows only the items this person may open", async () => {
    await render("/mtm/attendance/timesheet", ["/mtm/attendance", "/mtm/attendance/timesheet"])
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Bu gün", "Tabel"])
    expect(current().map((tab) => tab.textContent)).toEqual(["Tabel"])
  })

  it("is the only menu there: the MTM module menu stays away from Personnel pages", async () => {
    await render("/mtm/attendance/timesheet", ALL, createElement(MtmModuleNavigation))
    expect(container.innerHTML).toBe("")
  })
})
