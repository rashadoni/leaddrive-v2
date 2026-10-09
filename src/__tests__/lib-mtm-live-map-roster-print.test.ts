// @vitest-environment jsdom
/**
 * «Печать» of the live map's list (owner, 2026-10-09, of the fleet tracker
 * shown to him as the model: «бери почти всё, чего у нас нет» — its list has
 * a print button beside the Excel one).
 *
 * Two things are held here. The sheet is a document made of what people typed
 * — names, teams — and none of it may become markup or reach for the network.
 * And the print is started by the page from a frame nobody sees: the frame's
 * own document cannot run a script under the application's content policy.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { printRosterHtml, rosterPrintHtml } from "@/lib/mtm/live-map-roster-print"
import type { RosterExportTable } from "@/lib/mtm/live-map-roster-export"

const table: RosterExportTable = {
  headers: ["Сотрудник", "Статус", "Сигнал"],
  rows: [
    ["Северов Тимур", "В пути", "14:20 · Свежий"],
    ["Южная Лала", "У клиента · с 13:05", "14:21 · Свежий"],
  ],
}
const sheet = (input: Partial<Parameters<typeof rosterPrintHtml>[0]> = {}) =>
  rosterPrintHtml({ lang: "ru", title: "Живая карта · 9 окт. 2026 г., 14:21", subtitle: "2 из 40", table, ...input })
const read = (html: string) => new DOMParser().parseFromString(html, "text/html")
const wide = (columns: number): RosterExportTable => ({
  headers: Array.from({ length: columns }, (_, index) => `Колонка ${index + 1}`),
  rows: [Array.from({ length: columns }, (_, index) => `значение ${index + 1}`)],
})

describe("the list as a sheet to print", () => {
  it("carries the heading, the line that says what part of the team it is, and the rows in the order given", () => {
    const page = read(sheet())
    expect(page.documentElement.lang).toBe("ru")
    // The document carries the title itself, not only the heading on the sheet.
    expect(page.title).toBe("Живая карта · 9 окт. 2026 г., 14:21")
    expect(page.querySelector("h1")?.textContent).toBe("Живая карта · 9 окт. 2026 г., 14:21")
    expect(page.querySelector("p")?.textContent).toBe("2 из 40")
    expect([...page.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)))
      .toEqual(table.rows)
  })

  it("has one heading cell for every column, and as many cells in every row", () => {
    const page = read(sheet())
    expect([...page.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(table.headers)
    for (const row of page.querySelectorAll("tbody tr")) expect(row.querySelectorAll("td")).toHaveLength(table.headers.length)

    const eleven = read(sheet({ table: wide(11) }))
    expect(eleven.querySelectorAll("thead th")).toHaveLength(11)
    expect(eleven.querySelectorAll("tbody td")).toHaveLength(11)
  })

  it("prints a name typed as markup as the characters that were typed", () => {
    const typed = `<b>&"'</b><img src=x onerror=alert(1)>`
    const html = sheet({ table: { headers: [typed, "Статус"], rows: [[typed, "В пути"]] }, title: typed, subtitle: typed })
    expect(html).toContain("&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;")
    expect(html).not.toContain("<b>")
    expect(html).not.toContain("<img")

    const page = read(html)
    expect(page.querySelectorAll("b, img")).toHaveLength(0)
    expect(page.title).toBe(typed)
    expect(page.querySelector("h1")?.textContent).toBe(typed)
    expect(page.querySelector("p")?.textContent).toBe(typed)
    expect(page.querySelector("thead th")?.textContent).toBe(typed)
    expect(page.querySelector("tbody td")?.textContent).toBe(typed)
  })

  it("cannot be closed early by a title or a language that tries to", () => {
    const page = read(sheet({ title: "</title></head><script>alert(1)</script>", lang: 'ru"><script>alert(2)</script>' }))
    expect(page.querySelectorAll("script")).toHaveLength(0)
    expect(page.title).toBe("</title></head><script>alert(1)</script>")
    expect(page.documentElement.lang).toBe('ru"><script>alert(2)</script>')
  })

  it("runs no script and asks the network for nothing", () => {
    const html = sheet()
    expect(html.toLowerCase()).not.toContain("<script")
    const page = read(html)
    expect(page.querySelectorAll("script, link, img, iframe, object, embed, video, audio, a[href], base, form")).toHaveLength(0)
    expect(page.querySelectorAll("style")).toHaveLength(1)
    const css = page.querySelector("style")?.textContent ?? ""
    expect(css).not.toMatch(/url\(|@import|@font-face|https?:/i)
    // No handler written on a tag either: the policy would block it, and the sheet must not depend on it.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it("sets the sheet up for paper: A4, the heading row on every page, no person's row split in two", () => {
    const css = read(sheet()).querySelector("style")?.textContent ?? ""
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4 portrait[^}]*margin:\s*12mm/)
    expect(css).toMatch(/thead\s*\{[^}]*display:\s*table-header-group/)
    expect(css).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/)
    // A long name wraps inside its cell instead of pushing the table off the sheet…
    expect(css).toMatch(/(^|\n)td\s*\{[^}]*overflow-wrap:\s*anywhere/)
    // …but a heading is not cut in the middle of a word: seen in print as «Приложе|ние», «Маршр|ут».
    expect(css).not.toMatch(/th[^{}]*\{[^}]*overflow-wrap/)
  })

  it("turns the sheet on its side for a list too wide to read upright", () => {
    const orientation = (columns: number) =>
      /@page\s*\{[^}]*size:\s*A4 (\w+)/.exec(read(sheet({ table: wide(columns) })).querySelector("style")?.textContent ?? "")?.[1]
    expect([3, 6].map(orientation)).toEqual(["portrait", "portrait"])
    expect([7, 11].map(orientation)).toEqual(["landscape", "landscape"])
  })

  it("prints no empty line when there is nothing to say under the heading, and a table with headings alone for an empty list", () => {
    const page = read(sheet({ subtitle: "  ", table: { headers: table.headers, rows: [] } }))
    expect(page.querySelector("p")).toBeNull()
    expect(page.querySelectorAll("thead th")).toHaveLength(3)
    expect(page.querySelectorAll("tbody tr")).toHaveLength(0)
  })
})

describe("sending the sheet to the printer without leaving the map", () => {
  const frames = () => [...document.querySelectorAll("iframe")] as HTMLIFrameElement[]
  /**
   * jsdom has no printer and moves no focus between windows: the frame's
   * print() and focus() are replaced, and the frame's own load is waited for.
   */
  const whenLoaded = async (frame: HTMLIFrameElement, does: { focus?: () => void; print?: () => void } = {}) => {
    const print = vi.fn(does.print)
    const view = frame.contentWindow as unknown as { print: () => void; focus: () => void }
    view.print = print
    view.focus = does.focus ?? (() => {})
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }))
    return print
  }

  afterEach(() => {
    for (const frame of frames()) frame.remove()
  })

  it("puts the sheet into one frame nobody sees or tabs into, and leaves the page itself as it was", () => {
    const before = document.body.innerHTML
    const html = sheet()
    printRosterHtml(html)

    expect(frames()).toHaveLength(1)
    const [frame] = frames()
    expect(frame.srcdoc).toBe(html)
    expect(frame.getAttribute("aria-hidden")).toBe("true")
    expect(frame.tabIndex).toBe(-1)
    expect(frame.style.width).toBe("0px")
    expect(frame.style.height).toBe("0px")
    // Hidden by size, not by display:none (an empty sheet in some browsers); a sandbox would forbid print().
    expect(frame.style.display).toBe("")
    expect(frame.hasAttribute("sandbox")).toBe(false)
    // The sheet is the frame's own content: no address is fetched for it.
    expect(frame.hasAttribute("src")).toBe(false)
    frame.remove()
    expect(document.body.innerHTML).toBe(before)
  })

  it("asks the browser to print the frame, once, when the sheet has loaded", async () => {
    printRosterHtml(sheet())
    const [frame] = frames()
    const loaded = whenLoaded(frame)
    const pagePrint = vi.spyOn(window, "print").mockImplementation(() => {})
    const print = await loaded
    expect(print).toHaveBeenCalledTimes(1)
    // A load that comes again (the frame navigated, a browser quirk) does not open a second dialog.
    frame.dispatchEvent(new Event("load"))
    expect(print).toHaveBeenCalledTimes(1)
    // The frame is printed, never the page around it: that would be the sidebar and one screen of rows.
    expect(pagePrint).not.toHaveBeenCalled()
    pagePrint.mockRestore()
  })

  it("takes the frame away when the print dialog closes", async () => {
    printRosterHtml(sheet())
    const [frame] = frames()
    await whenLoaded(frame)
    expect(frames()).toHaveLength(1)
    frame.contentWindow?.dispatchEvent(new Event("afterprint"))
    expect(frames()).toHaveLength(0)
  })

  it("gives the frame the focus for the dialog, and the keyboard back to the button that was pressed when it closes", async () => {
    const button = document.createElement("button")
    document.body.appendChild(button)
    button.focus()
    try {
      printRosterHtml(sheet())
      const [frame] = frames()
      const order: string[] = []
      // A browser that focuses the frame takes the focus off the button; so does this stand-in.
      await whenLoaded(frame, {
        focus: () => { order.push("focus"); button.blur() },
        print: () => { order.push("print") },
      })
      expect(order).toEqual(["focus", "print"])
      expect(document.activeElement).not.toBe(button)

      frame.contentWindow?.dispatchEvent(new Event("afterprint"))
      // Not left on a frame that is gone, to be found again with Tab from the top of the page.
      expect(document.activeElement).toBe(button)
    } finally {
      button.remove()
    }
  })

  it("replaces the frame of a print that was never finished instead of piling up another", async () => {
    printRosterHtml(sheet({ subtitle: "2 из 40" }))
    const [first] = frames()
    const firstPrint = vi.fn()
    ;(first.contentWindow as unknown as { print: () => void }).print = firstPrint
    const second = sheet({ subtitle: "1 из 40" })
    printRosterHtml(second)

    expect(frames()).toHaveLength(1)
    expect(frames()[0]).not.toBe(first)
    expect(frames()[0].srcdoc).toBe(second)
    const print = await whenLoaded(frames()[0])
    expect(print).toHaveBeenCalledTimes(1)
    // The sheet that was replaced is out of the page and never reaches the printer.
    expect(first.isConnected).toBe(false)
    expect(firstPrint).not.toHaveBeenCalled()
  })
})
