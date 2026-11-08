// @vitest-environment jsdom
/**
 * The «+ Tapşırıq əlavə et» row makes ONE task per Enter (2026-11-08: every
 * Enter made the task twice on prod — the input is disabled while it saves, a
 * disabled input loses focus, and the blur saved the same title again).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "az", messages: az as never, namespace: namespace as never }),
    useLocale: () => "az",
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
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })

describe("adding a task from the table's first row", () => {
  it("makes one task per Enter, even though the input loses focus while it saves", async () => {
    let release!: () => void
    const onCreate = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    await act(async () => {
      root.render(createElement(InlineTasksTable, {
        tasks: [], selectedIds: new Set<string>(), onToggleSelect: noop, onToggleSelectAll: noop,
        onUpdate: async () => {}, onCreate, onDelete: noop, onEdit: noop, onOpenDetail: noop,
        statusLabels: {}, priorityLabels: {}, customFieldDefs: [], users: [], sortBy: "", onSortChange: noop,
      } as never))
    })
    await flush()
    const row = [...container.querySelectorAll("tr")].find((tr) => tr.textContent?.includes((az.tasks as Messages).inlineAddTask as string))!
    await act(async () => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    const input = container.querySelector("tbody input:not([type=checkbox])") as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { setter.call(input, "Story: endirim kampaniyası"); input.dispatchEvent(new Event("input", { bubbles: true })) })

    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    // What the browser does to the now-disabled input: it loses focus.
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); input.dispatchEvent(new FocusEvent("blur")) })
    await act(async () => { release() })
    await flush()

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith({ title: "Story: endirim kampaniyası", priority: "medium", status: "pending" })
  })
})
