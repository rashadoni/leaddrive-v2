// @vitest-environment jsdom
/**
 * Zeytun, 2026-11-23: «göndərdiyin linklərin heç biri məndə açılmır, ümumi bura
 * atır». The card opens over the board and the address stayed the board's, so a
 * link copied from the browser led to the board, with the sender's filter on it.
 * On the real board page and the real folder view; only the card itself, the
 * network and the session are stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as { common: { open: string }; board: { noAccessTitle: string } } & Messages
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) => actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => "ru",
  }
})
vi.mock("next/navigation", () => ({
  useParams: () => ({ divisionId: "b1" }),
  useRouter: () => nav,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "admin" } }, status: "authenticated" }) }))
vi.mock("@/components/tasks/use-task-types", () => ({
  useTaskTypes: () => ({ types: [], typeMap: new Map() }),
  useEventTypes: () => ({ types: [], typeMap: new Map() }),
}))
vi.mock("@/components/boards/board-project-tabs", () => ({ BoardProjectTabs: () => null }))
vi.mock("@/components/boards/board-reports", () => ({ BoardReports: () => null }))
vi.mock("@/components/tasks/task-panel/task-panel", () => ({
  TaskPanel: ({ taskId, onClose }: { taskId: string; onClose: () => void }) =>
    createElement("button", { type: "button", "data-testid": "card", "data-task": taskId, onClick: onClose }, "card"),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) =>
    createElement("a", { href, ...rest }, children as never),
}))

const { default: BoardPage } = await import("@/app/(dashboard)/boards/[divisionId]/page")
const { DepartmentBoardView } = await import("@/components/boards/department-board-view")
const { TooltipProvider } = await import("@/components/ui/tooltip")
const { taskLink } = await import("@/lib/tasks/task-in-address")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const board = {
  id: "b1", key: "PS", name: "Pharmastore", color: null, parentDivisionId: null,
  boardColumns: [{ key: "todo", label: "Новая", sortOrder: 0, mapsToStatus: "todo", color: null }],
}
const me = { id: "u1", name: "Xəyalə", avatar: null }
const row = {
  id: "t-mine", taskKey: "PS-1", title: "Noyabr endirimləri", status: "todo", boardColumnKey: "todo", boardPosition: 0, priority: "medium",
  type: null, eventType: null, category: null, dueDate: null, completedAt: null, assignee: me, collaborators: [],
  division: { id: "b1", key: "PS", name: "Pharmastore", color: null },
}
let boards: unknown[] = [board]
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  boards = [board]
  nav.replace.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://crm.test")
    if (url.pathname === "/api/v1/divisions") return new Response(JSON.stringify({ data: { divisions: boards } }))
    if (url.pathname === "/api/v1/tasks") return new Response(JSON.stringify({ data: { tasks: [row], total: 1 } }))
    return new Response(JSON.stringify({ data: [] }))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)) })
// Past the 300 ms after which the board writes its filters to the address.
const pastFilterSync = () => act(async () => { await new Promise((r) => setTimeout(r, 380)) })
const card = () => container.querySelector('[data-testid="card"]') as HTMLButtonElement | null
const openBoard = async (address: string) => {
  window.history.replaceState(null, "", address)
  await act(async () => { root.render(createElement(TooltipProvider, null, createElement(BoardPage))) })
  await flush()
}

describe("a task's link", () => {
  it("opens that task's card on the board, and the board leaves the address alone", async () => {
    await openBoard("/boards/b1?task=t-sent")
    expect(card()?.dataset.task).toBe("t-sent")
    await pastFilterSync()
    expect(card()?.dataset.task).toBe("t-sent")
    expect(window.location.search).toBe("?task=t-sent")
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("is what the browser shows while a card is open — without the sender's filter — and closing brings the filter back", async () => {
    await openBoard("/boards/b1?mine=1")
    const open = container.querySelector(`[data-testid="tasks-table-frame"] button[title="${ru.common.open}"]`) as HTMLButtonElement
    await act(async () => { open.click() })
    await flush()
    expect(card()?.dataset.task).toBe("t-mine")
    expect(`${window.location.pathname}${window.location.search}`).toBe("/boards/b1?task=t-mine")

    await act(async () => { card()!.click() })
    await flush()
    await pastFilterSync()
    expect(card()).toBeNull()
    expect(window.location.search).toBe("?mine=1")
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("for someone who is not on the board goes to «Mənim işlərim», where their own task opens", async () => {
    boards = []
    await openBoard("/boards/b1?task=t-sent")
    expect(nav.replace).toHaveBeenCalledWith("/boards/mine?task=t-sent")
    expect(container.textContent).not.toContain(ru.board.noAccessTitle)
  })

  it("opens the card in a folder's view too, and closing clears it from the address", async () => {
    window.history.replaceState(null, "", "/boards/f1?task=t-folder")
    await act(async () => {
      root.render(createElement(DepartmentBoardView, { division: { id: "f1", key: "DM", name: "Digital Marketing", color: null } }))
    })
    await flush()
    expect(card()?.dataset.task).toBe("t-folder")
    await act(async () => { card()!.click() })
    await flush()
    expect(card()).toBeNull()
    expect(window.location.search).toBe("")
  })

  it("is written with the page the person is on", () => {
    expect(taskLink("https://zeytun.leaddrivecrm.org", "/boards/b1", "t 1")).toBe("https://zeytun.leaddrivecrm.org/boards/b1?task=t%201")
  })
})
