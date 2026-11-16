// @vitest-environment jsdom
/**
 * The inbox's bulk actions on real React with the Russian copy (2026-11-16): the card of the
 * selected conversations and the window «Закрыть» opens.
 *
 * Two defects of the look started this file, both found on a screenshot of the real page:
 *  - the bulk-close window nested its header and footer INSIDE `DialogContent`, which also carried
 *    a width of its own. The app's `Dialog` is the panel; the three are its sections. Nested, a
 *    448 px card stood in a 640 px panel with an empty column on the right, the title and the
 *    buttons on white slabs in the grey. The hand-over window of «Обучение ИИ» was built the same;
 *  - «assign» and «folder» shared a row of the card: 134 px each in a 320 px list column, where
 *    «Выберите ответственного» needs 196 and read «Выберите отве…».
 *
 * jsdom lays nothing out, so what is pinned here is what made the look: where the sections stand,
 * and that every action of the card is a row of its own. What the windows DO is pinned beside it —
 * the rebuild was not allowed to change it. The widths themselves were measured in Chromium with
 * the app's compiled CSS (PR description).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const translate = (namespace: string) => actual.createTranslator({
    locale: "ru", messages: ru as never, namespace: (namespace || undefined) as never, onError: () => {},
  })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)!
    },
    useLocale: () => "ru",
  }
})

import { BulkCloseDialog } from "@/components/inbox/bulk-close-dialog"
import { InboxBulkBar } from "@/components/inbox/inbox-bulk-bar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
})

const words = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
async function press(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
}
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setValue = Object.getOwnPropertyDescriptor(proto, "value")!.set!
  await act(async () => {
    setValue.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function choose(select: HTMLSelectElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("the bulk-close window", () => {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  beforeEach(() => { onOpenChange.mockReset(); onConfirm.mockReset() })

  async function open(props: { busy?: boolean; allowNoResult?: boolean } = {}) {
    await act(async () => {
      root.render(createElement(BulkCloseDialog, {
        open: true, selectedCount: 2, busy: props.busy ?? false, allowNoResult: props.allowNoResult, onOpenChange, onConfirm,
      }))
    })
  }
  const panel = () => container.querySelector<HTMLElement>('[role="dialog"]')!
  const button = (label: string) => [...panel().querySelectorAll("button")].find((b) => words(b) === label)!
  const outcomes = () => [...panel().querySelectorAll<HTMLButtonElement>("button[aria-pressed]")]

  it("is one panel: the header, the content and the footer are its own three sections", async () => {
    await open()
    const header = panel().querySelector("[data-crm-dialog-header]")!
    const content = panel().querySelector("[data-crm-dialog-content]")!
    const footer = panel().querySelector("[data-crm-dialog-footer]")!
    expect(header.parentElement).toBe(panel())
    expect(content.parentElement).toBe(panel())
    expect(footer.parentElement).toBe(panel())
    // Top to bottom, as they are read.
    const sections = [...panel().children].filter((el) => [header, content, footer].includes(el))
    expect(sections).toEqual([header, content, footer])
    // The width is the panel's; the content takes what the panel gives it.
    expect(panel().className).toContain("max-w-md")
    expect(panel().className).not.toContain("max-w-[40rem]")
    expect(content.className).not.toMatch(/max-w-/)
  })

  it("opens on «В ожидании»: asks when to come back, and sends no farewell", async () => {
    await open()
    expect(words(panel().querySelector("h2"))).toBe("Перевести 2 диалога в ожидание")
    expect(outcomes().map((b) => [words(b), b.getAttribute("aria-pressed")])).toEqual([
      ["Продано", "false"], ["Не продано", "false"], ["В ожидании", "true"],
    ])
    expect(panel().querySelector("textarea")).toBeNull()

    await press(button("Оставить в ожидании"))
    expect(onConfirm).toHaveBeenLastCalledWith("", "pending", undefined)

    await type(panel().querySelector<HTMLInputElement>('input[type="datetime-local"]')!, "2026-11-20T10:30")
    await press(button("Оставить в ожидании"))
    expect(onConfirm).toHaveBeenLastCalledWith("", "pending", "2026-11-20T10:30")
  })

  it("closes with an outcome and an optional farewell, trimmed", async () => {
    await open()
    await press(outcomes().find((b) => words(b) === "Продано")!)
    expect(words(panel().querySelector("h2"))).toBe("Закрыть 2 диалога")
    expect(panel().querySelector('input[type="datetime-local"]')).toBeNull()

    // The confirm button — the corner × carries the same word as its accessible name, not as text.
    await press(button("Закрыть"))
    expect(onConfirm).toHaveBeenLastCalledWith("", "won", undefined)

    await type(panel().querySelector("textarea")!, "  Спасибо за покупку!  ")
    await press(outcomes().find((b) => words(b) === "Не продано")!)
    await press(button("Закрыть"))
    expect(onConfirm).toHaveBeenLastCalledWith("Спасибо за покупку!", "lost", undefined)
  })

  it("offers «Без исхода» only where the page allows it", async () => {
    await open()
    expect(outcomes().map(words)).not.toContain("Без исхода")
    await open({ allowNoResult: true })
    expect(outcomes().map(words)).toEqual(["Продано", "Не продано", "В ожидании", "Без исхода"])
    await press(outcomes().find((b) => words(b) === "Без исхода")!)
    await press(button("Закрыть"))
    expect(onConfirm).toHaveBeenLastCalledWith("", "none", undefined)
  })

  it("while the request runs nothing can be pressed and the window does not close", async () => {
    await open({ busy: true })
    expect(outcomes().every((b) => b.disabled)).toBe(true)
    expect(panel().querySelector<HTMLInputElement>('input[type="datetime-local"]')!.disabled).toBe(true)
    expect(button("Отмена").hasAttribute("disabled")).toBe(true)
    expect(button("Оставить в ожидании").hasAttribute("disabled")).toBe(true)

    // The corner × and Escape belong to the shared Dialog: the window swallows them while busy.
    await press(panel().querySelector('button[aria-label="Закрыть"]')!)
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })) })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("closes on «Отмена», × and Escape when nothing runs", async () => {
    await open()
    await press(button("Отмена"))
    await press(panel().querySelector('button[aria-label="Закрыть"]')!)
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })) })
    expect(onOpenChange.mock.calls).toEqual([[false], [false], [false]])
  })
})

describe("the card of the selected conversations", () => {
  const handlers = { onClearSelection: vi.fn(), onOpenClose: vi.fn(), onAssign: vi.fn(), onFolder: vi.fn(), onTags: vi.fn() }
  beforeEach(() => { for (const fn of Object.values(handlers)) fn.mockReset() })

  async function show(busy = false) {
    await act(async () => {
      root.render(createElement(InboxBulkBar, {
        selectedCount: 2, busy,
        agents: [{ id: "u-aysel", name: "Aysel" }, { id: "u-nameless", name: null }],
        folders: [{ id: "f-vip", name: "VIP" }],
        ...handlers,
      }))
    })
  }
  const card = () => container.querySelector<HTMLElement>('[role="region"]')!
  const assign = () => card().querySelector<HTMLSelectElement>('select[aria-label="Назначить"]')!
  const folder = () => card().querySelector<HTMLSelectElement>('select[aria-label="В папку"]')!
  const tags = () => card().querySelector<HTMLInputElement>("input")!
  /** The card's own child an element stands in — its row. */
  const rowOf = (el: Element) => { let node = el; while (node.parentElement !== card()) node = node.parentElement!; return node }

  it("gives every action a row of its own, so the labels are read whole", async () => {
    await show()
    const close = [...card().querySelectorAll("button")].find((b) => words(b) === "Закрыть")!
    const rows = [close, assign(), folder(), tags()].map(rowOf)
    // Four actions — four different rows, in this order, after the count.
    expect(new Set(rows).size).toBe(4)
    expect([...card().children].slice(1)).toEqual(rows)
    // What the list says before anybody is chosen — the wording was not shortened to fit.
    expect(words(assign().options[0])).toBe("Выберите ответственного")
  })

  it("assigns, unassigns, files and tags — and does nothing on the placeholder", async () => {
    await show()
    expect([...assign().options].map(words)).toEqual(["Выберите ответственного", "Снять назначение", "Aysel", "u-nameless"])
    await choose(assign(), "")
    expect(handlers.onAssign).not.toHaveBeenCalled()
    await choose(assign(), "u-aysel")
    expect(handlers.onAssign).toHaveBeenLastCalledWith("u-aysel")
    await choose(assign(), "__unassign__")
    expect(handlers.onAssign).toHaveBeenLastCalledWith(null)

    expect([...folder().options].map(words)).toEqual(["В папку", "Без папки", "VIP"])
    await choose(folder(), "f-vip")
    expect(handlers.onFolder).toHaveBeenLastCalledWith("f-vip")
    await choose(folder(), "__unfile__")
    expect(handlers.onFolder).toHaveBeenLastCalledWith(null)

    await type(tags(), " срочно, vip ,, ")
    await act(async () => { tags().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) })
    expect(handlers.onTags).toHaveBeenLastCalledWith(["срочно", "vip"])
    expect(tags().value).toBe("")

    await press([...card().querySelectorAll("button")].find((b) => words(b) === "Закрыть")!)
    expect(handlers.onOpenClose).toHaveBeenCalledTimes(1)
    await press(card().querySelector('button[aria-label="Снять выделение"]')!)
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1)
  })

  it("is not shown with nothing selected", async () => {
    await act(async () => {
      root.render(createElement(InboxBulkBar, { selectedCount: 0, busy: false, agents: [], folders: [], ...handlers }))
    })
    expect(container.querySelector('[role="region"]')).toBeNull()
  })
})

/**
 * The same mistake in any other window of the inbox. A source check, because the defect IS the
 * source's shape: `DialogHeader` or `DialogFooter` opened while a `DialogContent` is still open.
 * The rest of the CRM has such windows too (listed in the PR that added this file); they are not
 * this file's to fail on.
 */
describe("the inbox's windows keep header, content and footer side by side", () => {
  const INBOX_SOURCES = ["src/components/inbox", "src/components/inbox-learning", "src/app/(dashboard)/inbox"]

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return tsxFiles(path)
      return name.endsWith(".tsx") ? [path] : []
    })
  }
  /** Lines where a header or a footer is opened inside a still-open `DialogContent`. */
  function nestedSections(source: string): string[] {
    const found: string[] = []
    let depth = 0
    for (const tag of source.matchAll(/<(\/?)(DialogContent|DialogHeader|DialogFooter)\b/g)) {
      const [, closing, name] = tag
      if (name === "DialogContent") depth = Math.max(0, depth + (closing ? -1 : 1))
      else if (!closing && depth > 0) found.push(`${name} at line ${source.slice(0, tag.index).split("\n").length}`)
    }
    return found
  }

  it("the check itself tells the two shapes apart", () => {
    expect(nestedSections("<Dialog><DialogContent><DialogHeader/></DialogContent></Dialog>")).toEqual(["DialogHeader at line 1"])
    expect(nestedSections("<Dialog>\n<DialogContent>\n<p/>\n<DialogFooter>\n</DialogFooter>\n</DialogContent></Dialog>")).toEqual(["DialogFooter at line 4"])
    expect(nestedSections("<Dialog><DialogHeader/><DialogContent><p/></DialogContent><DialogFooter/></Dialog>")).toEqual([])
  })

  it("no window of the inbox nests them", () => {
    const windows = INBOX_SOURCES.flatMap(tsxFiles).filter((path) => /from "@\/components\/ui\/dialog"/.test(readFileSync(path, "utf8")))
    // The three this file was written for are among the ones looked at.
    expect(windows).toEqual(expect.arrayContaining([
      "src/components/inbox/bulk-close-dialog.tsx",
      "src/components/inbox-learning/ai-training-screen.tsx",
    ]))
    const nested = windows.flatMap((path) => nestedSections(readFileSync(path, "utf8")).map((hit) => `${path}: ${hit}`))
    expect(nested).toEqual([])
  })
})
