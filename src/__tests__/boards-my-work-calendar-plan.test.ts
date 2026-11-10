// @vitest-environment jsdom
/**
 * «Mənim işlərim → Təqvim»: a card dropped on a day keeps that day when a read
 * of the list that was already under way comes back — the server has the new
 * day, and nothing moves the card again until the next read. The same rule as
 * the tick (boards-my-work-ui.test.ts), and the reason the boards browser run
 * went red every other time (2026-11-10).
 *
 * Only the drag GESTURE is stubbed: dnd-kit decides what a pointer is over by
 * real layout, and jsdom has none. `plan()`, the page's read and `keepOwnDays`
 * are the real ones.
 */
import { act, createElement, type ReactNode } from "react"
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
  TaskPanel: ({ taskId, onClose }: { taskId: string; onClose: () => void }) => createElement(
    "div",
    { "data-testid": "task-panel", "data-task": taskId },
    createElement("button", { "data-testid": "task-panel-close", onClick: onClose }),
  ),
}))

let dropped: ((event: { active: { id: string }; over: { id: string } | null }) => void) | null = null
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: typeof dropped }) => {
    dropped = onDragEnd
    return createElement("div", null, children)
  },
  DragOverlay: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  MouseSensor: {}, TouchSensor: {}, KeyboardSensor: {},
  useSensor: () => ({}),
  useSensors: () => [],
  pointerWithin: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}))

const tz = process.env.TZ
process.env.TZ = "Asia/Baku"
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

const { default: MyWorkPage } = await import("@/app/(dashboard)/boards/mine/page")
const { localDayKey, planForDay, shiftDayKey } = await import("@/lib/tasks/my-work-calendar")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const today = localDayKey(new Date())
const DIVISIONS = [{ id: "mx", name: "Cust-Serv / 2026", color: "#00B8D9", boardColumns: [] }]
const waitingCard = { id: "w-late", title: "53 Sabunçu", status: "todo", priority: "high", dueDate: null, plans: [] as { day: string }[], divisionId: "mx" }
const dayCard = { id: "d-today", title: "Banner", status: "todo", priority: "high", dueDate: null, plans: [planForDay(today)], divisionId: "mx" }

let container: HTMLDivElement
let root: Root
let calls: { url: string; method: string; body?: unknown }[]
/** What the next read of the open list answers, and whether it is held back. */
let answer: unknown[]
let held: (() => void) | null
let holding: boolean

beforeEach(() => {
  calls = []
  dropped = null
  answer = [waitingCard, dayCard]
  held = null
  holding = false
  window.history.replaceState(null, "", "/boards/mine?view=calendar")
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === "/api/v1/divisions") return new Response(JSON.stringify({ success: true, data: { divisions: DIVISIONS } }))
    if (url.endsWith("/plan")) return new Response("{}", { status: 200 })
    if (url.includes("planFrom=")) return new Response(JSON.stringify({ success: true, data: { tasks: [], total: 0 } }))
    if (url.includes("open=1")) {
      if (holding) await new Promise<void>((release) => { held = release })
      return new Response(JSON.stringify({ success: true, data: { tasks: answer, total: answer.length } }))
    }
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
const cards = (sel: string) => [...container.querySelectorAll(`${sel} [data-testid="my-work-card"]`)].map((c) => c.getAttribute("data-task-id"))
const waiting = () => cards('[data-testid="my-work-waiting"]')
const onDay = (day: string) => cards(`[data-day="${day}"]`)

describe("Mənim işlərim → Təqvim: a day given while the list was being read", () => {
  it("stands when that read comes back, and the read's own word for a card nobody moved still arrives", async () => {
    await act(async () => { root.render(createElement(MyWorkPage)) })
    await flush()
    expect(waiting()).toEqual(["w-late"])
    expect(onDay(today)).toEqual(["d-today"])

    // Closing the task panel reads the list again — hold that answer back.
    holding = true
    await act(async () => { (container.querySelector('[data-task-id="w-late"]') as HTMLElement).click() })
    await act(async () => { (container.querySelector('[data-testid="task-panel-close"]') as HTMLButtonElement).click() })
    await flush()
    expect(held).toBeTypeOf("function")

    // Now the card is dropped on today, while that read is still out.
    await act(async () => { dropped!({ active: { id: "w-late" }, over: { id: today } }) })
    await flush()
    expect(calls.at(-1)).toEqual({ url: "/api/v1/tasks/w-late/plan", method: "PUT", body: { day: today } })
    expect(onDay(today)).toEqual(["w-late", "d-today"])

    // The answer was read before the drop: w-late has no day in it, and
    // d-today has lost its own — somewhere else, in another tab.
    answer = [{ ...waitingCard }, { ...dayCard, plans: [] }]
    await act(async () => { held!() })
    await flush()
    expect(onDay(today)).toEqual(["w-late"])
    expect(waiting()).toEqual(["d-today"])
  })

  it("lets go of a day the person took away before that read began", async () => {
    await act(async () => { root.render(createElement(MyWorkPage)) })
    await flush()
    await act(async () => { dropped!({ active: { id: "d-today" }, over: { id: "__waiting__" } }) })
    await flush()
    expect(calls.at(-1)).toEqual({ url: "/api/v1/tasks/d-today/plan", method: "PUT", body: { day: null } })
    expect(waiting()).toEqual(["w-late", "d-today"])

    // A read begun after that: it carries what the server now has, and the
    // page takes it as it is — the card was not touched while it was out.
    holding = true
    answer = [{ ...waitingCard }, { ...dayCard, plans: [] }]
    await act(async () => { (container.querySelector('[data-task-id="w-late"]') as HTMLElement).click() })
    await act(async () => { (container.querySelector('[data-testid="task-panel-close"]') as HTMLButtonElement).click() })
    await flush()
    await act(async () => { held!() })
    await flush()
    expect(waiting()).toEqual(["w-late", "d-today"])
    expect(onDay(today)).toEqual([])
    expect(onDay(shiftDayKey(today, 1))).toEqual([])
  })
})
