// @vitest-environment jsdom
/**
 * The task table while its tasks are still on the way, and when there are
 * none (owner, 2026-11-08). A board opened from the sidebar showed «0 nəticə»,
 * empty «New task 0 / In progress 0 / Completed 0» groups and the raw key
 * «tasks.noTasks» for a moment before its 93 tasks arrived: the table did not
 * know the page was still loading, and the key it asked for did not exist.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
vi.mock("@/components/tasks/use-task-types", () => ({ useTaskTypes: () => ({ types: [] }), useEventTypes: () => ({ types: [] }) }))

import { InlineTasksTable } from "@/components/tasks/inline-tasks-table"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const noop = () => {}
const render = async (loading: boolean) => {
  await act(async () => {
    root.render(createElement(InlineTasksTable, {
      tasks: [], loading, selectedIds: new Set<string>(), onToggleSelect: noop, onToggleSelectAll: noop,
      onUpdate: async () => {}, onCreate: async () => {}, onDelete: noop, onEdit: noop, onOpenDetail: noop,
      statusLabels: {}, priorityLabels: {}, customFieldDefs: [], users: [], sortBy: "", onSortChange: noop,
      customGroups: [{ key: "todo", label: "New task" }, { key: "in_progress", label: "In progress" }, { key: "done", label: "Completed" }],
      groupKeyOf: (task: { status: string }) => task.status,
    } as never))
  })
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
}

describe("task table while its tasks load", () => {
  it("says it is loading — no «0 results», no empty groups", async () => {
    await render(true)
    const text = container.textContent ?? ""
    expect(container.querySelectorAll('[data-testid="tasks-table-loading"]').length).toBeGreaterThan(0)
    expect(text).toContain("Загрузка...")
    expect(text).not.toMatch(/0 результатов/u)
    expect(text).not.toContain("New task")
    expect(text).not.toContain("Нет задач")
  })

  it("an empty board says so in words, not with a translation key", async () => {
    await render(false)
    const text = container.textContent ?? ""
    expect(container.querySelector('[data-testid="tasks-table-loading"]')).toBeNull()
    expect(text).toContain("0 результатов")
    expect(text).toContain("Нет задач")
    expect(text).not.toContain("tasks.noTasks")
  })
})
