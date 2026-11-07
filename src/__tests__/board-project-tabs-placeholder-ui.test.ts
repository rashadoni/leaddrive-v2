// @vitest-environment jsdom
/**
 * The tabs above a board hold their place while the board list loads.
 *
 * Measured on prod 2026-11-07 (Zeytun, board «Zeytun», 380 tasks): the tabs
 * arrived 3.4 s after the table had been drawn and pushed the board 112 px
 * down — CLS 0.136 of the page's 0.137. Now a grey stand-in of the same box is
 * there from the first frame and the real tabs replace it in place.
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
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}))

import { BoardProjectTabs } from "@/components/boards/board-project-tabs"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIVISIONS = [
  { id: "dep", name: "Digital Marketing", isDepartment: true, sortOrder: 0 },
  { id: "dep2", name: "Traditional Marketing", isDepartment: true, sortOrder: 1 },
  { id: "zey", name: "Zeytun", parentDivisionId: "dep", sortOrder: 0, _count: { tasks: 380 } },
  { id: "pha", name: "Pharmastore", parentDivisionId: "dep", sortOrder: 1, _count: { tasks: 732 } },
]

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const placeholder = () => container.querySelector('[data-testid="board-project-tabs-placeholder"]')
const tabs = () => container.querySelector('[data-testid="board-project-tabs"]')
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() })

describe("tabs above a board", () => {
  it("hold their place while the page reads the board list, then show in the same box", () => {
    act(() => root.render(createElement(BoardProjectTabs, { currentId: "zey", divisions: [], loading: true })))
    expect(placeholder()).not.toBeNull()
    expect(tabs()).toBeNull()
    // Same outer box as the real tabs: two rows, gap and bottom padding.
    expect(placeholder()!.className).toBe("flex flex-col gap-3 px-5 pb-3")

    act(() => root.render(createElement(BoardProjectTabs, { currentId: "zey", divisions: DIVISIONS, loading: false })))
    expect(placeholder()).toBeNull()
    expect(tabs()!.className).toBe("flex flex-col gap-3 px-5 pb-3")
    expect([...tabs()!.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "Digital Marketing", "Traditional Marketing", "Все", "Zeytun380", "Pharmastore732",
    ])
  })

  it("read the list themselves when given none, holding the place until it comes", async () => {
    let answer: (value: Response) => void = () => {}
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve })))
    act(() => root.render(createElement(BoardProjectTabs, { currentId: "dep" })))
    expect(placeholder()).not.toBeNull()
    answer(new Response(JSON.stringify({ data: { divisions: DIVISIONS } })))
    await flush()
    expect(placeholder()).toBeNull()
    expect(tabs()).not.toBeNull()
  })

  it("give the place back when the list cannot be read or there is one board only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    act(() => root.render(createElement(BoardProjectTabs, { currentId: "dep" })))
    await flush()
    expect(placeholder()).toBeNull()
    expect(tabs()).toBeNull()

    act(() => root.render(createElement(BoardProjectTabs, { currentId: "solo", divisions: [{ id: "solo", name: "Solo" }] })))
    expect(placeholder()).toBeNull()
    expect(tabs()).toBeNull()
  })
})
