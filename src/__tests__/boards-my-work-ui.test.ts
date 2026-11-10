// @vitest-environment jsdom
/**
 * «Mənim işlərim» (owner, 2026-11-10: «Давай, по макету»): the person's own
 * tasks from every board, grouped by due day, rendered with the real Russian
 * copy; the tick moves a task into its board's «done» column and back.
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

import MyWorkPage from "@/app/(dashboard)/boards/mine/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Baku before the fixture dates below are made: the page groups by the person's own day.
const tz = process.env.TZ
process.env.TZ = "Asia/Baku"
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

const day = (offset: number) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 23, 59, 59).toISOString()
}
const columns = [
  { key: "c_todo", label: "Yeni", mapsToStatus: "todo", sortOrder: 1 },
  { key: "c_work", label: "İcrada", mapsToStatus: "in_progress", sortOrder: 2 },
  { key: "c_done", label: "Bitdi", mapsToStatus: "done", sortOrder: 3 },
]
const DIVISIONS = [
  { id: "dig", name: "Digital Marketing", isDepartment: true },
  { id: "trad", name: "Traditional Marketing", isDepartment: true },
  { id: "z1", name: "Zeytun", parentDivisionId: "dig", color: "#6554C0", boardColumns: columns },
  { id: "z2", name: "Zeytun", parentDivisionId: "trad", color: "#FF8B00", boardColumns: columns },
  { id: "p1", name: "Pharmastore", parentDivisionId: "dig", color: "#00B8D9", boardColumns: columns },
]
const TASKS = [
  { id: "t-late", title: "Banner noyabr", status: "in_progress", boardColumnKey: "c_work", dueDate: day(-2), divisionId: "z1" },
  { id: "t-today", title: "Story 46", status: "todo", boardColumnKey: "c_todo", dueDate: day(0), divisionId: "p1" },
  { id: "t-plakat", title: "Plakat", status: "todo", dueDate: day(0), divisionId: "z2" },
  { id: "t-none", title: "Brendbuk", status: "todo", dueDate: null, divisionId: "z1" },
]

let container: HTMLDivElement
let root: Root
let calls: { url: string; method: string; body?: unknown }[]
let patchStatus = 200
beforeEach(() => {
  calls = []
  patchStatus = 200
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === "/api/v1/divisions") return new Response(JSON.stringify({ success: true, data: { divisions: DIVISIONS, myOpenTasks: 4 } }))
    if (url.startsWith("/api/v1/tasks?")) return new Response(JSON.stringify({ success: true, data: { tasks: url.includes("open=1") ? TASKS : [], total: 4 } }))
    if (url.startsWith("/api/v1/tasks/")) return new Response("{}", { status: patchStatus })
    return new Response("{}", { status: 404 })
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
const render = async () => {
  await act(async () => { root.render(createElement(MyWorkPage)) })
  await flush()
}
const groups = () => [...container.querySelectorAll('[data-testid="my-work-group"]')].map((g) => [
  g.getAttribute("data-group"),
  [...g.querySelectorAll('[data-testid="my-work-row"]')].map((r) => r.getAttribute("data-task-id")),
])
const tick = async (id: string) => {
  await act(async () => { (container.querySelector(`[data-task-id="${id}"] [data-testid="my-work-tick"]`) as HTMLButtonElement).click() })
  await flush()
}

describe("Mənim işlərim", () => {
  it("reads only the person's open tasks and lays them out by due day, overdue first", async () => {
    await render()
    expect(calls.find((c) => c.url.startsWith("/api/v1/tasks?"))?.url).toMatch(/mine=1&open=1/)
    expect(groups()).toEqual([
      ["overdue", ["t-late"]],
      ["today", ["t-plakat", "t-today"]],
      ["none", ["t-none"]],
    ])
    expect(container.querySelector('[data-testid="my-work-counts"]')?.textContent).toBe("Открыто: 4 · просрочено: 1")
  })

  it("names the board, with its folder when two boards share a name, and the column the task stands in", async () => {
    await render()
    const cell = (id: string, what: string) => container.querySelector(`[data-task-id="${id}"] [data-testid="my-work-${what}"]`)?.textContent
    expect(cell("t-today", "board")).toBe("Pharmastore")
    expect(cell("t-late", "board")).toBe("Digital Marketing · Zeytun")
    expect(cell("t-plakat", "board")).toBe("Traditional Marketing · Zeytun")
    expect(cell("t-late", "column")).toBe("İcrada")
  })

  it("the tick moves the task into its board's «done» column; ticking again puts it back where it stood", async () => {
    await render()
    await tick("t-late")
    expect(calls.at(-1)).toEqual({ url: "/api/v1/tasks/t-late", method: "PATCH", body: { status: "done", boardColumnKey: "c_done" } })
    expect(container.querySelector('[data-task-id="t-late"] [data-testid="my-work-tick"]')?.getAttribute("aria-pressed")).toBe("true")
    expect(container.querySelector('[data-testid="my-work-counts"]')?.textContent).toBe("Открыто: 3")
    await tick("t-late")
    expect(calls.at(-1)).toEqual({ url: "/api/v1/tasks/t-late", method: "PATCH", body: { status: "in_progress", boardColumnKey: "c_work" } })
    expect(container.querySelector('[data-task-id="t-late"] [data-testid="my-work-tick"]')?.getAttribute("aria-pressed")).toBe("false")
  })

  it("a refused tick is taken back and said in words", async () => {
    await render()
    patchStatus = 403
    await tick("t-today")
    expect(container.querySelector('[data-task-id="t-today"] [data-testid="my-work-tick"]')?.getAttribute("aria-pressed")).toBe("false")
    expect(container.textContent).toContain("Изменение не сохранилось")
  })

  it("the board filter keeps one board's tasks", async () => {
    await render()
    const select = container.querySelector('[data-testid="my-work-board-filter"]') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(["Все доски", "Digital Marketing · Zeytun", "Pharmastore", "Traditional Marketing · Zeytun"])
    await act(async () => {
      select.value = "z1"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(groups()).toEqual([["overdue", ["t-late"]], ["none", ["t-none"]]])
  })

  it("«Показать завершённые» reads the last 14 days' finished tasks", async () => {
    await render()
    await act(async () => { (container.querySelector('[data-testid="my-work-show-done"]') as HTMLButtonElement).click() })
    await flush()
    const doneRead = calls.find((c) => c.url.includes("status=done,completed,cancelled"))
    expect(doneRead?.url).toMatch(/mine=1&status=done,completed,cancelled&completedAfter=/)
  })

  it("a row opens the board's task panel", async () => {
    await render()
    await act(async () => { (container.querySelector('[data-task-id="t-today"] button:not([data-testid])') as HTMLButtonElement).click() })
    expect(container.querySelector('[data-testid="task-panel"]')?.getAttribute("data-task")).toBe("t-today")
  })
})
