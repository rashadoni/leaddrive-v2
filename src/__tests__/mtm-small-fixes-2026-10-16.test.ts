// @vitest-environment jsdom
/**
 * Three small things from the UX audit of the route module, item 8, as the
 * owner chose them from pictures on 2026-10-16:
 *
 * - «Связь с командой» opens on the messages: no tiles saying «0», the form
 *   behind «Новое сообщение»;
 * - «Агент за период» lists field agents only and opens on the one who was
 *   in the field last (it opened on the first name of the whole team);
 * - «Отчёты» opens on a report, the reports in one row with their counts —
 *   not a menu of «0 записей» tiles.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentPeriodChoices, agentPeriodDefaultAgentId } from "@/lib/mtm/agent-period-choice"
import { TooltipProvider } from "@/components/ui/tooltip"

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1", role: "admin" } } }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/mtm" }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
// The chart library measures a real layout; jsdom has none.
vi.mock("recharts", async () => {
  const { createElement: h } = await import("react")
  const Box = ({ children }: { children?: unknown }) => h("div", null, children as never)
  return { AreaChart: Box, Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null, ResponsiveContainer: Box }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))

let counts = { pendingHrm: 0, acknowledgementDue: 0, requiredDocumentsUnread: 0 }
let reportCalls: string[] = []
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/mtm/operations") {
    return json({ success: true, data: {
      agents: [{ id: "a1", name: "Seymur Məmmədov", role: "AGENT" }],
      threads: [{ id: "t1", type: "BROADCAST", subject: "Test", lastMessageAt: "2026-10-08T11:57:00.000Z", participants: [{ role: "RECIPIENT", agent: { id: "a1", name: "Seymur Məmmədov", role: "AGENT" } }], lastMessage: { id: "m1", senderName: "Togrul", body: "port bakuda gorsuhe gelin", sentAt: "2026-10-08T11:57:00.000Z", acknowledgementRequired: false }, acknowledgement: null }],
      documents: [], hrmRequests: [], counts,
      capabilities: { canReviewHrm: true, privateStorage: true, externalCloudStorage: false },
    } })
  }
  if (url.pathname === "/api/v1/mtm/reports" || url.pathname === "/api/v1/mtm/management-reports") {
    const type = url.searchParams.get("type")
    if (!type) {
      return json({ success: true, data: { counts: url.pathname.endsWith("management-reports")
        ? { route_execution: 1, action_compliance: 0, promises: 0, sales: 0 }
        : { agent: 2, visit: 1, photo: 0 } } })
    }
    reportCalls.push(type)
    return json({ success: true, data: { summary: [{ labelKey: "sum.activeAgents", value: 2, kind: "number" }], series: [], total: 2, reportData: [
      { id: "a1", name: "Seymur Məmmədov", role: "AGENT", visits: 1, tasks: 0, photos: 0 },
      { id: "a2", name: "Rashad Rahimov", role: "AGENT", visits: 0, tasks: 0, photos: 0 },
    ] } })
  }
  return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 })
})

let container: HTMLDivElement
let root: Root
async function flush() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function mount(element: ReturnType<typeof createElement>) {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  // The dashboard layout gives every page a tooltip provider; so does this test.
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(TooltipProvider, null, element))))
  await flush()
}
const byTestId = (id: string) => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}

beforeEach(() => {
  counts = { pendingHrm: 0, acknowledgementDue: 0, requiredDocumentsUnread: 0 }
  reportCalls = []
  window.localStorage.clear()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe("«Связь с командой»", () => {
  it("opens on the messages, with no tiles of zeros and the form behind «Новое сообщение»", async () => {
    const { default: Page } = await import("@/app/(dashboard)/mtm/operations/page")
    await mount(createElement(Page))

    expect(container.textContent).toContain("port bakuda gorsuhe gelin")
    expect(container.querySelector('[data-testid="mtm-operations-attention"]')).toBeNull()
    expect(container.textContent).not.toContain("Ждут подтверждения")
    expect(container.querySelector('[data-testid="mtm-operations-compose"]')).toBeNull()

    await act(async () => { byTestId("mtm-operations-new-message").click() })
    await flush()
    expect(byTestId("mtm-operations-compose").textContent).toContain("Новое сообщение")
    // The messages stay where they were, under the form.
    expect(container.textContent).toContain("port bakuda gorsuhe gelin")
  })

  it("says in one line what waits for someone, only when something does", async () => {
    counts = { pendingHrm: 3, acknowledgementDue: 2, requiredDocumentsUnread: 0 }
    const { default: Page } = await import("@/app/(dashboard)/mtm/operations/page")
    await mount(createElement(Page))

    const line = byTestId("mtm-operations-attention").textContent
    expect(line).toContain("2Ждут подтверждения")
    expect(line).toContain("3Запросы команды ждут решения")
    expect(line).not.toContain("Обязательные не прочитаны")
  })
})

describe("«Агент за период»", () => {
  const team = [
    { id: "rashad", name: "Rashad Rahimov", role: "AGENT", status: "ACTIVE", lastSignalAt: null },
    { id: "saida", name: "Saida Qojayeva", role: "MANAGER", status: "ACTIVE", lastSignalAt: "2026-10-16T08:00:00.000Z" },
    { id: "seymur", name: "Seymur Məmmədov", role: "AGENT", status: "ACTIVE", lastSignalAt: "2026-10-13T06:10:00.000Z" },
    { id: "gone", name: "Former", role: "AGENT", status: "INACTIVE", lastSignalAt: "2026-10-15T06:10:00.000Z" },
  ]

  it("lists the active field agents and opens on the one in the field last", () => {
    const choices = agentPeriodChoices(team)
    expect(choices.map((agent) => agent.id)).toEqual(["rashad", "seymur"])
    expect(agentPeriodDefaultAgentId(choices)).toBe("seymur")
  })

  it("keeps the employee the address asks for, and opens on the first when nobody was seen", () => {
    expect(agentPeriodChoices(team, "saida").map((agent) => agent.id)).toEqual(["rashad", "saida", "seymur"])
    expect(agentPeriodDefaultAgentId([team[0]])).toBe("rashad")
    expect(agentPeriodDefaultAgentId([])).toBe("")
  })
})

describe("«Отчёты»", () => {
  it("opens on the first report, the reports in one row with their counts", async () => {
    const { default: Page } = await import("@/app/(dashboard)/mtm/reports/page")
    await mount(createElement(Page))

    expect(byTestId("mtm-report-type-agent").getAttribute("aria-selected")).toBe("true")
    expect(byTestId("mtm-report-type-agent").textContent).toBe("Производительность агентов2")
    expect(byTestId("mtm-report-type-photo").textContent).toBe("Фотоотчёт0")
    expect(reportCalls).toEqual(["agent"])
    expect(container.textContent).toContain("Seymur Məmmədov")
    // No menu of tiles and no «назад к отчётам».
    expect(container.textContent).not.toContain("записей")
  })

  it("opens another report in place, and remembers it for the next visit", async () => {
    const { default: Page } = await import("@/app/(dashboard)/mtm/reports/page")
    await mount(createElement(Page))

    await act(async () => { byTestId("mtm-report-type-visit").click() })
    await flush()
    expect(byTestId("mtm-report-type-visit").getAttribute("aria-selected")).toBe("true")
    expect(reportCalls).toEqual(["agent", "visit"])
    expect(window.localStorage.getItem("leaddrive:mtm:reports:type")).toBe("visit")
  })
})
