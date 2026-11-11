// @vitest-environment jsdom
/**
 * A folder (a department board: Cust-Serv / 2026 and its twelve month boards)
 * opens as the list of all its tasks, not as the combined kanban (owner,
 * 2026-11-11: «по умолчанию чтоб были показаны не как канбан а как список»).
 * The kanban drew 200 cards of 2065; the list reads every task, and each row
 * names its month board — the rows of twelve boards share one table.
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
vi.mock("@/components/tasks/use-task-types", () => ({
  useTaskTypes: () => ({ types: [], typeMap: new Map() }),
  useEventTypes: () => ({ types: [], typeMap: new Map() }),
}))
vi.mock("@/components/boards/board-project-tabs", () => ({ BoardProjectTabs: () => null }))
vi.mock("@/components/boards/board-reports", () => ({ BoardReports: () => createElement("div", null, "reports") }))
vi.mock("@/components/tasks/task-panel/task-panel", () => ({ TaskPanel: () => null }))

import { DepartmentBoardView } from "@/components/boards/department-board-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const folder = { id: "cs", key: "CUSTSERV26", name: "Cust-Serv / 2026", color: null }
const sections = [
  { id: "jan", key: "MX2601", name: "1. YANVAR 26 MX", color: "#10b981", parentDivisionId: "cs", _count: { tasks: 1200 } },
  { id: "nov", key: "MX2611", name: "11. NOYABR 26 MX", color: "#6366f1", parentDivisionId: "cs", _count: { tasks: 865 } },
]
const board = (id: string) => sections.find((s) => s.id === id)!
// 2065 tasks: January all finished, November with five open ones at the very end.
const all = Array.from({ length: 2065 }, (_, i) => {
  const s = board(i < 1200 ? "jan" : "nov")
  const open = i >= 2060
  return {
    id: `t${i}`, taskKey: `${s.key}-${i}`, title: open ? `74 Nizami ${i}` : `Bağlı ${i}`,
    status: open ? "in_progress" : "done", boardColumnKey: null, priority: "medium", dueDate: null,
    division: { id: s.id, key: s.key, name: s.name, color: s.color }, assignee: null,
  }
})

let container: HTMLDivElement
let root: Root
let asked: string[]
beforeEach(() => {
  asked = []
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    asked.push(input)
    const url = new URL(input, "http://crm.test")
    if (url.pathname === "/api/v1/divisions") return new Response(JSON.stringify({ data: { divisions: [folder, ...sections] } }))
    if (url.pathname === "/api/v1/users/assignable") return new Response(JSON.stringify({ data: [] }))
    if (url.pathname === "/api/v1/tasks") {
      const limit = Number(url.searchParams.get("limit"))
      const offset = Number(url.searchParams.get("offset") ?? 0)
      if (limit > 1000) return new Response(JSON.stringify({ error: "Invalid page or limit" }), { status: 400 })
      return new Response(JSON.stringify({ data: { tasks: all.slice(offset, offset + limit), total: all.length } }))
    }
    return new Response(JSON.stringify({ data: [] }))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)) })

describe("a folder opens as its list", () => {
  it("shows the list tab first and active, every task of every month board, each row naming its board", async () => {
    await act(async () => { root.render(createElement(DepartmentBoardView, { division: folder })) })
    await flush()

    const tabs = [...container.querySelectorAll("[data-crm-tab]")].map((b) => `${b.textContent}:${b.getAttribute("data-state")}`)
    expect(tabs).toEqual(["Siyahı:active", "Lövhə:inactive", "Hesabatlar:inactive"])

    // The open November tasks — past the 200 the kanban drew — are in the table.
    const text = container.textContent ?? ""
    expect(text).toContain("74 Nizami 2064")
    expect(text).not.toMatch(/200 .*göstərilir/u)
    const rowBoards = [...container.querySelectorAll('[data-testid="task-row-board"]')].map((el) => el.textContent)
    expect(rowBoards).toContain("11. NOYABR 26 MX")
    expect(rowBoards).toContain("1. YANVAR 26 MX")
    expect(rowBoards.length).toBe(2065)

    // A folder holds no tasks of its own: no «add task» row.
    expect(text).not.toContain("Tapşırıq əlavə et")
    expect(asked.filter((u) => u.startsWith("/api/v1/tasks?")).every((u) => u.includes("limit=1000"))).toBe(true)
  })

  it("the kanban is one click away", async () => {
    await act(async () => { root.render(createElement(DepartmentBoardView, { division: folder })) })
    await flush()
    const kanban = [...container.querySelectorAll("[data-crm-tab]")].find((b) => b.textContent === "Lövhə") as HTMLButtonElement
    await act(async () => { kanban.click() })
    await flush()
    expect(kanban.getAttribute("data-state")).toBe("active")
    expect(container.querySelector('[data-testid="task-row-board"]')).toBeNull()
  })
})
