// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiSpendPage from "@/app/(dashboard)/settings/ai-spend/page"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * «Настройки → ИИ и расходы», the table of services. Owner, 2026-11-22: the
 * page was reconciled with the Google bill, and a cost that is the calls'
 * length at a measured rate — the station sent no token count — must not read
 * as a measurement. Such a row says «оценка»; every other row stays as it was.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const s = ru.aiSpend as Record<string, string>

const counted = { feature: "phone-line", agentId: null, agentName: null, provider: "gemini", model: "gemini-3.8-live",
  keySource: "platform", calls: 9, inputTokens: 815_166, outputTokens: 17_453, costUsd: 1.167, estimated: false }
const estimated = { feature: "ai-call", agentId: null, agentName: null, provider: "gemini", model: "gemini-3.8-live",
  keySource: "platform", calls: 4, inputTokens: 0, outputTokens: 0, costUsd: 0.42, estimated: true }
// A row a build that predates the mark reported: the field is not there at all.
const old: Record<string, unknown> = { ...counted, feature: "call-analysis", provider: "openai", model: "gpt-5.6-luna", costUsd: 0.004 }
delete old.estimated

let rows: unknown[]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/settings/ai-spend") {
    return json({ data: { granularity: "week", range: "90d", timeZone: "Asia/Baku", start: "2026-08-24T00:00:00.000Z",
      firstDay: "2026-08-24", lastDay: "2026-11-22",
      periods: [{ period: "2026-11-16", costUsd: 1.591, calls: 15, byFeature: { "phone-line": 1.167, "ai-call": 0.42, "call-analysis": 0.004 } }],
      rows, totals: { calls: 15, costUsd: 1.591 }, firstCallAt: "2026-11-11T08:00:00.000Z",
      today: { spent: 0.4, limit: null, remaining: null } } })
  }
  if (url.pathname === "/api/v1/settings/ai-keys") return json({ data: { platformAllowed: true, keys: [], providers: [] } })
  return json({ error: "unexpected" }, 404)
})

let container: HTMLDivElement
let root: Root
async function render() {
  const intl = { locale: "ru", timeZone: "Asia/Baku", messages: ru } as Parameters<typeof NextIntlClientProvider>[0]
  // The dashboard layout mounts the one TooltipProvider; the page's help button needs it.
  await act(async () => root.render(createElement(NextIntlClientProvider, intl,
    createElement(TooltipProvider, null, createElement(AiSpendPage)))))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
/** The table's row of a service, by the service's name. */
const row = (service: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("td")?.textContent?.includes(service))!
const cells = (service: string) => [...row(service).querySelectorAll("td")].map((td) => td.textContent ?? "")

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("ResizeObserver", undefined)
  rows = [counted, estimated, old]
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("the spend table's «оценка» mark", () => {
  it("stands on the row priced by the calls' length, and on no other", async () => {
    await render()
    const marks = [...container.querySelectorAll('[data-testid="ai-spend-estimated"]')]
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe(s.estimated)
    expect(s.estimated).toBe("оценка")
    expect(row("Звонки ИИ — разговор").contains(marks[0])).toBe(true)
    // The mark can be reached from the keyboard: its hint says why it is an estimate.
    expect(marks[0].getAttribute("tabindex")).toBe("0")
    expect(s.estimatedHint).toContain("по их длительности")
  })

  it("shows no token count where none was counted, and the count where it was", async () => {
    await render()
    expect(cells("Звонки ИИ — разговор")[4]).toBe("—")
    expect(cells("Телефонная линия заказов")[4]).toMatch(/815.*\/.*17/)
    expect(cells("Телефонная линия заказов")[0]).not.toContain(s.estimated)
  })

  it("draws a row reported without the field exactly as before", async () => {
    await render()
    const before = cells("Разбор звонка после разговора")
    expect(before[0]).toBe("Разбор звонка после разговора")
    expect(before[2]).toContain("gpt-5.6-luna")
    expect(before[4]).toMatch(/815.*\/.*17/)
    // The total still adds every row up, estimates included.
    expect(container.querySelector("tbody tr:last-child")!.textContent).toContain("15")
  })
})

describe("the keys block's help", () => {
  it("has a button with a word on it that opens the step-by-step for a key of one's own", async () => {
    // Owner, 2026-11-23: «лёгкая пошаговая инструкция только для админов, как регистрировать ключ».
    await render()
    const keys = container.querySelector('[data-testid="ai-keys"]')!
    const help = [...keys.querySelectorAll("button")].find((button) => button.textContent?.trim() === ru.nav.help)
    expect(help).toBeDefined()
    await act(async () => { help!.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.body.textContent).toContain("Свой ключ Gemini")
  })
})
