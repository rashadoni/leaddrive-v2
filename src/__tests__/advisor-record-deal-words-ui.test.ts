// @vitest-environment jsdom
/**
 * The Advisor card on a deal (found 2026-11-18 recording the procurement
 * guide on the demo stand, organization `demo`, deal «Restoran mebeli — 24 yer
 * — Murad Zeynalov»): in Azerbaijani the card read «Restoran mebeli … is
 * stalled in NEGOTIATION», «No stage movement for 60 days and close date is
 * overdue», «Create task», «Follow up: …», «Deal has not moved for 60 days…»,
 * and the assignee line showed the user's id `cmub9ftzx0005kpzo4ol8lg2i`.
 *
 * The real widget on real React; the signal is built by the real stalled-deal
 * collector and the assignee's name attached by the real service step, with
 * only the database (one user row) and the network stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ locale: "az" }))
vi.mock("next-intl", () => ({ useLocale: () => state.locale }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) }
})
vi.mock("sonner", () => ({ toast: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async (args: { where: { organizationId: string; id: { in: string[] } } }) =>
        args.where.organizationId === "org-demo" && args.where.id.in.includes("cmub9ftzx0005kpzo4ol8lg2i")
          ? [{ id: "cmub9ftzx0005kpzo4ol8lg2i", name: "Leyla Həsənova" }]
          : []),
    },
  },
}))

import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { buildStalledDealSignals } from "@/lib/ai/advisor/signals"
import { attachAdvisorAssigneeNames } from "@/lib/ai/advisor/service"
import type { AdvisorCapability, AdvisorSignal } from "@/lib/ai/advisor/types"

const USER_ID = "cmub9ftzx0005kpzo4ol8lg2i"
const DEAL_ID = "cmucf4rlb0057kpyzb3wghbo8"
const now = new Date("2026-11-18T10:00:00.000Z")
const capabilities: AdvisorCapability[] = [{ key: "sales", label: "Sales", moduleId: "sales", status: "active", href: "/deals" }]

async function dealSignals(assignedTo: string | null = USER_ID): Promise<AdvisorSignal[]> {
  const built = buildStalledDealSignals([{
    id: DEAL_ID,
    name: "Restoran mebeli — 24 yer — Murad Zeynalov",
    stage: "NEGOTIATION",
    valueAmount: 18400,
    currency: "AZN",
    probability: 60,
    assignedTo,
    expectedClose: new Date("2026-10-01T00:00:00.000Z"),
    stageChangedAt: new Date("2026-09-19T10:00:00.000Z"),
    updatedAt: new Date("2026-09-19T10:00:00.000Z"),
    company: { name: "Restoran Nərgiz" },
  }], capabilities, now)
  return attachAdvisorAssigneeNames("org-demo", built)
}

let container: HTMLDivElement
let root: Root

function stubSignals(signals: AdvisorSignal[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    json: async () => ({ data: { capabilities, collectorHealth: [], overview: {}, signals } }),
  })))
}

async function renderWidget() {
  await act(async () => {
    root.render(createElement(AdvisorRecordWidget, { entityType: "deal", entityId: DEAL_ID }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container.textContent || ""
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  state.locale = "az"
})

describe("Advisor card on a deal speaks the reader's language", () => {
  it("in Azerbaijani: no English sentence, the stage in words, the assignee by name", async () => {
    stubSignals(await dealSignals())
    const text = await renderWidget()

    expect(text).toContain("Restoran mebeli — 24 yer — Murad Zeynalov «Danışıqlar» mərhələsində dayanıb")
    expect(text).toContain("60 gündür mərhələ dəyişməyib və bağlanış tarixi keçib.")
    expect(text).toContain("Mərhələ: Danışıqlar")
    expect(text).toContain("Tövsiyə olunan addım")
    expect(text).toContain("Tapşırıq yarat")
    expect(text).toContain("Restoran mebeli — 24 yer — Murad Zeynalov üzrə növbəti addımı yoxla")
    expect(text).toContain("Sövdələşmə 60 gündür irəliləmir.")
    expect(text).toContain("İcraçıLeyla Həsənova")

    expect(text).not.toContain(USER_ID)
    for (const english of ["is stalled in", "No stage movement", "Create task", "Follow up:", "Deal has not moved", "NEGOTIATION", "Idle days"]) {
      expect(text, english).not.toContain(english)
    }
  })

  it("in Russian the same card is Russian", async () => {
    state.locale = "ru"
    stubSignals(await dealSignals())
    const text = await renderWidget()

    expect(text).toContain("Restoran mebeli — 24 yer — Murad Zeynalov: сделка стоит на этапе «Переговоры»")
    expect(text).toContain("Этап не менялся 60 дн., дата закрытия прошла.")
    expect(text).toContain("Создать задачу")
    expect(text).toContain("ИсполнительLeyla Həsənova")
    expect(text).not.toContain(USER_ID)
    expect(text).not.toContain("is stalled in")
  })

  it("in English nothing is lost on the way", async () => {
    state.locale = "en"
    stubSignals(await dealSignals())
    const text = await renderWidget()

    expect(text).toContain("Restoran mebeli — 24 yer — Murad Zeynalov is stalled in Negotiation")
    expect(text).toContain("No stage movement for 60 days and close date is overdue.")
    expect(text).toContain("Create task")
    expect(text).toContain("AssigneeLeyla Həsənova")
  })

  it("a stage the organization named itself is shown as written", async () => {
    const [signal] = await dealSignals()
    stubSignals([{ ...signal, title: "Restoran mebeli is stalled in Müqavilə imzalanır" }])
    const text = await renderWidget()
    expect(text).toContain("Restoran mebeli «Müqavilə imzalanır» mərhələsində dayanıb")
  })

  it("an assignee changed after the name was attached is not shown under the old name", async () => {
    const [signal] = await dealSignals()
    const [task, ...rest] = signal.recommendedActions
    stubSignals([{ ...signal, recommendedActions: [{ ...task, payload: { ...task.payload, assignedTo: "someone-else" } }, ...rest] }])
    const text = await renderWidget()
    expect(text).not.toContain("Leyla Həsənova")
    expect(text).toContain("İcraçısomeone-else")
  })

  it("a user outside the organization gets no name", async () => {
    const signals = await attachAdvisorAssigneeNames("org-other", buildStalledDealSignals([{
      id: DEAL_ID, name: "X", stage: "LEAD", valueAmount: 1, currency: "AZN", probability: 10,
      assignedTo: USER_ID, expectedClose: null, stageChangedAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"), company: null,
    }], capabilities, now))
    expect(signals[0]?.recommendedActions[0]?.payload.assignee).toBeUndefined()
  })
})

describe("Advisor card without the advisor", () => {
  // 2026-11-26, contracts E2E: an organization without the AI module got «no risks» on every
  // contract — a check that never ran, reported as passed.
  it.each([401, 403])("a refusal (%i) shows nothing, not «no risks»", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => ({ error: "Forbidden" }) })))
    const text = await renderWidget()
    expect(text).toBe("")
  })
})
