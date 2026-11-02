// @vitest-environment jsdom
/**
 * «Как прошёл визит» on the office card (owner, 2026-10-30: the row of seven
 * circles, five of them «не требовалось», was «слишком запутанно, не юзер
 * френдли»; the list-shaped mockup approved with «Давай»).
 *
 * The real card with the real Russian copy. What is held here: the lines are
 * what the agent did, in order, with a time or a count; a required step
 * nobody recorded says so in red; what this visit never asked for is one
 * sentence, not five lines; a check-in far from the client is a sentence with
 * both distances; the client's open tasks are one line in the same box.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    // ICU plurals are not this test's business: «{count, plural, …}» reads as the count.
    return raw
      .replace(/\{(\w+), plural,[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (_match, name) => String(values?.[name] ?? ""))
      .replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("next/link", async () => {
  const react = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => react.createElement("a", { href, ...rest }, children as never) }
})

import { VisitReviewView, type VisitReviewData } from "@/app/(dashboard)/mtm/visits/visit-review-panel"

const review = ru.mtmVisitsPage as unknown as { review: Record<string, string> & { steps: Record<string, string> } }
const steps = review.review.steps

function visit(over: Partial<VisitReviewData["visit"]> = {}): VisitReviewData {
  return {
    visit: {
      id: "visit-1",
      agentId: "agent-1",
      status: "CHECKED_IN",
      checkInAt: "2026-10-30T18:42:00.000Z",
      checkOutAt: null,
      duration: null,
      // ~10 km north of the client.
      checkInLat: 40.5,
      checkInLng: 49.8671,
      checkOutLat: null,
      checkOutLng: null,
      notes: null,
      outcome: null,
      potential: null,
      resultNotes: null,
      nextActionDueAt: null,
      agent: { id: "agent-1", name: "Сеймур" },
      customer: { id: "customer-1", name: "QA GPS", address: null, city: null, latitude: 40.4093, longitude: 49.8671, geofenceRadius: 250 },
      contact: null,
      route: null,
      routePoint: null,
      requirementSnapshot: { requirements: [] },
      actionResults: [],
      presentationSessions: [],
      photos: [],
      ...over,
    },
    geofenceRadius: 250,
    openTasks: { count: 0, items: [] },
    timezone: "Asia/Baku",
    viewer: { canExecute: false },
  }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(data: VisitReviewData, now = new Date("2026-10-30T18:45:00.000Z")) {
  act(() => {
    root.render(createElement(VisitReviewView, { data, closeHref: "/mtm/visits", now }))
  })
  const block = container.querySelector('[data-testid="mtm-visit-roadmap"]') as HTMLElement
  const lines = [...block.querySelectorAll('[data-testid^="mtm-visit-step-"]')].map((line) => line.textContent ?? "")
  return { block, lines, text: block.textContent ?? "" }
}

describe("«Как прошёл визит» as a list", () => {
  it("a visit under way: arrived with the time and the distance in words, still with the client", () => {
    const { lines, text } = render(visit())

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(steps.arrived)
    expect(lines[0]).toContain("22:42")
    expect(lines[0]).toMatch(/Отметился в \d+[,.]\d км от клиента — можно не дальше 250 м/)
    expect(lines[0]).toContain(review.review.whereCheckedIn)
    expect(lines[1]).toContain(steps.left)
    expect(lines[1]).toContain(review.review.stepStillThere)
    // Under way: the chip counts the minutes, not «—».
    expect(text).toContain("Идёт · 3 мин")
    // What was never asked for is one sentence; tasks are not claimed either way.
    expect(text).toContain(`${review.review.notRequiredList} презентация, фото, подпись, результат.`)
    expect(text).toContain(`${review.review.openTasksLine} ${review.review.openTasksNone}`)
    // The old track is gone.
    expect(text.split(review.review.stepNotRequired)).toHaveLength(2)
    expect(text).not.toContain(review.review.sectionProgress)
  })

  it("a finished visit: done steps with counts, a required one missed in red, the policy's other steps on the same list", () => {
    const { block, lines, text } = render(visit({
      status: "CHECKED_OUT",
      checkInLat: 40.4094,
      checkOutAt: "2026-10-30T19:06:00.000Z",
      checkOutLat: 40.4094,
      checkOutLng: 49.8671,
      duration: 24,
      outcome: "INTERESTED",
      photos: [],
      photoCount: 3,
      requirementSnapshot: {
        requirements: [
          { id: "r1", actionKey: "SIGNATURE", mode: "REQUIRED", minCount: 1 },
          { id: "r2", actionKey: "PHOTO", mode: "OPTIONAL", minCount: 1 },
          { id: "r3", actionKey: "STOCK_CHECK", mode: "REQUIRED", minCount: 1 },
        ],
      },
      actionResults: [{ id: "a1", actionKey: "STOCK_CHECK", status: "COMPLETED", evidence: null, completedAt: "2026-10-30T18:50:00.000Z" }],
    }), new Date("2026-10-30T20:00:00.000Z"))

    const order = [...block.querySelectorAll('[data-testid^="mtm-visit-step-"]')].map((line) => line.getAttribute("data-testid"))
    expect(order).toEqual([
      "mtm-visit-step-arrived",
      "mtm-visit-step-photo",
      "mtm-visit-step-signature",
      "mtm-visit-step-action-STOCK_CHECK",
      "mtm-visit-step-result",
      "mtm-visit-step-left",
    ])
    expect(lines[1]).toContain("3")
    expect(lines[2]).toContain(review.review.stepMissing)
    expect(block.querySelector('[data-testid="mtm-visit-step-signature"] .border-red-500')).not.toBeNull()
    expect(block.querySelector('[data-testid="mtm-visit-step-action-STOCK_CHECK"]')).not.toBeNull()
    expect(lines[5]).toContain("23:06")
    expect(text).toContain("Длился 24 мин · 22:42 — 23:06")
    expect(text).toContain(`${review.review.notRequiredList} презентация.`)
    // No warning for a check-in at the client.
    expect(text).not.toContain("Отметился в")
  })

  it("a visit left open says so once, above the steps, with since when (owner, 2026-10-31: «тут чёрт голову сломает»)", () => {
    const { block } = render(visit(), new Date("2026-10-31T05:42:00.000Z"))
    const card = container.querySelector('[data-testid="mtm-visit-review"]') as HTMLElement

    expect(card.querySelector('[data-testid="mtm-visit-left-open-status"]')?.textContent).toMatch(/^Не закрыт агентом · 11/)
    expect(card.querySelector('[data-testid="mtm-visit-left-open-note"]')?.textContent).toContain("Закрыть визит может только сам агент.")
    expect(card.textContent!.split("Не закрыт агентом")).toHaveLength(2)
    // The steps carry no chip of their own then, and there is no strip of facts.
    expect(block.querySelector("h3 + span")).toBeNull()
    expect(card.querySelector('[data-testid="mtm-visit-review-facts"]')).toBeNull()
  })

  it("puts the manager's rating beside the steps on a joint visit", () => {
    const data = visit({
      jointVisit: {
        manager: { id: "m1", name: "Саида" },
        evaluations: [{ evaluator: { id: "m1", name: "Саида" }, average: 4.5, scores: { a: 4, b: 5 }, questions: [{ id: "a", labels: { az: "Hazırlıq", ru: "Подготовка", en: "Preparation" } }, { id: "b", labels: { az: "Ünsiyyət", ru: "Общение", en: "Talk" } }], comment: null, updatedAt: "2026-10-30T18:46:00.000Z" }],
      },
    } as unknown as Partial<VisitReviewData["visit"]>)
    const { block } = render(data)
    const pair = block.parentElement as HTMLElement

    expect(pair.className).toContain("lg:grid-cols-2")
    expect(pair.querySelector('[data-testid="mtm-visit-joint-block"]')).not.toBeNull()
  })

  it("the presentation step says how many products and for how long, as in the mockup («2 препарата · 6 мин»)", () => {
    const session = (id: string, name: string, seconds: number) => ({
      id, product: { id: `p-${name}`, name, group: { name: "Gastro" } }, document: null, presentationVersion: null,
      openedAt: "2026-10-30T18:45:00.000Z", closedAt: "2026-10-30T18:48:00.000Z", lastViewedAt: null,
      activeDurationSeconds: seconds, pageCount: 7, pagesViewed: [1, 2], openLat: null, openLng: null, closeLat: null, closeLng: null,
    })
    const { block } = render(visit({
      requirementSnapshot: { requirements: [{ id: "r1", actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1 }] },
      presentationSessions: [session("s1", "Forlaks", 180), session("s2", "Adefa", 120), session("s3", "Forlaks", 50)],
    } as unknown as Partial<VisitReviewData["visit"]>))

    // Two products (Forlaks twice), 350 s shown → 6 min. The mock reads the plural as its count.
    expect(block.querySelector('[data-testid="mtm-visit-step-presentation"]')?.textContent).toContain("2 · 6 мин")
    expect(review.review.presentationShown).toContain("few {# препарата}")
  })

  it("names the client's open tasks with a way to them", () => {
    const data = visit()
    data.openTasks = { count: 2, items: [{ id: "t1", title: "Привезти образцы", priority: "HIGH", dueDate: null }] }
    const { block, text } = render(data)

    expect(text).toContain(`${review.review.openTasksLine} 2 — ${review.review.openTasksLink}`)
    expect(text).toContain("Привезти образцы")
    expect(block.querySelector('a[href="/mtm/tasks"]')).not.toBeNull()
  })
})
