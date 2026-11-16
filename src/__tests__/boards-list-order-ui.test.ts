// @vitest-environment jsdom
/**
 * Ulviyyə, Zeytun, 2026-11-16: «yeni tasklar yenə ortaya düşür… 2 eyni adda
 * task bugün bağlamışam, ortadadı». The board's list showed its finished tasks
 * in the order of their cards on the kanban, so the two closed today sat in
 * the middle of «Выполнено». Now the finished come newest-closed first, as the
 * kanban's own «Done» column has them; open tasks keep their place on the
 * board; the arrows in the header really sort; Bordio's «critical» is a word
 * of the person's language. On the real board page and the real folder list.
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
vi.mock("next/navigation", () => ({
  useParams: () => ({ divisionId: "b1" }),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/boards/b1",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "admin" } }, status: "authenticated" }) }))
vi.mock("@/components/tasks/use-task-types", () => ({
  useTaskTypes: () => ({ types: [], typeMap: new Map() }),
  useEventTypes: () => ({ types: [], typeMap: new Map() }),
}))
vi.mock("@/components/boards/board-project-tabs", () => ({ BoardProjectTabs: () => null }))
vi.mock("@/components/boards/board-reports", () => ({ BoardReports: () => null }))
vi.mock("@/components/tasks/task-panel/task-panel", () => ({ TaskPanel: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) =>
    createElement("a", { href, ...rest }, children as never),
}))

const { default: BoardPage } = await import("@/app/(dashboard)/boards/[divisionId]/page")
const { DepartmentBoardView } = await import("@/components/boards/department-board-view")
const { TooltipProvider } = await import("@/components/ui/tooltip")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const board = {
  id: "b1", key: "AI", name: "Apteklərin idarəsi", color: null, parentDivisionId: null,
  boardColumns: [
    { key: "todo", label: "Новая", sortOrder: 0, mapsToStatus: "todo", color: null },
    { key: "done", label: "Выполнено", sortOrder: 1, mapsToStatus: "done", color: null },
  ],
}
const folder = { id: "f1", key: "CS", name: "Cust-Serv", color: null }
const division = { id: "b1", key: "AI", name: "Apteklərin idarəsi", color: null }

// In the server's order: by place on the kanban. The two closed today stand in the middle.
const row = (id: string, title: string, status: string, boardPosition: number, more: Record<string, unknown> = {}) => ({
  id, taskKey: `AI-${id}`, title, status, boardColumnKey: status, boardPosition, priority: "medium",
  type: null, eventType: null, category: null, dueDate: null, completedAt: null, assignee: null, collaborators: [], division, ...more,
})
const tasks = [
  row("o1", "Banner noyabr", "todo", 0, { dueDate: "2026-11-20T00:00:00.000Z" }),
  row("d1", "355 Sabunçu / Demorton-T", "done", 1, { completedAt: "2026-11-12T10:00:00.000Z" }),
  row("d2", "PHARMASTORE 165/446 / Aptek müdiri", "done", 2, { completedAt: "2026-11-16T09:00:00.000Z", priority: "critical" }),
  row("d3", "69 Suraxanı / Qaimə", "done", 3, { completedAt: "2026-11-13T10:00:00.000Z" }),
  row("d4", "PHARMASTORE 165/446 / Aptek müdir", "done", 4, { completedAt: "2026-11-16T12:30:00.000Z", priority: "critical" }),
  row("o2", "Afişa dekabr", "todo", 5, { dueDate: "2026-11-18T00:00:00.000Z" }),
  row("c1", "Ləğv olunmuş sorğu", "cancelled", 6, { updatedAt: "2026-11-14T10:00:00.000Z" }),
]

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://crm.test")
    if (url.pathname === "/api/v1/divisions") return new Response(JSON.stringify({ data: { divisions: [board, { ...folder }, { ...board, id: "s1", parentDivisionId: "f1" }] } }))
    if (url.pathname === "/api/v1/tasks") return new Response(JSON.stringify({ data: { tasks, total: tasks.length } }))
    return new Response(JSON.stringify({ data: [] }))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)) })

/** The titles in the order the desktop table draws them. */
function drawnOrder(): string[] {
  const frame = container.querySelector('[data-testid="tasks-table-frame"]')!
  const text = frame.textContent ?? ""
  return tasks.map((task) => task.title).sort((a, b) => text.indexOf(a) - text.indexOf(b))
}
function headerButton(label: string): HTMLButtonElement {
  const frame = container.querySelector('[data-testid="tasks-table-frame"]')!
  return [...frame.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
}

describe.each([
  ["the board's list", () => createElement(TooltipProvider, null, createElement(BoardPage))],
  ["the folder's list", () => createElement(DepartmentBoardView, { division: folder })],
])("%s", (_name, page) => {
  it("shows the finished tasks newest-closed first, the open ones as the board has them", async () => {
    await act(async () => { root.render(page()) })
    await flush()
    expect(drawnOrder()).toEqual([
      "Banner noyabr",
      "Afişa dekabr",
      // Выполнено: the two closed today on top, the later of them first.
      "PHARMASTORE 165/446 / Aptek müdir",
      "PHARMASTORE 165/446 / Aptek müdiri",
      "69 Suraxanı / Qaimə",
      "355 Sabunçu / Demorton-T",
      "Ləğv olunmuş sorğu",
    ])
  })

  it("the «Срок» arrow sorts the rows by due date, and Bordio's «critical» reads «Критический»", async () => {
    await act(async () => { root.render(page()) })
    await flush()
    await act(async () => { headerButton("Срок").click() })
    await flush()
    expect(drawnOrder().slice(0, 2)).toEqual(["Afişa dekabr", "Banner noyabr"])
    const text = container.querySelector('[data-testid="tasks-table-frame"]')!.textContent ?? ""
    expect(text).toContain("Критический")
    expect(text).not.toMatch(/\bcritical\b/u)
  })
})
