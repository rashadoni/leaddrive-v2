// @vitest-environment jsdom
/**
 * Two things found 2026-11-09 while recording the Boards video guide:
 *  - a board link carrying `?q=` opened in the Siyahı view showed every task
 *    under an empty search box: the list kept a search of its own;
 *  - switching boards showed a bare «Board» title for 4–5 s, although the
 *    sidebar had already read every board's name.
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
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) =>
    createElement("a", { href, ...rest }, children as never),
}))

import { InlineTasksTable } from "@/components/tasks/inline-tasks-table"
import { SidebarBoardTree } from "@/components/sidebar-board-tree"
import { forgetBoardNames, knownBoardName } from "@/lib/tasks/board-names-cache"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  forgetBoardNames()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })

const noop = () => {}
const task = (id: string, title: string) => ({ id, title, status: "todo", priority: "medium" })
const renderTable = async (search: string, onSearchChange: (s: string) => void) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))))
  await act(async () => {
    root.render(createElement(InlineTasksTable, {
      tasks: [task("a", "Kampaniya noyabr"), task("b", "Banner"), task("c", "Yeni kampaniya")],
      selectedIds: new Set<string>(), onToggleSelect: noop, onToggleSelectAll: noop,
      onUpdate: async () => {}, onCreate: async () => {}, onDelete: noop, onEdit: noop, onOpenDetail: noop,
      statusLabels: {}, priorityLabels: {}, customFieldDefs: [], users: [], sortBy: "", onSortChange: noop,
      customGroups: [{ key: "todo", label: "New task" }], groupKeyOf: (x: { status: string }) => x.status,
      search, onSearchChange,
    } as never))
  })
  await flush()
}

describe("the board's list view searches with the board's own search", () => {
  it("shows only what the link's ?q= finds, with the words in the box", async () => {
    await renderTable("kampaniya ", noop)
    const text = container.textContent ?? ""
    expect(text).toContain("Kampaniya noyabr")
    expect(text).toContain("Yeni kampaniya")
    expect(text).not.toContain("Banner")
    expect((container.querySelector('input[placeholder]') as HTMLInputElement).value).toBe("kampaniya ")
  })

  it("typing in the list's box changes the board's search (and so its URL)", async () => {
    const changed: string[] = []
    await renderTable("", (s) => changed.push(s))
    const input = container.querySelector('input[placeholder]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "ban")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(changed).toEqual(["ban"])
  })
})

// The client, 2026-11-13: «дизайн намного красивее в бордио… расстояние между строк, оформление строк, величина шрифтов».
describe("the boards' list in Bordio's make", () => {
  const render = async (look?: "bordio") => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))))
    try { window.localStorage.clear() } catch { /* no storage */ }
    await act(async () => {
      root.render(createElement(InlineTasksTable, {
        tasks: [task("a", "Kampaniya noyabr"), { ...task("b", "Banner"), status: "done" }],
        selectedIds: new Set<string>(), onToggleSelect: noop, onToggleSelectAll: noop,
        onUpdate: async () => {}, onDelete: noop, onEdit: noop, onOpenDetail: noop,
        statusLabels: {}, priorityLabels: {}, customFieldDefs: [], users: [], sortBy: "", onSortChange: noop,
        customGroups: [{ key: "todo", label: "Yeni tapşırıq" }, { key: "done", label: "Tamamlandı" }], groupKeyOf: (x: { status: string }) => x.status,
        search: "", onSearchChange: noop, look,
      } as never))
    })
    await flush()
  }
  const texts = (row: Element) => [...row.children].map((cell) => cell.textContent?.trim() ?? "")

  it("each group's own line carries its name, its count and the column names — status and date first", async () => {
    await render("bordio")
    const heads = [...container.querySelectorAll("tr[data-group-head]")]
    expect(heads).toHaveLength(2)
    const cells = texts(heads[0])
    expect(cells[0]).toBe("Yeni tapşırıq1")
    expect(cells.slice(1, 5)).toEqual(["Статус", "Срок", "Приоритет", "Исполнитель"])
    // The header band is kept for screen readers only, and the table wears the look.
    expect(container.querySelector("thead tr")?.className).toContain("sr-only")
    expect(container.querySelector("table")?.getAttribute("data-look")).toBe("bordio")
    // A row's cells follow the same order.
    const row = container.querySelector("tr[data-row]")!
    expect([...row.querySelectorAll("td[data-col]")].map((td) => td.getAttribute("data-col")).slice(0, 4)).toEqual(["status", "dueDate", "priority", "assignee"])
  })

  it("the CRM's own list keeps its header band and its column order", async () => {
    await render()
    expect(container.querySelector("tr[data-group-head]")).toBeNull()
    expect(container.querySelector("thead tr")?.className).not.toContain("sr-only")
    const row = container.querySelector("tr[data-row]")!
    const order = [...row.querySelectorAll("td[data-col]")].map((td) => td.getAttribute("data-col"))
    expect(order.indexOf("priority")).toBeLessThan(order.indexOf("status"))
  })
})

describe("a board names itself from what the sidebar already read", () => {
  it("knows every board's name once the sidebar tree has loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { divisions: [
      { id: "dig", name: "Digital Marketing", isDepartment: true },
      { id: "dig-zey", name: "Zeytun", parentDivisionId: "dig" },
    ] } }))))
    expect(knownBoardName("dig-zey")).toBeNull()
    await act(async () => { root.render(createElement(SidebarBoardTree, { pathname: "/boards/dig-zey", visible: true })) })
    await flush()
    expect(knownBoardName("dig-zey")).toBe("Zeytun")
    expect(knownBoardName("other-org-board")).toBeNull()
  })
})
