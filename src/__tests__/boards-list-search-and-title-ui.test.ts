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
