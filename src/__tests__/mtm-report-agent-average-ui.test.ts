// @vitest-environment jsdom
/**
 * «Agent performansı», week, prod, 2026-10-16: the tile «Orta ziyarət/agent»
 * read 1.5 next to a table of two field agents with 1 and 0 visits.
 *
 * The server sent 0.5. The tile counts up to its value, and every frame was
 * rounded to a whole number and put back in place of the digits before the
 * point, the rest of the string left as it was: 0.5 counted up to 1, «.5»
 * stayed behind it, and the tile read «1.5». Any tile with a fraction of a
 * half or more read one too many — «12,345.67 ₼» landed on «12,346.67 ₼».
 *
 * Next to it, the server averaged the visits of the table's page over all the
 * agents: past 50 agents the tile and the table disagreed again, and «Ən
 * yaxşı» was the best of the first page only.
 *
 * So the real route runs over in-memory rows filtered by the `where` it
 * really sends, the real page draws its answer, and the test reads the tile
 * and the table off the screen.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { matchesPrismaWhere } from "./mocks/prisma-where"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The route and the page run in one jsdom window here. The mobile token
// module refuses to load where a window exists; a web request never has one.
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: () => null }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1", role: "admin" } } }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
// The chart library measures a real layout; jsdom has none.
vi.mock("recharts", async () => {
  const { createElement: h } = await import("react")
  const Box = ({ children }: { children?: unknown }) => h("div", null, children as never)
  return { AreaChart: Box, Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null, ResponsiveContainer: Box }
})

import { GET } from "@/app/api/v1/mtm/reports/route"
import MtmReportsPage from "@/app/(dashboard)/mtm/reports/page"
import { ColorStatCard } from "@/components/color-stat-card"
import { TooltipProvider } from "@/components/ui/tooltip"
import { REPORTS } from "@/lib/mtm/report-config"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const az = JSON.parse(readFileSync("messages/az.json", "utf8"))

const ORG = "org-1"
type Row = Record<string, unknown>

/**
 * Zeytun Pharma on 2026-10-16, as read on prod, with invented names: two
 * active field agents, one of them with three visits this month and one this
 * week. Around them, everything the report must leave out — a manager's
 * visit, a deactivated agent's, a deleted one — each inside the week.
 */
const AGENTS: Row[] = [
  { id: "a-anar", organizationId: ORG, name: "Anar", role: "AGENT", status: "ACTIVE" },
  { id: "a-aysel", organizationId: ORG, name: "Aysel", role: "AGENT", status: "ACTIVE" },
  { id: "m-kamran", organizationId: ORG, name: "Kamran", role: "MANAGER", status: "ACTIVE" },
  { id: "a-orxan", organizationId: ORG, name: "Orxan", role: "AGENT", status: "INACTIVE" },
  { id: "a-other-org", organizationId: "org-2", name: "Elsewhere", role: "AGENT", status: "ACTIVE" },
]
const visit = (id: string, agentId: string, createdAt: string, deletedAt: string | null = null): Row => {
  const agent = AGENTS.find((a) => a.id === agentId)!
  return {
    id, organizationId: agent.organizationId, agentId, agent, status: "CHECKED_OUT",
    createdAt: new Date(createdAt), checkInAt: new Date(createdAt), deletedAt: deletedAt ? new Date(deletedAt) : null,
  }
}
const VISITS: Row[] = [
  visit("v1", "a-anar", "2026-10-07T14:14:50Z"),
  visit("v2", "a-anar", "2026-10-08T08:01:08Z"),
  visit("v3", "a-anar", "2026-10-12T13:21:51Z"),
  visit("v-manager", "m-kamran", "2026-10-14T09:00:00Z"),
  visit("v-inactive", "a-orxan", "2026-10-11T09:00:00Z"),
  visit("v-deleted", "a-aysel", "2026-10-13T09:00:00Z", "2026-10-13T10:00:00Z"),
  visit("v-other-org", "a-other-org", "2026-10-13T09:00:00Z"),
]
const PHOTOS: Row[] = [
  { id: "p1", organizationId: ORG, agentId: "a-anar", status: "PENDING", createdAt: new Date("2026-10-07T14:53:12Z") },
]

const matching = (rows: Row[], args: unknown) => rows.filter((row) => matchesPrismaWhere(row, (args as { where?: Row } | undefined)?.where))

function findMany(rows: Row[]) {
  return async (args?: unknown) => {
    const { orderBy, skip = 0, take } = (args ?? {}) as { orderBy?: { name?: "asc" }; skip?: number; take?: number }
    let out = matching(rows, args)
    if (orderBy?.name === "asc") out = [...out].sort((x, y) => String(x.name).localeCompare(String(y.name)))
    return out.slice(skip, take === undefined ? undefined : skip + take)
  }
}

function groupBy(rows: Row[]) {
  return async (args?: unknown) => {
    const [key] = (args as { by: string[] }).by
    const counts = new Map<unknown, number>()
    for (const row of matching(rows, args)) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1)
    return [...counts].map(([value, all]) => ({ [key]: value, _count: { _all: all } }))
  }
}

function serveRows() {
  const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
  const models: Record<string, Row[]> = { mtmAgent: AGENTS, mtmVisit: VISITS, mtmPhoto: PHOTOS, mtmTask: [], mtmRoute: [] }
  for (const [model, rows] of Object.entries(models)) {
    db[model].findMany.mockImplementation(findMany(rows))
    db[model].count.mockImplementation(async (args?: unknown) => matching(rows, args).length)
    db[model].groupBy.mockImplementation(groupBy(rows))
  }
  // An admin without a field card: the whole organization.
  db.mtmAgent.findFirst.mockResolvedValue(null)
  db.mtmAgent.findUnique.mockResolvedValue(null)
}

type Summary = Record<string, number | string>
async function report(query: string) {
  const res = await GET(new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/reports?${query}`)))
  const json = await res.json()
  const summary: Summary = Object.fromEntries(json.data.summary.map((s: { labelKey: string; value: number | string }) => [s.labelKey, s.value]))
  const seriesTotal = (json.data.series as { count: number }[]).reduce((sum, day) => sum + day.count, 0)
  return { summary, rows: json.data.reportData as Row[], total: json.data.total as number, seriesTotal }
}

let container: HTMLDivElement
let root: Root
let reportRequests: Promise<Response>[]

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}
/** Past the tiles' 900 ms count-up. */
async function countUpLands() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
}
async function mount(element: ReactElement) {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "az", timeZone: "Asia/Baku", messages: az, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(TooltipProvider, null, element))))
  await settle()
  // The first real route call may still be loading its server dependencies.
  // Advancing fake animation timers alone does not wait for that I/O.
  await act(async () => { await Promise.all(reportRequests) })
  await settle()
}

/** What a tile shows, found by its label. */
function tile(label: string): string {
  const labelSpan = [...container.querySelectorAll("span")].find((span) => span.textContent === label)
  expect(labelSpan, `no tile «${label}»`).toBeTruthy()
  return labelSpan!.closest("div.rounded-xl")!.querySelector("span.text-2xl")!.textContent ?? ""
}

/** The visits column of the agent table, as the screen shows it. */
function tableVisits(): number[] {
  const column = REPORTS.agent.columns.findIndex((c) => c.key === "visits")
  return [...container.querySelectorAll("tbody tr")].map((tr) => Number(tr.querySelectorAll("td")[column].textContent))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMtmFieldScopeMemo()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  serveRows()
  // Mid-morning in Baku on the day it was seen; the count-up runs on frames.
  vi.useFakeTimers({
    now: new Date("2026-10-16T08:00:00.000Z"),
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  })
  try { window.localStorage.setItem("leaddrive:mtm:reports:type", "agent") } catch { /* first report is the agent one anyway */ }
  reportRequests = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost:3000")
    if (url.pathname === "/api/v1/mtm/reports") {
      const request = GET(new NextRequest(url))
      reportRequests.push(request)
      return request
    }
    return new Response(JSON.stringify({ success: true, data: { counts: {} } }), { status: 200 })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("«Agent performansı»: the average tile and the table agree", () => {
  it("shows 0.5 for a week of one visit by two agents, as the table beside it says", async () => {
    await mount(createElement(MtmReportsPage))
    await countUpLands()

    const visits = tableVisits()
    expect(visits).toEqual([1, 0])
    expect(tile(az.mtmReports.sum.activeAgents)).toBe("2")
    expect(tile(az.mtmReports.sum.avgPerAgent)).toBe(String(visits.reduce((a, b) => a + b, 0) / visits.length))
    expect(tile(az.mtmReports.sum.avgPerAgent)).toBe("0.5")
    expect(tile(az.mtmReports.sum.topPerformer)).toBe("Anar")
  })

  it("shows 1.5 for the month, where the table has 3 and 0", async () => {
    await mount(createElement(MtmReportsPage))
    const monthButton = [...container.querySelectorAll("button")].find((b) => b.textContent === az.mtmReports.thisMonth)!
    await act(async () => { monthButton.click() })
    await settle()
    await countUpLands()

    expect(tableVisits()).toEqual([3, 0])
    expect(tile(az.mtmReports.sum.avgPerAgent)).toBe("1.5")
  })

  it("averages every field agent in scope, whichever page of the table is loaded", async () => {
    const whole = await report("type=agent&period=week")
    expect(whole.summary["sum.avgPerAgent"]).toBe(0.5)
    expect(whole.summary["sum.topPerformer"]).toBe("Anar")

    // A page of one row, the second: before, this summed Aysel's 0 visits
    // over both agents and named her the best.
    const secondPage = await report("type=agent&period=week&limit=1&page=2")
    expect(secondPage.rows.map((row) => row.name)).toEqual(["Aysel"])
    expect(secondPage.total).toBe(2)
    expect(secondPage.summary).toEqual(whole.summary)
  })

  it("draws the chart from the same people as the table", async () => {
    // A deactivated agent's visit is in no row; it was in the chart.
    const { rows, seriesTotal } = await report("type=agent&period=week")
    expect(seriesTotal).toBe(rows.reduce((sum, row) => sum + Number(row.visits), 0))
    expect(seriesTotal).toBe(1)
  })

  it("names nobody the best when nobody has a visit", async () => {
    // Today has no visits: «Ən yaxşı» was simply the first name on the list.
    const { summary } = await report("type=agent&period=today")
    expect(summary["sum.avgPerAgent"]).toBe(0)
    expect(summary["sum.topPerformer"]).toBe("—")
  })
})

describe("a counting tile lands on the value it was given", () => {
  it.each([
    ["0.5"], [0.5], ["1.5"], ["2.7"], [2.5], ["12,345.67 ₼"], ["49.5 AZN"], ["1.2k"], ["8 / 10"], ["60%"], ["32 dəq"], [7], ["0"],
  ])("%s", async (value) => {
    await mount(createElement(ColorStatCard, { label: "Tile", value, icon: null, animate: true }))
    await countUpLands()
    expect(tile("Tile")).toBe(String(value))
  })

  it("keeps the fraction while counting", async () => {
    await mount(createElement(ColorStatCard, { label: "Tile", value: "0.5", icon: null, animate: true }))
    const seen = new Set<string>()
    for (let frame = 0; frame < 60; frame += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16) })
      seen.add(tile("Tile"))
    }
    // Never a whole number with the old tail glued on.
    expect([...seen].every((text) => /^0\.\d$/.test(text))).toBe(true)
    expect(tile("Tile")).toBe("0.5")
  })

  it("lands on the new value when the same tile is given another one", async () => {
    const element = (value: string) => createElement(ColorStatCard, { label: "Tile", value, icon: null, animate: true })
    await mount(element("1.5"))
    await countUpLands()
    expect(tile("Tile")).toBe("1.5")
    await mount(element("0.5"))
    await countUpLands()
    expect(tile("Tile")).toBe("0.5")
  })
})
