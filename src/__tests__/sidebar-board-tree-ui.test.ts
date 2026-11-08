// @vitest-environment jsdom
/**
 * The sidebar's «Boards» section lists the folders and their boards (owner,
 * 2026-11-08: «каждый созданный каталог будет там как подраздел»), rendered
 * with the real Russian copy against a fake board list: the open board's
 * folder is unfolded and its board marked, a folder only folds and unfolds
 * (as in Bordio — it opens no page) and stays as left, and while the tree is
 * on screen the tabs above a board step aside — and come back when it is not.
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
  }
})
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) =>
    createElement("a", { href, ...rest }, children as never),
}))

import { SidebarBoardTree } from "@/components/sidebar-board-tree"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIVISIONS = [
  { id: "dig", name: "Digital Marketing", isDepartment: true, sortOrder: 1 },
  { id: "trad", name: "Traditional Marketing", isDepartment: true, sortOrder: 2 },
  { id: "dig-zey", name: "Zeytun", parentDivisionId: "dig", sortOrder: 1, _count: { tasks: 380 } },
  { id: "dig-ph", name: "Pharmastore", parentDivisionId: "dig", sortOrder: 2, _count: { tasks: 732 } },
  { id: "trad-zey", name: "Zeytun", parentDivisionId: "trad", sortOrder: 1, _count: { tasks: 37 } },
  { id: "general", name: "Ümumi", sortOrder: 0, _count: { tasks: 0 } },
]

let container: HTMLDivElement
let root: Root
let reads = 0
beforeEach(() => {
  reads = 0
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/v1/divisions") reads += 1
    return new Response(JSON.stringify({ success: true, data: { divisions: DIVISIONS } }))
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })
const render = async (pathname: string, visible = true) => {
  await act(async () => { root.render(createElement(SidebarBoardTree, { pathname, visible })) })
  await flush()
}
const links = () => [...container.querySelectorAll('[data-testid="sidebar-board-link"]')].map((a) => [
  a.getAttribute("href"), a.textContent, a.getAttribute("aria-current") ?? "",
])

describe("the boards in the sidebar", () => {
  it("lists the folders, unfolds the open board's folder and marks the board", async () => {
    await render("/boards/dig-ph")
    expect(links()).toEqual([
      ["/boards/general", "Ümumi0", ""],
      ["/boards/dig-zey", "Zeytun380", ""],
      ["/boards/dig-ph", "Pharmastore732", "page"],
    ])
    expect([...container.querySelectorAll('[data-testid="sidebar-board-folder-toggle"]')].map((b) => [b.textContent, b.getAttribute("aria-expanded")]))
      .toEqual([["Digital Marketing", "true"], ["Traditional Marketing", "false"]])
    expect(document.documentElement.dataset.boardTree).toBe("on")
  })

  it("a folder folds and unfolds and opens nothing; what was left open stays open", async () => {
    await render("/boards/dig-ph")
    const arrow = (name: string) => container.querySelector(`button[aria-label="Открыть «${name}»"], button[aria-label="Свернуть «${name}»"]`)!
    await act(async () => { arrow("Traditional Marketing").dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(links().map(([href]) => href)).toContain("/boards/trad-zey")
    expect(JSON.parse(localStorage.getItem("board-nav-open-folders") ?? "[]")).toEqual(expect.arrayContaining(["dig", "trad"]))

    await act(async () => { arrow("Digital Marketing").dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(links().map(([href]) => href)).not.toContain("/boards/dig-ph")
    expect(container.querySelector('a[href="/boards/dig"], a[href="/boards/trad"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem("board-nav-open-folders") ?? "[]")).toEqual(["trad"])
  })

  it("does not read the list again on every click between boards", async () => {
    await render("/boards/dig-ph")
    await render("/boards/dig-zey")
    await render("/boards/trad")
    expect(reads).toBe(1)
  })

  it("draws nothing and gives the tabs back while folded away", async () => {
    await render("/boards/dig-ph", false)
    expect(container.querySelector('[data-testid="sidebar-board-tree"]')).toBeNull()
    expect(document.documentElement.dataset.boardTree).toBeUndefined()

    await render("/boards/dig-ph", true)
    expect(document.documentElement.dataset.boardTree).toBe("on")
    await render("/boards/dig-ph", false)
    expect(document.documentElement.dataset.boardTree).toBeUndefined()
  })

  it("the tabs above a board are the ones that step aside", () => {
    const css = readFileSync("src/app/globals.css", "utf8")
    expect(css).toMatch(/html\[data-board-tree="on"\] \[data-board-tabs\] \{\s*display: none !important;/u)
    const tabs = readFileSync("src/components/boards/board-project-tabs.tsx", "utf8")
    expect(tabs.match(/data-board-tabs=""/gu)).toHaveLength(2)
  })
})
