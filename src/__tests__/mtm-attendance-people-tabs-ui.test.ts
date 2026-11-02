// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, Fragment, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
const state = vi.hoisted(() => ({ role: "admin", pathname: "/mtm/attendance/people" }))
const lookup = (path: string) => path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], az)
vi.mock("next-intl/server", () => ({ getTranslations: async (namespace: string) => (key: string) => lookup(`${namespace}.${key}`) as string }))
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { role: state.role } }) }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (run: () => unknown) => run() }))
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => state.pathname }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }))
// The views themselves load their own data; this file is about the menus above them.
vi.mock("@/components/mtm/attendance-employees", () => ({ MtmAttendanceEmployees: () => null }))
vi.mock("@/components/mtm/attendance-branches", () => ({ MtmAttendanceBranches: () => null }))
vi.mock("@/components/mtm/attendance-installations", () => ({ MtmAttendanceInstallations: () => null }))

const { default: PersonnelPeoplePage } = await import("@/app/(dashboard)/mtm/attendance/people/page")
const { MtmAttendanceSectionTabs } = await import("@/components/mtm/attendance-section-tabs")
const { navItems } = await import("@/lib/nav-items")
const { readHint } = await import("./helpers/hint")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ALL = navItems.filter((item) => item.group === "Personnel").map((item) => item.href)

let container: HTMLDivElement, root: Root
/** «Əməkdaşlar» as the attendance layout draws it: the section's tabs, then the page. */
async function open(params: Record<string, string> = {}) {
  const page = await PersonnelPeoplePage({ searchParams: Promise.resolve(params) }) as ReactElement
  const tree = createElement(Fragment, null, createElement(MtmAttendanceSectionTabs, { hrefs: ALL }), page)
  const props = { locale: "az", timeZone: "Asia/Baku", messages: az, children: tree }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
const views = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="attendance-tabs"] a'))
const underlined = () => Array.from(container.querySelectorAll<HTMLElement>("a")).filter((link) => /\bborder-b-2\b/.test(link.className) && /\bborder-primary\b/.test(link.className))

beforeEach(() => { state.role = "admin"; container = document.createElement("div"); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = "" })

// Verifier, 2026-10-20: under the new section tabs «Əməkdaşlar» drew its own views in the same
// underline style, and «Əməkdaşlar» was lit in both rows. One menu at the top (calm colours, 2026-10-18).
describe("Personnel → Əməkdaşlar: one menu at the top, the page's views as chips", () => {
  it("lights one underlined tab and one current page — the section's «Əməkdaşlar»", async () => {
    await open()
    expect(views().map((link) => link.textContent)).toEqual(["Əməkdaşlar", "Filiallar", "Telefonlar"])
    expect(underlined().map((link) => link.textContent)).toEqual(["Əməkdaşlar"])
    expect(underlined()[0].closest('[data-testid="attendance-section-tabs"]')).not.toBeNull()
    const pages = Array.from(container.querySelectorAll("a[aria-current=page]"))
    expect(pages.map((link) => link.getAttribute("href"))).toEqual(["/mtm/attendance/people"])
  })

  it("draws the views as chips: the chosen one outlined dark and marked current in its set, none filled", async () => {
    await open({ tab: "branches" })
    for (const link of views()) {
      expect(link.className).toContain("rounded-full")
      expect(link.className).not.toMatch(/\bborder-b-2\b/)
      expect(link.className).not.toMatch(/\bbg-/)
    }
    const chosen = views().filter((link) => link.hasAttribute("aria-current"))
    expect(chosen.map((link) => [link.textContent, link.getAttribute("aria-current")])).toEqual([["Filiallar", "true"]])
    expect(chosen[0].className).toContain("border-foreground")
    expect(views().find((link) => link.textContent === "Əməkdaşlar")!.className).not.toContain("border-foreground")
    // Plain links: reached with Tab, opened with Enter.
    expect(views().map((link) => link.getAttribute("href"))).toEqual(["employees", "branches", "phones"].map((key) => `/mtm/attendance/people?tab=${key}`))
  })

  it("says in a hint what each view holds", async () => {
    await open()
    const hints = []
    for (const link of views()) hints.push(await readHint(link))
    expect(hints).toEqual([az.mtmAttendance.employeesIntro, az.mtmAttendance.branchesIntro, az.personnel.peoplePhonesHint])
    for (const hint of hints) expect(hint).toBeTruthy()
  })

  it("leaves a manager the two views he may open", async () => {
    state.role = "manager"
    await open({ tab: "employees" })
    expect(views().map((link) => link.textContent)).toEqual(["Filiallar", "Telefonlar"])
    expect(views()[0].getAttribute("aria-current")).toBe("true")
  })
})
