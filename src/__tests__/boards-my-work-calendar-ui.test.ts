// @vitest-environment jsdom
/**
 * «Təqvim» of Mənim işlərim (owner, 2026-11-10: «Да, под Bordio» → «Давай, по
 * макету»): days as columns, the waiting list beside them, cards with the
 * real Russian copy. Dragging itself is covered by the boards browser run.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => "ru",
  }
})
vi.mock("@/components/tasks/task-panel/task-panel", () => ({
  TaskPanel: ({ taskId }: { taskId: string }) => createElement("div", { "data-testid": "task-panel", "data-task": taskId }),
}))

const tz = process.env.TZ
process.env.TZ = "Asia/Baku"
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

const { default: MyWorkPage } = await import("@/app/(dashboard)/boards/mine/page")
const { localDayKey, shiftDayKey, startDateForDay } = await import("@/lib/tasks/my-work-calendar")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const today = localDayKey(new Date())
const dueIn = (n: number) => new Date(`${shiftDayKey(today, n)}T23:59:59`).toISOString()
const DIVISIONS = [
  { id: "z1", name: "Zeytun", color: "#6554C0", boardColumns: [] },
  { id: "mx", name: "Cust-Serv / 2026", color: "#00B8D9", boardColumns: [] },
]
const OPEN = [
  { id: "w-late", title: "53 Sabunçu", status: "todo", priority: "high", dueDate: dueIn(-8), startDate: null, divisionId: "mx", _count: { comments: 1, attachments: 0 } },
  { id: "w-soon", title: "74 Nizami", status: "todo", priority: "critical", dueDate: dueIn(1), startDate: null, divisionId: "mx", _count: { comments: 4, attachments: 4 } },
  { id: "d-today", title: "Banner", status: "in_progress", priority: "critical", dueDate: dueIn(0), startDate: startDateForDay(today), divisionId: "z1" },
]
const FINISHED = [
  { id: "d-done", title: "Aksiya Email", status: "done", priority: "medium", dueDate: null, startDate: startDateForDay(shiftDayKey(today, -1)), divisionId: "mx" },
]

let container: HTMLDivElement
let root: Root
let urls: string[]
beforeEach(() => {
  urls = []
  window.history.replaceState(null, "", "/boards/mine?view=calendar")
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url)
    if (url === "/api/v1/divisions") return new Response(JSON.stringify({ success: true, data: { divisions: DIVISIONS } }))
    if (url.includes("open=1")) return new Response(JSON.stringify({ success: true, data: { tasks: OPEN, total: OPEN.length } }))
    if (url.includes("startAfter=")) return new Response(JSON.stringify({ success: true, data: { tasks: FINISHED, total: 1 } }))
    return new Response(JSON.stringify({ success: true, data: { tasks: [], total: 0 } }))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
const render = async () => {
  await act(async () => { root.render(createElement(MyWorkPage)) })
  await flush()
}
const ids = (sel: string) => [...container.querySelectorAll(`${sel} [data-testid="my-work-card"]`)].map((c) => c.getAttribute("data-task-id"))

describe("Mənim işlərim → Təqvim", () => {
  it("opens from ?view=calendar with four days from yesterday on a laptop width", async () => {
    await render()
    expect(container.querySelector('[data-testid="my-work-view-calendar"]')?.getAttribute("aria-pressed")).toBe("true")
    const days = [...container.querySelectorAll('[data-testid="my-work-day"]')].map((d) => d.getAttribute("data-day"))
    expect(days).toEqual([shiftDayKey(today, -1), today, shiftDayKey(today, 1), shiftDayKey(today, 2)])
  })

  it("puts planned tasks on their day — finished ones too, read for the days in view — and the rest in the waiting list", async () => {
    await render()
    expect(ids(`[data-day="${today}"]`)).toEqual(["d-today"])
    expect(ids(`[data-day="${shiftDayKey(today, -1)}"]`)).toEqual(["d-done"])
    expect(ids('[data-testid="my-work-waiting"]')).toEqual(["w-late", "w-soon"])
    const finishedRead = urls.find((u) => u.includes("startAfter="))!
    expect(finishedRead).toContain("mine=1&status=done,completed,cancelled")
    expect(decodeURIComponent(finishedRead)).toContain(`startAfter=${startDateForDay(shiftDayKey(today, -1))}`)
    expect(container.querySelector('[data-testid="my-work-waiting"] h2')?.textContent).toBe("Лист ожидания 2")
    expect(container.querySelector(`[data-day="${today}"] [data-testid="my-work-day-count"]`)?.textContent).toBe("1 задача")
  })

  it("says how pressing the deadline is, in days", async () => {
    await render()
    const due = (id: string) => container.querySelector(`[data-task-id="${id}"] [data-testid="my-work-card-due"]`)?.textContent
    expect(due("w-late")).toBe("просрочено на 8 дней")
    expect(due("w-soon")).toBe("срок завтра")
    expect(due("d-today")).toBe("срок сегодня")
    expect(container.querySelector('[data-task-id="d-done"] [data-testid="my-work-card-due"]')).toBeNull()
  })

  it("steps one day at a time, and «Сегодня» comes back", async () => {
    await render()
    await act(async () => { (container.querySelector('[data-testid="my-work-calendar-next"]') as HTMLButtonElement).click() })
    await flush()
    expect(container.querySelector('[data-testid="my-work-day"]')?.getAttribute("data-day")).toBe(today)
    await act(async () => { (container.querySelector('[data-testid="my-work-calendar-today"]') as HTMLButtonElement).click() })
    await flush()
    expect(container.querySelector('[data-testid="my-work-day"]')?.getAttribute("data-day")).toBe(shiftDayKey(today, -1))
  })

  it("a card opens the task panel; «Список» goes back to the list", async () => {
    await render()
    await act(async () => { (container.querySelector('[data-task-id="w-soon"]') as HTMLElement).click() })
    expect(container.querySelector('[data-testid="task-panel"]')?.getAttribute("data-task")).toBe("w-soon")
    await act(async () => { (container.querySelector('[data-testid="my-work-view-list"]') as HTMLButtonElement).click() })
    expect(container.querySelector('[data-testid="my-work-calendar"]')).toBeNull()
    expect(window.location.search).toBe("")
  })
})
