// @vitest-environment jsdom
/**
 * The MTM home screen («Bu gün») the owner accepted as a picture on
 * 2026-10-11, drawn by the real components with the real message files.
 * Two days: Sunday at Zeytun Pharma with the numbers that were on prod, and a
 * working Tuesday with five agents.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { MtmHomeDashboard, type HomeTeamToday } from "@/components/mtm/home-dashboard"
import { homeWeekFacts, normalizeHomeAttention, normalizeHomeInsights } from "@/components/mtm/home-data"
import type { HomeTeamCardRow } from "@/components/mtm/home-team-card"
import { readHint } from "./helpers/hint"

vi.mock("next/link", () => ({
  default: (props: { children?: ReactNode; href: string; prefetch?: boolean; [key: string]: unknown }) => {
    // `prefetch` is Next's own prop, not an attribute of <a>.
    const attributes: Record<string, unknown> = { ...props }
    delete attributes.prefetch
    delete attributes.children
    return createElement("a", attributes, props.children)
  },
}))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function row(overrides: Partial<HomeTeamCardRow> & { agentId: string; name: string }): HomeTeamCardRow {
  return { teamName: null, lastGpsAt: null, route: null, visits: [], visitCount: 0, openAlerts: 0, workday: null, role: "AGENT", nextStop: null, ...overrides }
}
const points = (agentId: string, date: string, total: number, done: number) =>
  Array.from({ length: total }, (_unused, index) => ({ agentId, agentName: agentId, date, completed: index < done }))
const visits = (agentId: string, date: string, count: number, withGps = count) =>
  Array.from({ length: count }, (_unused, index) => ({ agentId, agentName: agentId, date, completed: true, gpsConfirmed: index < withGps }))
const weekOf = (monday: string) => Array.from({ length: 7 }, (_unused, index) => ({
  date: new Date(Date.UTC(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)) - 1, Number(monday.slice(8, 10)) + index)).toISOString().slice(0, 10),
  isWorkingDay: index < 5,
}))

type Scenario = {
  team: HomeTeamToday
  attention: Record<string, unknown>
  plan: unknown[]
  visits: unknown[]
  /** Planned and visited by the same weekday of last week. */
  previous: [number, number]
  /** The lower row; absent for a reader the endpoint refuses. */
  insights?: Record<string, unknown>
}

const ZEYTUN: Scenario = {
  team: {
    timezone: "Asia/Baku",
    today: "2026-10-11",
    generatedAt: "2026-10-11T14:54:00.000Z",
    // The director's and the office manager's cards are not field staff.
    rows: [row({ agentId: "adm", name: "Togrul", role: "ADMIN" }), row({ agentId: "mgr", name: "Office Manager", role: "MANAGER" }), row({ agentId: "a1", name: "Seymur Məmmədov" })],
    lastVisitAt: "2026-10-08T12:01:07.987Z",
    workdayEnabled: false,
  },
  attention: {
    timezone: "Asia/Baku",
    today: "2026-10-11",
    generatedAt: "2026-10-11T14:54:00.000Z",
    todayIsWorkingDay: false,
    week: weekOf("2026-10-05"),
    items: [
      { kind: "contactCreateRequests", count: 1, date: "2026-10-08", people: ["Seymur Məmmədov"], peopleCount: 1, types: [] },
      { kind: "olderAlerts", count: 6, date: "2026-10-08", people: [], peopleCount: 0, types: [{ type: "OUT_OF_ZONE", count: 5 }, { type: "LONG_BREAK", count: 1 }] },
      { kind: "photosPendingReview", count: 2, date: "2026-10-07", people: [], peopleCount: 0, types: [] },
    ],
    nextWorkday: { date: "2026-10-12", agents: 1, withoutRoute: 1, agentId: "a1", people: ["Seymur Məmmədov"] },
  },
  plan: [...points("a1", "2026-10-07", 3, 1), ...points("a1", "2026-10-08", 4, 1)],
  visits: [...visits("a1", "2026-10-07", 1), ...visits("a1", "2026-10-08", 1)],
  previous: [0, 0],
  // As on prod: 321 doctors all in class «B», two visited; two visits this week.
  insights: {
    timezone: "Asia/Baku",
    today: "2026-10-11",
    monthStart: "2026-10-01",
    weekStart: "2026-10-05",
    base: { subject: "contacts", grouping: "specialty", total: 321, visited: 2, groups: [{ key: "Terapevt", total: 229, visited: 0 }, { key: "Qastroenteroloq", total: 92, visited: 2 }] },
    quality: { visits: 2, atPlace: 2, awayFromPlace: 0, placeUnknown: 0, withPhoto: 2, tooLong: 1, tooShort: 1, longMinutes: 120, shortMinutes: 2 },
    setup: [{ kind: "customersWithoutPin", count: 69, total: 72 }, { kind: "contactsUnclassified", count: 321, total: 321 }, { kind: "noVisitNorms", count: 0, total: 0 }],
    recentVisits: [
      { id: "v2", at: "2026-10-08T12:01:08.000Z", customerName: "Klinika 2", agentName: "Seymur Məmmədov", durationMinutes: 1, flag: "short" },
      { id: "v1", at: "2026-10-07T18:14:51.000Z", customerName: "Klinika 1", agentName: "Seymur Məmmədov", durationMinutes: 798, flag: "long" },
    ],
  },
}

const open = (customerName: string, at: string) => ({ customerName, status: "CHECKED_IN", checkInAt: at, checkOutAt: null })
const closed = (customerName: string, from: string, to: string) => ({ customerName, status: "CHECKED_OUT", checkInAt: from, checkOutAt: to })

const TUESDAY: Scenario = {
  team: {
    timezone: "Asia/Baku",
    today: "2026-10-13",
    generatedAt: "2026-10-13T07:42:00.000Z",
    rows: [
      row({ agentId: "adm", name: "Togrul", role: "ADMIN" }),
      row({ agentId: "a1", name: "Seymur Məmmədov", route: { visited: 3, total: 8 }, lastGpsAt: "2026-10-13T07:40:00.000Z", visitCount: 3, visits: [open("Mərkəzi Klinika", "2026-10-13T07:31:00.000Z")], nextStop: { customerName: "Aptek 12", plannedAt: "2026-10-13T08:30:00.000Z" } }),
      row({ agentId: "a2", name: "Leyla Həsənova", route: { visited: 1, total: 6 }, lastGpsAt: "2026-10-13T07:38:00.000Z", visitCount: 1, visits: [closed("Poliklinika 4", "2026-10-13T06:10:00.000Z", "2026-10-13T06:35:00.000Z")], nextStop: { customerName: "Hospital 2", plannedAt: "2026-10-13T08:00:00.000Z" } }),
      row({ agentId: "a3", name: "Aysel Quliyeva", route: { visited: 5, total: 7 }, lastGpsAt: "2026-10-13T07:41:00.000Z", visitCount: 5, visits: [open("Aptek 12", "2026-10-13T07:20:00.000Z")], nextStop: { customerName: "Klinika 7", plannedAt: null } }),
      row({ agentId: "a4", name: "Rauf Quliyev", route: { visited: 0, total: 5 }, nextStop: { customerName: "Aptek 3", plannedAt: "2026-10-13T06:00:00.000Z" }, openAlerts: 1 }),
      row({ agentId: "a5", name: "Nigar Əliyeva" }),
    ],
    lastVisitAt: null,
    workdayEnabled: false,
  },
  attention: {
    timezone: "Asia/Baku",
    today: "2026-10-13",
    generatedAt: "2026-10-13T07:42:00.000Z",
    todayIsWorkingDay: true,
    week: weekOf("2026-10-12"),
    items: [{ kind: "routeChangeRequests", count: 1, date: "2026-10-12", people: ["Leyla Həsənova"], peopleCount: 1, types: [] }],
    nextWorkday: { date: "2026-10-14", agents: 5, withoutRoute: 0, agentId: null, people: [] },
  },
  plan: [
    ...points("a1", "2026-10-12", 6, 6), ...points("a1", "2026-10-13", 8, 3), ...points("a1", "2026-10-14", 7, 0),
    ...points("a2", "2026-10-12", 5, 4), ...points("a2", "2026-10-13", 6, 1),
    ...points("a3", "2026-10-12", 7, 7), ...points("a3", "2026-10-13", 7, 5),
    ...points("a4", "2026-10-12", 8, 5), ...points("a4", "2026-10-13", 5, 0),
  ],
  visits: [...visits("a1", "2026-10-12", 6), ...visits("a1", "2026-10-13", 3), ...visits("a2", "2026-10-12", 4), ...visits("a2", "2026-10-13", 1), ...visits("a3", "2026-10-12", 7), ...visits("a3", "2026-10-13", 5), ...visits("a4", "2026-10-12", 5, 3)],
  previous: [50, 26],
  insights: {
    timezone: "Asia/Baku",
    today: "2026-10-13",
    monthStart: "2026-10-01",
    weekStart: "2026-10-12",
    base: { subject: "contacts", grouping: "class", total: 502, visited: 158, groups: [{ key: "VIP", total: 12, visited: 9 }, { key: "A", total: 80, visited: 41 }, { key: "B", total: 260, visited: 88 }, { key: "C", total: 150, visited: 20 }] },
    quality: { visits: 31, atPlace: 28, awayFromPlace: 2, placeUnknown: 1, withPhoto: 27, tooLong: 0, tooShort: 2, longMinutes: 120, shortMinutes: 2 },
    setup: [],
    recentVisits: [{ id: "v9", at: "2026-10-13T07:31:00.000Z", customerName: "Mərkəzi Klinika", agentName: "Seymur Məmmədov", durationMinutes: null, flag: null }],
  },
}

let root: Root | null = null
let container: HTMLElement
let requests: string[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function report(plan: unknown[], visitFacts: unknown[], totals: [number, number]) {
  return { success: true, data: { report: { plan: { denominator: totals[0], numerator: totals[1], percentage: 0 }, gps: { denominator: 0, numerator: 0, percentage: 0 }, drilldown: { planDenominator: plan, gpsDenominator: visitFacts } } } }
}

function serve(scenario: Scenario, overrides: { attention?: () => Response | Promise<Response>; kpi?: () => Response | Promise<Response>; insights?: () => Response | Promise<Response> } = {}) {
  const monday = (scenario.attention.week as Array<{ date: string }>)[0].date
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    if (url.includes("/week/attention")) return overrides.attention ? overrides.attention() : json({ success: true, data: scenario.attention })
    if (url.includes("/week/insights")) return overrides.insights ? overrides.insights() : scenario.insights ? json({ success: true, data: scenario.insights }) : json({ error: "nope" }, 500)
    if (url.includes("/mtm/kpi")) {
      if (overrides.kpi) return overrides.kpi()
      // This week (Monday through Sunday) carries the facts; any other range is last week's totals.
      return url.includes(`from=${monday}`) ? json(report(scenario.plan, scenario.visits, [0, 0])) : json(report([], [], scenario.previous))
    }
    return json({ success: false }, 404)
  }))
}

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

const opened = vi.fn()
const retried = vi.fn()

async function render(locale: string, scenario: Scenario, props: Partial<ComponentProps<typeof MtmHomeDashboard>> = {}) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(IntlProvider, { locale, messages, timeZone: "Asia/Baku" }, createElement(MtmHomeDashboard, {
      organizationId: "org-1",
      viewerId: "user-1",
      regionId: "",
      teamId: "",
      team: scenario.team,
      teamLoading: false,
      teamFailed: false,
      refreshToken: 0,
      controls: createElement("span", { "data-testid": "controls" }, "filters"),
      onRetry: retried,
      onOpenAgent: opened,
      ...props,
    })))
  })
  await settle()
  return container
}

const text = (testId: string) => container.querySelector(`[data-testid='${testId}']`)?.textContent ?? ""
const kpi = (name: string) => ({ value: text(`mtm-home-kpi-${name}-value`), sub: text(`mtm-home-kpi-${name}-sub`), all: text(`mtm-home-kpi-${name}`) })
const attentionRow = (key: string) => container.querySelector<HTMLElement>(`[data-testid='mtm-home-attention-${key}']`)
const teamRows = () => Array.from(container.querySelectorAll<HTMLElement>("[data-testid='mtm-home-team-row']"))
const cells = (rowElement: HTMLElement) => Array.from(rowElement.querySelectorAll<HTMLButtonElement>("[data-testid='mtm-home-team-week'] button"))

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  requests = []
  opened.mockClear()
  retried.mockClear()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  document.body.innerHTML = ""
})

describe("Zeytun Pharma, Sunday 11 October", () => {
  it("heads the screen with the date and the kind of day, not with a greeting and a clock", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    expect(text("mtm-home-title")).toBe("воскресенье, 11 октября")
    expect(text("mtm-home-note")).toBe("Выходной · данные на 18:54")
    expect(container.querySelector("[data-testid='controls']")).not.toBeNull()
  })

  it("puts the day in four figures", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    // One field agent: the two office cards are not counted.
    expect(kpi("field").value).toBe("0")
    expect(kpi("field").all).toContain("из 1 сотрудника")
    expect(kpi("field").sub).toBe("Последний визит — четверг, 8 октября")
    // Nothing today, so the second figure is whether Monday is ready.
    expect(kpi("plan").all).toContain("План на завтра")
    expect(kpi("plan").value).toBe("0")
    expect(kpi("plan").all).toContain("плана нет")
    expect(kpi("plan").sub).toBe("понедельник, 12 октября")
    // Two of seven published stops — the number «Результаты» shows for the week.
    expect(kpi("week").value).toBe("2")
    expect(kpi("week").all).toContain("из 7 точек")
    expect(kpi("week").all).toContain("29%")
    expect(kpi("week").sub).toBe("на прошлой неделе плана не было")
    // A request, alerts of an earlier day, unreviewed photos, and Monday without a route.
    expect(kpi("attention").value).toBe("4")
    expect(kpi("attention").sub).toBe("1 заявка · 6 оповещений · 2 фото · план")
  })

  it("lists what waits, whose it is and since when, each with a button to its own list", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    const request = attentionRow("contactCreateRequests")!
    expect(request.querySelector("p")?.textContent).toBe("Заявка на нового клиента")
    expect(request.textContent).toContain("Seymur Məmmədov · ждёт с 8 окт.")
    expect(request.querySelector("a")?.textContent).toBe("Открыть заявку")
    // The request queue unfolded, not the list of existing clients (owner, 2026-10-20).
    expect(request.querySelector("a")?.getAttribute("href")).toBe("/mtm/contacts?requests=open")

    const alerts = attentionRow("olderAlerts")!
    expect(alerts.querySelector("p")?.textContent).toBe("6 оповещений не разобрано")
    expect(alerts.textContent).toContain("8 окт. · 5 «Вне маршрута», 1 «Долгий перерыв»")
    // The alerts page opens on every open alert, whatever its day — all six are there.
    expect(alerts.querySelector("a")?.getAttribute("href")).toBe("/mtm/alerts")

    const photos = attentionRow("photosPendingReview")!
    expect(photos.querySelector("p")?.textContent).toBe("2 фото не проверены")
    expect(photos.querySelector("a")?.getAttribute("href")).toBe("/mtm/photos?status=PENDING&period=all")

    const next = attentionRow("next-workday")!
    expect(next.querySelector("p")?.textContent).toBe("На завтра нет маршрута")
    expect(next.textContent).toContain("понедельник, 12 октября · без плана: Seymur Məmmədov")
    expect(next.querySelector("a")?.getAttribute("href")).toBe("/mtm/routes?planAgentId=a1&planDate=2026-10-12")

    expect(Array.from(container.querySelectorAll("[data-testid='mtm-home-attention'] li")).map((item) => item.getAttribute("data-testid"))).toEqual([
      "mtm-home-attention-contactCreateRequests",
      "mtm-home-attention-olderAlerts",
      "mtm-home-attention-photosPendingReview",
      "mtm-home-attention-next-workday",
    ])
    // Every row ends in words, and the first is the one to start with.
    for (const link of Array.from(container.querySelectorAll("[data-testid='mtm-home-attention'] li a"))) expect(link.textContent?.trim().length).toBeGreaterThan(3)
  })

  // Owner, 2026-10-12, having sent «Клиент здесь» from a phone: «в панели также
  // должно показываться… агент может быть рядом с клиентом, и чтоб долго не ждать».
  describe("an agent's request to move a customer's pin", () => {
    const waiting = (since: string, date: string) => ({
      ...ZEYTUN,
      attention: {
        ...ZEYTUN.attention,
        items: [
          { kind: "customerLocationRequests", count: 1, date, since, people: ["Nigar Əliyeva"], peopleCount: 1, types: [] },
          ...(ZEYTUN.attention.items as unknown[]),
        ],
      },
    })

    // No row's button is filled since 2026-10-18: the screen keeps one orange fill.
    it("stands first, in red, with the hour it was sent", async () => {
      // 18:04 in Baku, today.
      const scenario = waiting("2026-10-11T14:04:00.000Z", "2026-10-11")
      serve(scenario)
      await render("ru", scenario)
      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-testid='mtm-home-attention'] li"))
      expect(rows[0].getAttribute("data-testid")).toBe("mtm-home-attention-customerLocationRequests")
      const row = attentionRow("customerLocationRequests")!
      expect(row.querySelector("p")?.textContent).toBe("Адрес клиента: агент сообщает другое место")
      expect(row.textContent).toContain("Nigar Əliyeva · ждёт с 18:04")
      const link = row.querySelector("a")!
      expect(link.textContent).toBe("Посмотреть место")
      expect(link.getAttribute("href")).toBe("/mtm/routes?view=approvals")
      // The icon of this row is red; the request for a new client under it is blue.
      expect(row.querySelector("span")?.className).toBe(attentionRow("next-workday")?.querySelector("span")?.className)
      expect(row.querySelector("span")?.className).not.toBe(attentionRow("contactCreateRequests")?.querySelector("span")?.className)
      // It is one more request in the figure above.
      expect(kpi("attention").value).toBe("5")
      expect(kpi("attention").sub).toBe("2 заявки · 6 оповещений · 2 фото · план")
    })

    it("names the day instead of the hour once the request is not of today", async () => {
      const scenario = waiting("2026-10-09T08:15:00.000Z", "2026-10-09")
      serve(scenario)
      await render("ru", scenario)
      expect(attentionRow("customerLocationRequests")?.textContent).toContain("Nigar Əliyeva · ждёт с 9 окт.")
    })

    it("reads in Azerbaijani", async () => {
      const scenario = waiting("2026-10-11T14:04:00.000Z", "2026-10-11")
      serve(scenario)
      await render("az", scenario)
      const row = attentionRow("customerLocationRequests")!
      expect(row.querySelector("p")?.textContent).toBe("Müştəri ünvanı: agent başqa yer bildirir")
      expect(row.textContent).toContain("Nigar Əliyeva · 18:04-dən gözləyir")
      expect(row.querySelector("a")?.textContent).toBe("Yerə bax")
    })
  })

  it("shows the one agent with the week as it went: two partial days, the rest without a plan, a weekend", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    const rows = teamRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain("Seymur Məmmədov")
    expect(rows[0].textContent).toContain("активности нет")
    expect(cells(rows[0]).map((cell) => cell.getAttribute("data-tone"))).toEqual(["none", "none", "partial", "partial", "none", "off", "off"])
    expect(cells(rows[0]).map((cell) => cell.textContent)).toEqual(["–", "–", "1/3", "1/4", "–", "", ""])
    // What a cell holds is said under the cursor, as it is to a screen reader.
    expect(await readHint(cells(rows[0])[2])).toBe("среда, 7 октября: посещено 1 из 3")
    expect(cells(rows[0])[2].getAttribute("aria-label")).toBe("среда, 7 октября: посещено 1 из 3")
    expect(rows[0].querySelector("[data-testid='mtm-home-team-total']")?.textContent).toBe("2/7")
    expect(text("mtm-home-team")).toContain("Неделя: 2 визита · с подтверждением по GPS 100%")
    expect(container.querySelector("[data-testid='mtm-home-team'] a[href='/mtm/analytics?period=thisWeek']")?.textContent).toBe("Открыть результаты")
    expect(container.querySelector("[data-testid='mtm-home-team'] a[href='/mtm/map']")?.textContent).toBe("Открыть карту")
  })

  it("asks «Результаты» for Monday through Sunday, and for the same days of last week", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    const kpiRequests = requests.filter((url) => url.includes("/mtm/kpi"))
    expect(kpiRequests).toContain("/api/v1/mtm/kpi?visitType=ALL&from=2026-10-05&to=2026-10-12")
    expect(kpiRequests).toContain("/api/v1/mtm/kpi?visitType=ALL&from=2026-09-28&to=2026-10-05")
    expect(requests.filter((url) => url.includes("/week/attention"))).toEqual(["/api/v1/mtm/week/attention?"])
  })

  it.each(["az", "en", "ru"])("has words for everything in %s, never a message key", async (locale) => {
    serve(ZEYTUN)
    await render(locale, ZEYTUN)
    const all = container.textContent ?? ""
    expect(all).not.toMatch(/mtmDashboardPage|operationalWeek|home\.[a-z]|\{count|\{date|\{total|\{percent|\{name|\{people/)
    expect(container.querySelectorAll("[data-testid='mtm-home-attention'] li")).toHaveLength(4)
    expect(teamRows()).toHaveLength(1)
    for (const number of ["29%", "2/7", "1/3", "1/4"]) expect(all).toContain(number)
  })

  it("reads in Azerbaijani as the owner's screen does", async () => {
    serve(ZEYTUN)
    await render("az", ZEYTUN)
    expect(text("mtm-home-note")).toBe("İstirahət günü · 18:54 üzrə")
    expect(kpi("field").all).toContain("Sahədə indi")
    expect(kpi("plan").all).toContain("Sabah üçün plan")
    expect(kpi("plan").all).toContain("plan yoxdur")
    expect(kpi("week").sub).toBe("keçən həftə plan yox idi")
    expect(kpi("attention").sub).toBe("1 sorğu · 6 xəbərdarlıq · 2 foto · plan")
    expect(attentionRow("contactCreateRequests")?.querySelector("a")?.textContent).toBe("Sorğuya bax")
    expect(attentionRow("next-workday")?.querySelector("p")?.textContent).toBe("Sabah üçün marşrut yoxdur")
    expect(text("mtm-home-team")).toContain("Komanda · bu həftə")
  })
})

describe("a working Tuesday with five agents", () => {
  it("counts who is out, today's plan, the week against last week, and what waits", async () => {
    serve(TUESDAY)
    await render("ru", TUESDAY)
    expect(text("mtm-home-note")).toBe("Рабочий день · данные на 11:42")
    // Two at a customer and one on the way, of five field agents (the director is not one).
    expect(kpi("field").value).toBe("3")
    expect(kpi("field").all).toContain("из 5 сотрудников")
    expect(kpi("field").all).toContain("2 на визите")
    expect(kpi("field").sub).toBe("1 в пути · 1 не начал · 1 без активности")
    expect(kpi("plan").all).toContain("План на сегодня")
    expect(kpi("plan").value).toBe("9")
    expect(kpi("plan").all).toContain("из 26 точек")
    expect(kpi("plan").all).toContain("35%")
    expect(kpi("plan").sub).toBe("9 визитов сегодня")
    // Monday 22 of 26 and today 9 of 26: 31 of 52, against 26 of 50 a week ago.
    expect(kpi("week").value).toBe("31")
    expect(kpi("week").all).toContain("60%")
    expect(kpi("week").sub).toBe("неделю назад к этому дню было 52% · ↑ 8 п.")
    expect(kpi("attention").value).toBe("1")
    expect(kpi("attention").sub).toBe("1 заявка")
  })

  // Owner, 2026-10-15: «подсказок в модуле очень мало». Every figure says
  // under the cursor what it counts, every button where it leads, every chip
  // what it means — in the language of the screen.
  it("says under the cursor what each figure counts, where each button leads and what each chip means", async () => {
    serve(TUESDAY)
    await render("ru", TUESDAY)
    const hint = (key: string) => {
      const home = (JSON.parse(readFileSync("messages/ru.json", "utf8")) as { mtmDashboardPage: { home: { hint: Record<string, string> } } }).mtmDashboardPage.home.hint
      return home[key]
    }
    const label = (id: string) => container.querySelector(`[data-testid='mtm-home-kpi-${id}'] [data-hint-value]`)
    expect(await readHint(label("field"))).toBe(hint("kpiInField"))
    expect(await readHint(label("plan"))).toBe(hint("kpiTodayPlan"))
    expect(await readHint(label("week"))).toBe(hint("kpiWeekPlan"))
    expect(await readHint(label("attention"))).toBe(hint("kpiAttention"))
    // The waiting request's button says where it leads.
    const button = container.querySelector("[data-testid='mtm-home-attention'] a")
    expect(await readHint(button)).toMatch(/^Откроет /)
    // The chip of a silent phone with a plan explains «не начал».
    const rows = teamRows()
    const chip = [...rows[3].querySelectorAll("[tabindex='0']")].find((node) => node.textContent?.includes("не начал"))
    expect(await readHint(chip)).toBe(hint("stateNotStarted"))
  })

  it("lists the team with those busy now first, each with a chip, a place and the week", async () => {
    serve(TUESDAY)
    await render("ru", TUESDAY)
    const rows = teamRows()
    expect(rows.map((item) => item.querySelector("button")?.textContent)).toEqual(["Aysel Quliyeva", "Seymur Məmmədov", "Leyla Həsənova", "Rauf Quliyev", "Nigar Əliyeva"])
    expect(rows[0].textContent).toContain("на визите")
    expect(rows[0].textContent).toContain("Aptek 12, с 11:20")
    expect(rows[2].textContent).toContain("в пути")
    expect(rows[2].textContent).toContain("→ Hospital 2, 12:00")
    // A plan and a silent phone is «not started», and its day is not judged yet.
    expect(rows[3].textContent).toContain("не начал")
    expect(cells(rows[3]).slice(0, 2).map((cell) => [cell.getAttribute("data-tone"), cell.textContent])).toEqual([["partial", "5/8"], ["pending", "0/5"]])
    expect(rows[3].querySelector("a[href='/mtm/alerts?agentId=a4']")?.getAttribute("aria-label")).toBe("1 открытое оповещение")
    expect(await readHint(rows[3].querySelector("a[href='/mtm/alerts?agentId=a4']"))).toBe("1 открытое оповещение. Его открытые оповещения — нажмите, чтобы открыть.")
    expect(rows[4].textContent).toContain("активности нет")
    // Seymur: Monday done, today in progress, Wednesday ahead.
    expect(cells(rows[1]).map((cell) => `${cell.getAttribute("data-tone")}:${cell.textContent}`)).toEqual(["full:6/6", "partial:3/8", "upcoming:7", "none:–", "none:–", "off:", "off:"])
    expect(rows[1].querySelector("[data-testid='mtm-home-team-total']")?.textContent).toBe("9/14")
    expect(text("mtm-home-team")).toContain("Неделя: 31 визит · с подтверждением по GPS 94%")
  })

  it("opens an agent's week from the name and a particular day from its cell", async () => {
    serve(TUESDAY)
    await render("ru", TUESDAY)
    const seymur = teamRows()[1]
    await act(async () => { seymur.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(opened).toHaveBeenLastCalledWith("a1")
    await act(async () => { cells(seymur)[0].dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(opened).toHaveBeenLastCalledWith("a1", "2026-10-12")
  })

  it("says «nothing waits» in the card and the figure when every list is empty", async () => {
    serve({ ...TUESDAY, attention: { ...TUESDAY.attention, items: [] } })
    await render("ru", TUESDAY)
    expect(kpi("attention").value).toBe("0")
    expect(kpi("attention").sub).toBe("всё разобрано")
    expect(text("mtm-home-attention-clear")).toBe("Заявок, оповещений и непроверенных фото нет")
    expect(container.querySelectorAll("[data-testid='mtm-home-attention'] li")).toHaveLength(0)
  })
})

describe("when something does not load", () => {
  it("does not pass a failed check off as «nothing waits», and retries on request", async () => {
    let fail = true
    serve(ZEYTUN, { attention: () => (fail ? json({ error: "boom" }, 500) : json({ success: true, data: ZEYTUN.attention })) })
    await render("ru", ZEYTUN)
    const alert = container.querySelector("[data-testid='mtm-home-attention-error']")
    expect(alert?.getAttribute("role")).toBe("alert")
    expect(kpi("attention").value).toBe("—")
    expect(kpi("attention").sub).toBe("Не удалось проверить, что ждёт решения")
    fail = false
    await act(async () => { alert?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await settle()
    expect(container.querySelector("[data-testid='mtm-home-attention-error']")).toBeNull()
    expect(kpi("attention").value).toBe("4")
  })

  it("draws the team without a week strip when the week cannot be read, and offers to try again", async () => {
    let fail = true
    serve(TUESDAY, { kpi: () => (fail ? json({ error: "boom" }, 500) : json(report(TUESDAY.plan, TUESDAY.visits, [0, 0]))) })
    await render("ru", TUESDAY)
    expect(teamRows()).toHaveLength(5)
    expect(container.querySelector("[data-testid='mtm-home-team-week']")).toBeNull()
    // Unknown is a dash, never a zero.
    expect(kpi("week").value).toBe("—")
    expect(kpi("week").sub).toBe("Данные недели не загрузились")
    expect(text("mtm-home-team")).toContain("Данные недели не загрузились")
    fail = false
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-testid='mtm-home-team'] button")).find((button) => button.textContent === "Повторить")
    await act(async () => { retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await settle()
    expect(container.querySelectorAll("[data-testid='mtm-home-team-week']")).toHaveLength(5)
  })

  it("gives a reader «Результаты» refuses the day without the week", async () => {
    serve(TUESDAY, { kpi: () => json({ error: "Manager access required" }, 403) })
    await render("ru", TUESDAY)
    expect(teamRows()).toHaveLength(5)
    expect(container.querySelector("[data-testid='mtm-home-team-week']")).toBeNull()
    expect(kpi("week").value).toBe("—")
    // Refused is not failed: nothing to retry.
    expect(text("mtm-home-team")).not.toContain("Данные недели не загрузились")
  })

  it("shows dashes while the team list has not arrived, and its own failure with a retry", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN, { team: null, teamLoading: true })
    expect(kpi("field").value).toBe("—")
    expect(text("mtm-home-team")).toContain("Загружаем")
    await act(async () => { root?.unmount() })

    serve(ZEYTUN)
    await render("ru", ZEYTUN, { team: null, teamLoading: false, teamFailed: true })
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-testid='mtm-home-team'] button")).find((button) => button.textContent === "Повторить")
    await act(async () => { retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(retried).toHaveBeenCalledTimes(1)
  })

  it("tells a team of office cards from an empty scope", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN, { team: { ...ZEYTUN.team, rows: ZEYTUN.team.rows.slice(0, 2) } })
    expect(text("mtm-home-team")).toContain("Полевых сотрудников в этой зоне нет")
    await act(async () => { root?.unmount() })
    serve(ZEYTUN)
    await render("ru", ZEYTUN, { team: { ...ZEYTUN.team, rows: [] } })
    expect(text("mtm-home-team")).toContain("В этой зоне нет сотрудников")
  })
})

describe("the lower row", () => {
  it("shows how much of Zeytun's base was reached this month, by specialty while all are in one class", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    expect(text("mtm-home-base")).toContain("База клиентов · октябрь")
    expect(text("mtm-home-base-visited")).toBe("2")
    expect(text("mtm-home-base")).toContain("из 321 посещено в этом месяце")
    // Two of 321 is 0.6 %: a rounded «0%» would deny the two visits that were made.
    expect(text("mtm-home-base")).toContain("0,6%")
    const groups = Array.from(container.querySelectorAll("[data-testid='mtm-home-base-group']")).map((item) => item.textContent)
    expect(groups).toEqual(["Terapevt0 / 2290%", "Qastroenteroloq2 / 922%"])
    expect(text("mtm-home-base")).toContain("Не посещено в этом месяце: 319")
    expect(container.querySelector("[data-testid='mtm-home-base'] a[href='/mtm/contacts']")?.textContent).toBe("Открыть список")
    expect(container.querySelector("[data-testid='mtm-home-base'] a[href='/mtm/routes']")?.textContent).toBe("Спланировать визиты")
  })

  it("judges the week's visits: place, photo, too long, too short", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    expect(text("mtm-home-quality")).toContain("Качество визитов · эта неделя")
    expect(text("mtm-home-quality-place")).toBe("Отмечены рядом с клиентомотметка в пределах зоны клиента2 / 2")
    expect(text("mtm-home-quality-photo")).toBe("С фотов каждом визите есть фото2 / 2")
    expect(text("mtm-home-quality-long")).toBe("Слишком длинныедольше 120 мин1")
    expect(text("mtm-home-quality-short")).toBe("Слишком короткиекороче 2 мин1")
    expect(container.querySelector("[data-testid='mtm-home-quality'] a[href='/mtm/visits']")?.textContent).toBe("Открыть визиты")
  })

  it("names what is left to set up, each step a link to where it is done", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    expect(text("mtm-home-setup")).toContain("Чтобы цифры были полными, осталось 3 шага:")
    const step = (kind: string) => container.querySelector<HTMLAnchorElement>(`[data-testid='mtm-home-setup-${kind}']`)
    expect(step("customersWithoutPin")?.textContent).toBe("Поставьте точку на карте 69 учреждениям")
    expect(step("customersWithoutPin")?.getAttribute("href")).toBe("/mtm/customers")
    expect(step("contactsUnclassified")?.textContent).toBe("Задайте класс 321 клиенту")
    expect(step("contactsUnclassified")?.getAttribute("href")).toBe("/mtm/contacts")
    expect(step("noVisitNorms")?.textContent).toBe("Задайте нормы визитов")
    expect(step("noVisitNorms")?.getAttribute("href")).toBe("/mtm/settings")
  })

  it("lists a small team's last visits under it, the odd ones marked", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN)
    const recent = container.querySelector("[data-testid='mtm-home-team-recent']")
    expect(recent?.textContent).toContain("Последние визиты")
    expect(Array.from(recent?.querySelectorAll("li") ?? []).map((item) => item.textContent)).toEqual([
      "8 окт., 16:01Klinika 21 мин",
      "7 окт., 22:14Klinika 113 ч 18 мин",
    ])
  })

  it("splits the base by class on a classified base, shows no setup strip and no last visits for a full team", async () => {
    serve(TUESDAY)
    await render("ru", TUESDAY)
    expect(container.querySelector("[data-testid='mtm-home-setup']")).toBeNull()
    expect(container.querySelector("[data-testid='mtm-home-team-recent']")).toBeNull()
    expect(text("mtm-home-base-visited")).toBe("158")
    expect(text("mtm-home-base")).toContain("31%")
    expect(Array.from(container.querySelectorAll("[data-testid='mtm-home-base-group']")).map((item) => item.textContent)).toEqual([
      "VIP9 / 1275%", "Класс A41 / 8051%", "Класс B88 / 26034%", "Класс C20 / 15013%",
    ])
    // Two visits away from the client and one that cannot be judged.
    expect(text("mtm-home-quality-place")).toBe("Отмечены рядом с клиентомвдали от клиента: 2 · нельзя проверить (нет точки или GPS): 128 / 31")
    expect(text("mtm-home-quality-photo")).toBe("С фотобез фото: 427 / 31")
    expect(text("mtm-home-quality-long")).toContain("0")
  })

  it.each(["az", "en"])("has words for the lower row in %s", async (locale) => {
    serve(ZEYTUN)
    await render(locale, ZEYTUN)
    for (const testId of ["mtm-home-setup", "mtm-home-base", "mtm-home-quality", "mtm-home-team-recent"]) {
      expect(text(testId), testId).not.toMatch(/mtmDashboardPage|home\.[a-z]|\{count|\{total|\{minutes|\{month|\{key|\{hours/)
      expect(text(testId).length, testId).toBeGreaterThan(10)
    }
  })

  it("asks once, for the screen's filters, and is simply absent when the answer does not come", async () => {
    serve(ZEYTUN)
    await render("ru", ZEYTUN, { regionId: "r1", teamId: "t1" })
    expect(requests.filter((url) => url.includes("/week/insights"))).toEqual(["/api/v1/mtm/week/insights?regionId=r1&teamId=t1"])
    await act(async () => { root?.unmount() })

    serve(ZEYTUN, { insights: () => json({ error: "boom" }, 500) })
    await render("ru", ZEYTUN)
    for (const testId of ["mtm-home-setup", "mtm-home-base", "mtm-home-quality", "mtm-home-team-recent"]) {
      expect(container.querySelector(`[data-testid='${testId}']`), testId).toBeNull()
    }
    // The first screen does not depend on it.
    expect(kpi("attention").value).toBe("4")
    expect(teamRows()).toHaveLength(1)
  })

  it("draws both cards or neither, with a plain line where one has nothing to show", async () => {
    serve(ZEYTUN, { insights: () => json({ success: true, data: { ...ZEYTUN.insights, quality: null } }) })
    await render("ru", ZEYTUN)
    expect(text("mtm-home-base-visited")).toBe("2")
    expect(text("mtm-home-quality")).toContain("На этой неделе визитов не было")
    await act(async () => { root?.unmount() })

    serve(ZEYTUN, { insights: () => json({ success: true, data: { ...ZEYTUN.insights, base: null, quality: null, setup: [], recentVisits: [] } }) })
    await render("ru", ZEYTUN)
    expect(container.querySelector("[data-testid='mtm-home-base']")).toBeNull()
    expect(container.querySelector("[data-testid='mtm-home-quality']")).toBeNull()
  })
})

describe("a long team", () => {
  it("shows eight agents and the rest on request, in the page and not in a frame", async () => {
    const many: Scenario = {
      ...TUESDAY,
      team: { ...TUESDAY.team, rows: Array.from({ length: 11 }, (_unused, index) => row({ agentId: `n${index}`, name: `Agent ${String(index).padStart(2, "0")}` })) },
    }
    serve(many)
    await render("ru", many)
    expect(teamRows()).toHaveLength(8)
    const more = container.querySelector<HTMLButtonElement>("[data-testid='mtm-home-team-more']")
    expect(more?.textContent).toBe("Ещё 3 сотрудника")
    await act(async () => { more?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(teamRows()).toHaveLength(11)
    expect(container.querySelector("[data-testid='mtm-home-team-more']")?.textContent).toBe("Свернуть")
  })
})

describe("reading the answers", () => {
  it("takes plan points and visits from the registry's report and nothing else", () => {
    expect(homeWeekFacts(report(points("a", "2026-10-07", 2, 1), visits("a", "2026-10-07", 1, 0), [0, 0]))).toEqual({
      planPoints: [{ agentId: "a", date: "2026-10-07", completed: true }, { agentId: "a", date: "2026-10-07", completed: false }],
      visits: [{ agentId: "a", date: "2026-10-07", gpsConfirmed: false }],
    })
    expect(homeWeekFacts({ success: true, data: { report: null } })).toBeNull()
    expect(homeWeekFacts({ success: false })).toBeNull()
    // A fact without an agent or a day cannot be placed on the strip.
    expect(homeWeekFacts(report([{ agentId: "", date: "2026-10-07", completed: true }, { agentId: "a", date: "soon", completed: true }], [], [0, 0]))?.planPoints).toEqual([])
  })

  it("reads «ждёт решения» defensively", () => {
    expect(normalizeHomeAttention(null)).toBeNull()
    expect(normalizeHomeAttention({ success: true, data: { today: "soon", items: [] } })).toBeNull()
    const read = normalizeHomeAttention({ success: true, data: {
      today: "2026-10-11",
      items: [
        { kind: "olderAlerts", count: 6, date: "8 October", types: [{ type: "OUT_OF_ZONE", count: 5 }, { type: "", count: 1 }, { type: "X", count: 0 }] },
        { kind: "shiftsLeftOpen", count: 4 },
        { kind: "contactCreateRequests", count: 0 },
        { kind: "photosPendingReview", count: 2, people: ["A", 7, ""], peopleCount: 1 },
      ],
      nextWorkday: { date: "2026-10-12", agents: 1, withoutRoute: 2 },
      week: [{ date: "2026-10-05", isWorkingDay: true }],
    } })
    // An unknown kind and a zero are not rows; a malformed day is no day.
    expect(read?.items).toEqual([
      { kind: "olderAlerts", count: 6, date: null, people: [], peopleCount: 0, types: [{ type: "OUT_OF_ZONE", count: 5 }] },
      { kind: "photosPendingReview", count: 2, date: null, people: ["A"], peopleCount: 1, types: [] },
    ])
    // More agents without a route than agents is not a fact; a week of one day is not a week.
    expect(read?.nextWorkday).toBeNull()
    expect(read?.week).toEqual([])
    // An older server does not say: the day is taken for a working one.
    expect(read?.todayIsWorkingDay).toBe(true)
  })

  it("reads the lower row defensively", () => {
    expect(normalizeHomeInsights({ success: true, data: { today: "2026-10-11", monthStart: "October", weekStart: "2026-10-05" } })).toBeNull()
    const read = normalizeHomeInsights({ success: true, data: {
      today: "2026-10-11", monthStart: "2026-10-01", weekStart: "2026-10-05",
      base: { subject: "contacts", grouping: "class", total: 10, visited: 14, groups: [{ key: "A", total: 4, visited: 9 }, { key: "", total: 3, visited: 1 }, { key: "B", total: 0, visited: 0 }] },
      // A field missing: the card would show a made-up zero.
      quality: { visits: 2, atPlace: 2, withPhoto: 2 },
      setup: [{ kind: "customersWithoutPin", count: 69, total: 72 }, { kind: "buyMoreLicences", count: 1 }],
      recentVisits: [{ id: "v1", at: "2026-10-08T12:01:08.000Z", durationMinutes: 1, flag: "weird" }, { id: "", at: "2026-10-08T12:01:08.000Z" }, { id: "v3", at: "yesterday" }],
    } })
    // Never more visited than there are; a group without a name or without clients is not a bar.
    expect(read?.base).toEqual({ subject: "contacts", grouping: "class", total: 10, visited: 10, groups: [{ key: "A", total: 4, visited: 4 }] })
    expect(read?.quality).toBeNull()
    expect(read?.setup).toEqual([{ kind: "customersWithoutPin", count: 69, total: 72 }])
    expect(read?.recentVisits).toEqual([{ id: "v1", at: "2026-10-08T12:01:08.000Z", customerName: null, agentName: null, durationMinutes: 1, flag: null }])
  })
})
