// @vitest-environment jsdom
/**
 * Task edits show before the server answers (owner, 2026-11-09: «Да,
 * делай» — boards and task ticks only). The server's answer is held back in
 * these tests, so what the screen shows is read while the request is still
 * on its way; then the server refuses, and exactly that edit goes back.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { applyTaskPatch, revertTaskPatch } from "@/lib/client/optimistic-task-patch"

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

import { TaskPanel } from "@/components/tasks/task-panel/task-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PEOPLE = [{ id: "s", name: "Sabina Hasanova" }, { id: "n", name: "Nazrin Shirinova" }]

describe("a task edit as the screen shows it", () => {
  const task = {
    id: "t1", status: "in_progress", priority: "high", completedAt: null as string | null,
    assignedTo: "s", assignee: { id: "s", name: "Sabina Hasanova", avatar: null },
    customFields: { brand: "Zeytun", channel: "meta" } as Record<string, unknown> | null,
  }

  it("draws the new assignee's name with the new id", () => {
    const next = applyTaskPatch(task, { assignedTo: "n" }, PEOPLE)
    expect(next.assignedTo).toBe("n")
    expect(next.assignee).toEqual({ id: "n", name: "Nazrin Shirinova", avatar: null })
    expect(applyTaskPatch(task, { assignedTo: null }, PEOPLE).assignee).toBeNull()
  })

  it("merges custom fields as the server does, null removing a key", () => {
    const next = applyTaskPatch(task, { customFields: { brand: null, size: "L" } })
    expect(next.customFields).toEqual({ channel: "meta", size: "L" })
  })

  it("marks a task done now, and keeps an earlier completion time", () => {
    const done = applyTaskPatch(task, { status: "completed" })
    expect(done.completedAt).not.toBeNull()
    expect(applyTaskPatch({ ...task, completedAt: "2026-11-01T00:00:00.000Z" }, { status: "done" }).completedAt).toBe("2026-11-01T00:00:00.000Z")
  })

  it("undoes only the refused edit — another edit to the same task stays", () => {
    const priority = { priority: "low" }
    const assignee = { assignedTo: "n" }
    const both = applyTaskPatch(applyTaskPatch(task, priority, PEOPLE), assignee, PEOPLE)
    const afterRefusal = revertTaskPatch(both, task, priority)
    expect(afterRefusal.priority).toBe("high")
    expect(afterRefusal.assignedTo).toBe("n")
    expect(afterRefusal.assignee?.name).toBe("Nazrin Shirinova")
  })

  it("undoes the assignee object and the completion time with their fields", () => {
    const moved = applyTaskPatch(task, { assignedTo: "n", status: "completed" }, PEOPLE)
    const back = revertTaskPatch(moved, task, { assignedTo: "n", status: "completed" })
    expect(back).toEqual(task)
  })

  it("undoes only the custom-field keys the edit touched", () => {
    const first = applyTaskPatch(task, { customFields: { brand: "Pharmastore" } })
    const second = applyTaskPatch(first, { customFields: { size: "L" } })
    expect(revertTaskPatch(second, task, { customFields: { size: "L" } }).customFields).toEqual({ brand: "Pharmastore", channel: "meta" })
  })
})

const TASK = {
  id: "t1", divisionId: "b1", title: "Vebsayt reklamları", description: "", status: "in_progress", priority: "high", type: "digital_marketing",
  taskKey: "DPHARMA-53", dueDate: null, startDate: null, assignedTo: "s", assignee: { id: "s", name: "Sabina Hasanova" },
  collaborators: [], reporterId: null, reporter: null, creator: { id: "s", name: "Sabina Hasanova" },
  tags: [], estimatedHours: null, recurrenceRule: null, customFields: null,
  checklist: [{ id: "c1", title: "pixel quraşdırılması", completed: false, sortOrder: 0, assignedTo: null, assignee: null, dueDate: null }],
  attachments: [], createdAt: "2025-12-02T10:33:15.785Z",
}

let container: HTMLDivElement
let root: Root
let calls: string[]
let gets: number
/** Answers to writes, released by the test; `null` = the network failed. */
let held: { key: string; release: (res: Response | null) => void }[]
let mutated: number

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data, error: status < 400 ? undefined : "Нет прав на эту задачу" }), { status })

beforeEach(() => {
  calls = []
  gets = 0
  held = []
  mutated = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? init.body : ""
    calls.push(`${method} ${url} ${body}`.trim())
    if (method !== "GET" && !url.includes("/followers") && !url.includes("/time")) {
      return new Promise((resolve, reject) => {
        held.push({ key: `${method} ${url} ${body}`.trim(), release: (res) => (res ? resolve(res) : reject(new TypeError("Failed to fetch"))) })
      })
    }
    if (url === "/api/v1/tasks/t1") { gets += 1; return Promise.resolve(json(TASK)) }
    if (url === "/api/v1/tasks/t1/time") return Promise.resolve(json({ entries: [], totalMinutes: 0, running: null }))
    if (url === "/api/v1/tasks/t1/feed") return Promise.resolve(json({ items: [], followers: [], following: false }))
    if (url === "/api/v1/users/assignable") return Promise.resolve(json(PEOPLE))
    if (url.startsWith("/api/v1/custom-fields")) return Promise.resolve(json([]))
    if (url.startsWith("/api/v1/task-types")) return Promise.resolve(json([{ id: "1", name: "digital_marketing", displayName: "DIGITAL MARKETING", color: "#000", sortOrder: 0, isActive: true }]))
    return Promise.resolve(json({}))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })) })
const release = async (key: string, res: Response | null) => {
  const at = held.findIndex((h) => h.key === key)
  expect(at, `no request held for ${key}`).toBeGreaterThanOrEqual(0)
  const [entry] = held.splice(at, 1)
  await act(async () => { entry.release(res) })
  await flush()
}
const prioritySelect = () => [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "urgent")) as HTMLSelectElement
const tick = () => container.querySelector('[data-testid="task-panel-subtasks"] li button') as HTMLButtonElement

async function open() {
  await act(async () => {
    root.render(createElement(TaskPanel, {
      taskId: "t1", path: "Digital Marketing / Pharmastore", canEdit: true, onClose: () => {}, onMutated: () => { mutated += 1 },
      columns: [{ key: "todo", label: "New task", columnKey: "c_todo" }, { key: "in_progress", label: "In progress", columnKey: "c_ip" }],
    }))
  })
  await flush()
}

describe("the task panel shows an edit before the server answers", () => {
  it("shows the new priority at once and keeps it when the server takes it", async () => {
    await open()
    await choose(prioritySelect(), "urgent")
    expect(prioritySelect().value).toBe("urgent")
    expect(calls).toContain('PATCH /api/v1/tasks/t1 {"priority":"urgent"}')
    const loadsBefore = gets
    await release('PATCH /api/v1/tasks/t1 {"priority":"urgent"}', json({ ...TASK, priority: "urgent" }))
    expect(gets).toBe(loadsBefore + 1)
    expect(mutated).toBe(1)
  })

  it("puts the priority back and says why when the server refuses", async () => {
    await open()
    await choose(prioritySelect(), "urgent")
    expect(prioritySelect().value).toBe("urgent")
    await release('PATCH /api/v1/tasks/t1 {"priority":"urgent"}', json(null, 403))
    expect(prioritySelect().value).toBe("high")
    expect(container.textContent).toContain("Нет прав на эту задачу")
  })

  it("keeps a second edit on its way when the first is refused", async () => {
    await open()
    await choose(prioritySelect(), "urgent")
    const assignee = [...container.querySelectorAll("select")].find((s) => s.value === "s" && [...s.options].some((o) => o.value === "n")) as HTMLSelectElement
    await choose(assignee, "n")
    await release('PATCH /api/v1/tasks/t1 {"priority":"urgent"}', json(null, 403))
    expect(prioritySelect().value).toBe("high")
    expect(assignee.value).toBe("n")
    // Nothing is loaded over the card while the second edit is still out.
    expect(mutated).toBe(0)
  })

  it("does not let a load that left before an edit paint the old value back", async () => {
    await open()
    await choose(prioritySelect(), "urgent")
    const assignee = [...container.querySelectorAll("select")].find((s) => s.value === "s" && [...s.options].some((o) => o.value === "n")) as HTMLSelectElement
    await choose(assignee, "n")
    // The first edit lands; the second is still out, so the card is not loaded yet.
    const loadsBefore = gets
    await release('PATCH /api/v1/tasks/t1 {"priority":"urgent"}', json({ ...TASK, priority: "urgent" }))
    expect(gets).toBe(loadsBefore)
    expect(assignee.value).toBe("n")
    await release('PATCH /api/v1/tasks/t1 {"assignedTo":"n"}', json({ ...TASK, assignedTo: "n" }))
    expect(gets).toBe(loadsBefore + 1)
  })
})

describe("subtasks show a change before the server answers", () => {
  it("ticks at once, and unticks with a message when the server refuses", async () => {
    await open()
    expect(tick().getAttribute("aria-label")).toBe("Закрыть")
    await click(tick())
    expect(tick().getAttribute("aria-label")).toBe("Открыть снова")
    expect(container.textContent).toContain("1/1")
    await release('PATCH /api/v1/tasks/t1/checklist {"id":"c1","completed":true}', json(null, 500))
    expect(tick().getAttribute("aria-label")).toBe("Закрыть")
    expect(container.textContent).toContain("0/1")
    expect(container.querySelector('[data-testid="task-panel-subtasks"] [role=alert]')?.textContent).toBe("Не удалось сохранить.")
  })

  it("unticks the same way when the network fails", async () => {
    await open()
    await click(tick())
    await release('PATCH /api/v1/tasks/t1/checklist {"id":"c1","completed":true}', null)
    expect(tick().getAttribute("aria-label")).toBe("Закрыть")
  })

  it("shows a new subtask at once and removes it if the server refuses", async () => {
    await open()
    const add = container.querySelector('input[placeholder="+ подзадача (Enter)"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(add, "ga4 quraşdırılması")
      add.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    expect(container.textContent).toContain("ga4 quraşdırılması")
    expect(container.textContent).toContain("0/2")
    await release('POST /api/v1/tasks/t1/checklist {"title":"ga4 quraşdırılması"}', json(null, 403))
    expect(container.textContent).not.toContain("ga4 quraşdırılması")
    expect(container.textContent).toContain("0/1")
  })
})
