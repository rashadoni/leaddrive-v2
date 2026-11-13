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

  // Owner, 2026-11-13: «таблицы грубее сравнительно с бордио и как будто обычная тетрадь в линию».
  // Measured on the live board: lines three times louder than Bordio's, the name squeezed to 143px,
  // a frame around the list, and «name +2» where Bordio shows the faces.
  it("the list has no frame, one quiet line colour, and the task's name keeps its room", async () => {
    await render("bordio")
    const frame = container.querySelector('[data-testid="tasks-table-frame"]')!
    expect(frame.className).not.toMatch(/rounded-xl|bg-card|\bborder\b/)
    const table = container.querySelector("table")!
    // One variable drives every line; the dark theme dims it instead of each rule naming a colour.
    // Both themes are dimmed: Zeytun works on the light one, and the first cut dimmed only the dark.
    expect(table.className).toContain("[--ld-line:hsl(var(--border)/0.55)]")
    expect(table.className).toContain("dark:[--ld-line:hsl(var(--border)/0.45)]")
    expect(table.className).not.toContain("[--ld-line:hsl(var(--border))]")
    // No column of row buttons: it made the list 75px wider than the page (measured on the live board).
    expect(table.className).toContain("[&_[data-actions]]:hidden")
    expect(container.querySelectorAll("tr[data-group-head] td[data-actions]")).toHaveLength(2)
    expect(container.querySelectorAll("tr[data-row] td[data-actions]")).toHaveLength(2)
    expect(table.className).toContain("[&_tr]:border-[color:var(--ld-line)]")
    expect(table.className).not.toContain("border-border")
    expect(table.className).toContain("[&_tr[data-row]]:h-[49px]")
    expect(container.querySelectorAll("tr[data-row] td[data-title]")).toHaveLength(2)
    expect(table.className).toContain("[&_td[data-title]]:min-w-[260px]")
  })

  it("several people on a task are their faces in a row; one person keeps the name", async () => {
    const people = [{ id: "u1", name: "Sabina Hasanova" }, { id: "u2", name: "Gullu Alekberova" }, { id: "u3", name: "Khayala Khankishiyeva" }]
    const many = { ...task("m", "Banner"), assignedTo: "u1", assignee: people[0], collaborators: people.slice(1) }
    const crowd = { ...task("x", "Stories"), assignedTo: "u1", assignee: people[0], collaborators: [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, name: `Əməkdaş ${n}` })) }
    const one = { ...task("o", "Reels"), assignedTo: "u1", assignee: people[0], collaborators: [] }
    const renderPeople = async (look?: "bordio") => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))))
      await act(async () => {
        root.render(createElement(InlineTasksTable, {
          tasks: [many, crowd, one],
          selectedIds: new Set<string>(), onToggleSelect: noop, onToggleSelectAll: noop,
          onUpdate: async () => {}, onDelete: noop, onEdit: noop, onOpenDetail: noop,
          statusLabels: {}, priorityLabels: {}, customFieldDefs: [], users: people, sortBy: "", onSortChange: noop,
          customGroups: [{ key: "todo", label: "Yeni tapşırıq" }], groupKeyOf: (x: { status: string }) => x.status,
          search: "", onSearchChange: noop, look,
        } as never))
      })
      await flush()
    }
    await renderPeople("bordio")
    const cells = [...container.querySelectorAll('tr[data-row] td[data-col="assignee"]')]
    expect(cells).toHaveLength(3)
    // Three people: three faces, the primary first, no name beside them, the names on hover.
    const faces = cells[0].querySelector('[data-testid="assignee-faces"]')!
    expect([...faces.children].map((f) => f.textContent)).toEqual(["SH", "GA", "KK"])
    expect(cells[0].textContent).toBe("SHGAKK")
    // A face is a filled circle — it has to cover the one under it and be seen on a light page.
    expect((faces.children[1] as HTMLElement).className).toContain("bg-zinc-200")
    // Two letters fit only if the next face covers 3px, not 6: at 6 «GA» read as «G» on the live board.
    expect((faces.children[1] as HTMLElement).className).toContain("-ml-[3px]")
    expect((faces.children[0] as HTMLElement).className).not.toContain("-ml-")
    // A face sizes itself; the look's rule for single avatars (11px letters) does not reach it.
    expect(faces.querySelector("[data-avatar]")).toBeNull()
    expect(cells[0].querySelector("[data-assignee-trigger]")?.getAttribute("title")).toBe("Sabina Hasanova, Gullu Alekberova, Khayala Khankishiyeva")
    // Six people: four faces and how many more.
    expect([...cells[1].querySelector('[data-testid="assignee-faces"]')!.children].map((f) => f.textContent)).toEqual(["SH", "Ə1", "Ə2", "Ə3", "+2"])
    // One person: the face and the name, as before.
    expect(cells[2].querySelector('[data-testid="assignee-faces"]')).toBeNull()
    expect(cells[2].textContent).toBe("SSabina Hasanova")

    // The CRM's own list is untouched: a name and «+N».
    act(() => root.unmount())
    root = createRoot(container)
    await renderPeople()
    const own = container.querySelector('tr[data-row] td[data-col="assignee"]')!
    expect(own.querySelector('[data-testid="assignee-faces"]')).toBeNull()
    expect(own.textContent).toBe("SSabina Hasanova+2")
    expect(container.querySelector('[data-testid="tasks-table-frame"]')!.className).toContain("rounded-xl")
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
