// @vitest-environment jsdom
/**
 * «Ждёт решения» and the week line on the MTM Panel (owner, 2026-10-11), with
 * the real message files and the numbers of the tenant the owner was looking
 * at: one request for a new client unanswered since 8 October, six alerts of
 * that day nobody opened, no route for Monday, two stops of seven done.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { MtmPanelAttention, normalizePanelAttention } from "@/components/mtm/panel-attention"
import { MtmPanelWeekLine, panelWeekFacts } from "@/components/mtm/panel-week-line"
import { teamResultsPreset } from "@/components/mtm/team-results"

vi.mock("next/link", () => ({
  // `prefetch` is Next's own prop, not an attribute of <a>.
  default: ({ children, href, className }: { children?: ReactNode; href: string; className?: string }) =>
    createElement("a", { href, className }, children),
}))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ZEYTUN = {
  timezone: "Asia/Baku",
  today: "2026-10-11",
  generatedAt: "2026-10-11T14:54:00.000Z",
  items: [
    { kind: "contactCreateRequests", count: 1, date: "2026-10-08" },
    { kind: "olderAlerts", count: 6, date: "2026-10-08" },
  ],
  nextWorkday: { date: "2026-10-12", agents: 1, withoutRoute: 1, agentId: "agent-1" },
}

let root: Root | null = null
let container: HTMLElement

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function render(locale: string, element: ReactNode) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(IntlProvider, { locale, messages, timeZone: "UTC" }, element)) })
  await settle()
  return container
}

function attention(props: Partial<ComponentProps<typeof MtmPanelAttention>> = {}) {
  return createElement(MtmPanelAttention, { organizationId: "org-1", viewerId: "user-1", regionId: "", teamId: "", refreshToken: 0, ...props })
}

function rowText(testId: string): string {
  return container.querySelector(`[data-testid='mtm-panel-attention-${testId}'] p`)?.textContent ?? ""
}

function rowLink(testId: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`[data-testid='mtm-panel-attention-${testId}'] a`)
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  document.body.innerHTML = ""
})

describe("«Ждёт решения» on the Panel", () => {
  it("says in Russian what waits, since when, and leads each row to its own list", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => json({ success: true, data: ZEYTUN }))
    vi.stubGlobal("fetch", fetchMock)
    await render("ru", attention())

    expect(container.querySelector("#mtm-panel-attention-title")?.textContent).toBe("Ждёт решения")
    expect(rowText("contactCreateRequests")).toBe("1 заявка на нового клиентаждёт с 8 окт.")
    expect(rowLink("contactCreateRequests")?.getAttribute("href")).toBe("/mtm/contacts")
    expect(rowLink("contactCreateRequests")?.textContent).toBe("Рассмотреть")

    expect(rowText("olderAlerts")).toBe("6 оповещений за прошлые дни не разобранопоследние — 8 окт.")
    // The alerts page opens on today; the link carries the day these alerts are on.
    expect(rowLink("olderAlerts")?.getAttribute("href")).toBe("/mtm/alerts?date=2026-10-08")
    expect(rowLink("olderAlerts")?.textContent).toBe("Разобрать")

    expect(rowText("next-workday")).toBe("На пн, 12 окт. маршрута нет")
    expect(rowLink("next-workday")?.getAttribute("href")).toBe("/mtm/routes?planAgentId=agent-1&planDate=2026-10-12")
    expect(rowLink("next-workday")?.textContent).toBe("Спланировать")

    // Rows are in the server's order, and nothing with a zero is drawn.
    expect(Array.from(container.querySelectorAll("li")).map((item) => item.getAttribute("data-testid"))).toEqual([
      "mtm-panel-attention-contactCreateRequests",
      "mtm-panel-attention-olderAlerts",
      "mtm-panel-attention-next-workday",
    ])
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/mtm/week/attention?")
  })

  it.each(["az", "en", "ru"])("has words for every row in %s, never a message key", async (locale) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      success: true,
      data: {
        ...ZEYTUN,
        items: [
          { kind: "contactCreateRequests", count: 2, date: "2026-10-08" },
          { kind: "customerCreateRequests", count: 1, date: "2026-10-06" },
          { kind: "routeChangeRequests", count: 5, date: "2026-10-09" },
          { kind: "routesAwaitingPublish", count: 3, date: "2026-10-12" },
          { kind: "olderAlerts", count: 21, date: "2026-10-10" },
        ],
        nextWorkday: { date: "2026-10-12", agents: 5, withoutRoute: 2, agentId: "agent-1" },
      },
    })))
    await render(locale, attention())
    expect(container.querySelectorAll("li")).toHaveLength(6)
    const text = container.textContent ?? ""
    expect(text).not.toMatch(/mtmDashboardPage|operationalWeek|attention\.|\{count|\{date|\{total/)
    for (const number of ["2", "5", "3", "21"]) expect(text).toContain(number)
    for (const link of Array.from(container.querySelectorAll("a"))) expect(link.textContent?.trim().length).toBeGreaterThan(2)
  })

  it("tells «nobody of five» from «two of five» for the next working day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: { ...ZEYTUN, items: [], nextWorkday: { date: "2026-10-12", agents: 5, withoutRoute: 5, agentId: "agent-1" } } })))
    await render("ru", attention())
    expect(rowText("next-workday")).toBe("На пн, 12 окт. маршрута нет ни у кого из 5")
    await act(async () => { root?.unmount() })
    window.sessionStorage.clear()

    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: { ...ZEYTUN, items: [], nextWorkday: { date: "2026-10-12", agents: 5, withoutRoute: 2, agentId: "agent-3" } } })))
    await render("ru", attention())
    expect(rowText("next-workday")).toBe("На пн, 12 окт. маршрута нет у 2 из 5")
    expect(rowLink("next-workday")?.getAttribute("href")).toBe("/mtm/routes?planAgentId=agent-3&planDate=2026-10-12")
  })

  it("draws nothing when nothing waits and everyone has a route — no «всё разобрано»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: { ...ZEYTUN, items: [], nextWorkday: { date: "2026-10-12", agents: 3, withoutRoute: 0, agentId: null } } })))
    await render("ru", attention())
    expect(container.innerHTML).toBe("")
  })

  it("does not pass a failed check off as «nothing is waiting», and retries on request", async () => {
    let fail = true
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => (fail ? json({ error: "boom" }, 500) : json({ success: true, data: ZEYTUN })))
    vi.stubGlobal("fetch", fetchMock)
    await render("ru", attention())
    const alert = container.querySelector("[data-testid='mtm-panel-attention-error']")
    expect(alert?.getAttribute("role")).toBe("alert")
    expect(alert?.textContent).toContain("Не удалось проверить, что ждёт решения")

    fail = false
    await act(async () => { alert?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await settle()
    expect(container.querySelector("[data-testid='mtm-panel-attention-error']")).toBeNull()
    expect(rowText("contactCreateRequests")).toContain("1 заявка на нового клиента")
  })

  it("keeps the last answer on screen while a refresh fails, and asks for the Panel's filters", async () => {
    let fail = false
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => (fail ? json({ error: "boom" }, 500) : json({ success: true, data: ZEYTUN })))
    vi.stubGlobal("fetch", fetchMock)
    await render("ru", attention({ regionId: "r1", teamId: "t1" }))
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/mtm/week/attention?regionId=r1&teamId=t1")

    fail = true
    await act(async () => { root?.render(createElement(IntlProvider, { locale: "ru", messages: JSON.parse(readFileSync("messages/ru.json", "utf8")), timeZone: "UTC" }, attention({ regionId: "r1", teamId: "t1", refreshToken: 1 }))) })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rowText("olderAlerts")).toContain("6 оповещений")
    expect(container.querySelector("[data-testid='mtm-panel-attention-error']")).toBeNull()
  })

  it("never shows one team's rows under another team's filter", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (String(input).includes("teamId=t2")
      ? new Promise<Response>(() => {})
      : json({ success: true, data: ZEYTUN }))))
    await render("ru", attention({ teamId: "t1" }))
    expect(container.querySelectorAll("li")).toHaveLength(3)
    await act(async () => { root?.render(createElement(IntlProvider, { locale: "ru", messages: JSON.parse(readFileSync("messages/ru.json", "utf8")), timeZone: "UTC" }, attention({ teamId: "t2" }))) })
    await settle()
    expect(container.innerHTML).toBe("")
  })

  it("reads the answer defensively", () => {
    expect(normalizePanelAttention(null)).toBeNull()
    expect(normalizePanelAttention({ success: false, data: ZEYTUN })).toBeNull()
    expect(normalizePanelAttention({ success: true, data: { today: "soon", items: [] } })).toBeNull()
    const read = normalizePanelAttention({ success: true, data: {
      today: "2026-10-11",
      items: [
        { kind: "olderAlerts", count: 6, date: "8 October" },
        { kind: "shiftsLeftOpen", count: 4, date: "2026-10-07" },
        { kind: "contactCreateRequests", count: 0, date: "2026-10-08" },
        { kind: "routeChangeRequests", count: -1, date: null },
      ],
      nextWorkday: { date: "2026-10-12", agents: 1, withoutRoute: 2, agentId: "a" },
    } })
    // An unknown kind, a zero and a negative count are not rows; a malformed day is no day.
    expect(read?.items).toEqual([{ kind: "olderAlerts", count: 6, date: null }])
    // More agents without a route than agents: not a fact.
    expect(read?.nextWorkday).toBeNull()
  })
})

describe("the week line", () => {
  const report = (planned: number, done: number, visits: number) => ({ success: true, data: { report: { plan: { numerator: done, denominator: planned, percentage: 0 }, gps: { numerator: 0, denominator: visits, percentage: 0 } } } })
  const line = (props: Partial<ComponentProps<typeof MtmPanelWeekLine>> = {}) =>
    createElement(MtmPanelWeekLine, { organizationId: "org-1", today: "2026-10-11", regionId: "", teamId: "", ...props })

  it("shows the number the Results tab opens on, for Monday through today", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => json(report(7, 2, 2)))
    vi.stubGlobal("fetch", fetchMock)
    await render("ru", line())
    const row = container.querySelector("[data-testid='mtm-panel-week-line']")
    expect(row?.querySelector("span")?.textContent).toBe("Эта неделя: выполнено 2 из 7 точек плана")
    const link = row?.querySelector("a")
    expect(link?.textContent).toBe("Открыть результаты")
    expect(link?.getAttribute("href")).toBe("/mtm/analytics?period=thisWeek")
    // Monday 5 October through Sunday the 11th, the end exclusive — the range Results asks for.
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/mtm/kpi?visitType=ALL&from=2026-10-05&to=2026-10-12")
  })

  it.each(["az", "en"])("has the words in %s", async (locale) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(report(7, 2, 2))))
    await render(locale, line())
    const text = container.textContent ?? ""
    expect(text).toContain("2")
    expect(text).toContain("7")
    expect(text).not.toMatch(/mtmDashboardPage|week\.|\{done|\{planned/)
  })

  it("names visits made without a plan, and stays silent for a week with neither", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(report(0, 0, 3))))
    await render("ru", line())
    expect(container.querySelector("[data-testid='mtm-panel-week-line'] span")?.textContent).toBe("Эта неделя: 3 визита без плана")
    await act(async () => { root?.unmount() })

    vi.stubGlobal("fetch", vi.fn(async () => json(report(0, 0, 0))))
    await render("ru", line())
    expect(container.innerHTML).toBe("")
  })

  it("is not drawn for a reader Results refuses, nor on a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Manager access required" }, 403)))
    await render("ru", line())
    expect(container.innerHTML).toBe("")
    await act(async () => { root?.unmount() })

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    await render("ru", line())
    expect(container.innerHTML).toBe("")
  })

  it("follows the team filter, and is not drawn under a region Results cannot filter by", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => json(report(7, 2, 2)))
    vi.stubGlobal("fetch", fetchMock)
    await render("ru", line({ regionId: "r1", teamId: "t1" }))
    expect(String(fetchMock.mock.calls[0][0])).toContain("teamId=t1")
    await act(async () => { root?.unmount() })

    fetchMock.mockClear()
    await render("ru", line({ regionId: "r1" }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe("")
  })

  it("reads the registry's report and nothing else", () => {
    expect(panelWeekFacts(report(7, 2, 2))).toEqual({ planned: 7, done: 2, visits: 2 })
    expect(panelWeekFacts({ success: true, data: { report: null } })).toBeNull()
    expect(panelWeekFacts({ success: false, data: report(7, 2, 2).data })).toBeNull()
    expect(panelWeekFacts("<html>")).toBeNull()
  })
})

describe("the Results tab's period from a link", () => {
  it("opens on a period it knows and ignores anything else", () => {
    expect(teamResultsPreset("thisWeek")).toBe("thisWeek")
    expect(teamResultsPreset("last30")).toBe("last30")
    expect(teamResultsPreset("everything")).toBeNull()
    expect(teamResultsPreset(null)).toBeNull()
  })
})
