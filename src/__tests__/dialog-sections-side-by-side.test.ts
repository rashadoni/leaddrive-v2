// @vitest-environment jsdom
/**
 * A window is one panel: its header, its content and its footer stand side by side (2026-11-16).
 *
 * The app's `Dialog` (`src/components/ui/dialog.tsx`) IS the panel — its width is `widthClassName`,
 * its height `maxHeightClassName` — and `DialogHeader`, `DialogContent`, `DialogFooter` are its three
 * sections. The shadcn habit, where `DialogContent` is the panel and the other two live inside it,
 * compiles and renders here too, and looks wrong: the title and the buttons sit on white slabs in the
 * grey of the content, and a content with a width of its own is a narrow card in a wide panel with an
 * empty column on its right.
 *
 * PR #1660 rebuilt the inbox's three such windows and counted 61 more in 35 files of the rest of the
 * CRM — contracts, invoices, treasury, settings, the report builder, social monitoring, the tenant
 * admin, MTM, deals, quotes, events, sequences, the agent sandbox. They were rebuilt with this file,
 * and this file is why the shape does not come back: no window under `src/components` or `src/app`
 * may open a header or a footer inside a still-open `DialogContent`. There is no list of exceptions.
 *
 * The check reads the source, because the defect IS the source's shape; what the shape gives on the
 * screen was looked at in Chromium with the app's compiled CSS, before and after (PR description).
 * Two real windows are rendered beside it, so that «side by side» is also seen in the DOM.
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

import { SendOfferDialog } from "@/components/deals/send-offer-dialog"
import { EnrollInSequenceDialog } from "@/components/sequences/enroll-in-sequence-dialog"

const SOURCES = ["src/components", "src/app"]

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
  for (const tag of source.matchAll(/<(\/?)(DialogContent|DialogHeader|DialogFooter)\b(\s*\/>)?/g)) {
    const [, closing, name, selfClosed] = tag
    if (name === "DialogContent") {
      // `<DialogContent />` opens nothing.
      if (!selfClosed) depth = Math.max(0, depth + (closing ? -1 : 1))
    } else if (!closing && depth > 0) {
      found.push(`${name} at line ${source.slice(0, tag.index).split("\n").length}`)
    }
  }
  return found
}

describe("the check tells the two shapes apart", () => {
  it("finds a header or a footer inside the content", () => {
    expect(nestedSections("<Dialog><DialogContent><DialogHeader/></DialogContent></Dialog>")).toEqual(["DialogHeader at line 1"])
    expect(nestedSections("<Dialog>\n<DialogContent>\n<p/>\n<DialogFooter>\n</DialogFooter>\n</DialogContent></Dialog>")).toEqual(["DialogFooter at line 4"])
    // Through a form, a fragment or a condition — still inside.
    expect(nestedSections("<Dialog><DialogContent><form>\n<DialogHeader/>\n<DialogFooter/></form></DialogContent></Dialog>"))
      .toEqual(["DialogHeader at line 2", "DialogFooter at line 3"])
    expect(nestedSections("<Dialog><DialogContent>{open && (<>\n<DialogHeader/></>)}</DialogContent></Dialog>")).toEqual(["DialogHeader at line 2"])
    // The second window of a file is read on its own.
    expect(nestedSections("<Dialog><DialogHeader/><DialogContent/></Dialog>\n<Dialog><DialogContent className=\"max-w-md\">\n<DialogHeader/></DialogContent></Dialog>"))
      .toEqual(["DialogHeader at line 3"])
  })

  it("passes the three sections side by side", () => {
    expect(nestedSections("<Dialog><DialogHeader/><DialogContent><p/></DialogContent><DialogFooter/></Dialog>")).toEqual([])
    // A form is the panel's child and holds the three.
    expect(nestedSections("<Dialog><form><DialogHeader/><DialogContent><p/></DialogContent><DialogFooter/></form></Dialog>")).toEqual([])
    expect(nestedSections("<Dialog>{pending && (<><DialogHeader/><DialogContent><p/></DialogContent><DialogFooter/></>)}</Dialog>")).toEqual([])
    // A window with a title and buttons only.
    expect(nestedSections("<Dialog><DialogHeader/><DialogFooter/></Dialog>")).toEqual([])
    expect(nestedSections("<Dialog><DialogHeader/><DialogContent />\n<DialogFooter/></Dialog>")).toEqual([])
  })
})

describe("no window of the CRM nests its header or its footer in its content", () => {
  const windows = SOURCES.flatMap(tsxFiles).filter((path) => /<DialogContent\b/.test(readFileSync(path, "utf8")))

  it("looks at the windows it was written for", () => {
    // A scan that finds nothing passes too: these were rebuilt on 2026-11-16 and must stay among the read.
    expect(windows.length).toBeGreaterThan(100)
    expect(windows).toEqual(expect.arrayContaining([
      "src/components/inbox/bulk-close-dialog.tsx",
      "src/components/finance/payments-dashboard.tsx",
      "src/components/mtm/contact-dictionary-assignment-panel.tsx",
      "src/components/deals/send-offer-dialog.tsx",
      "src/app/(dashboard)/contracts/[id]/page.tsx",
      "src/app/(dashboard)/invoices/[id]/page.tsx",
      "src/app/(dashboard)/settings/channels/page.tsx",
      "src/app/(dashboard)/settings/snippets/page.tsx",
      "src/app/(dashboard)/social-monitoring/page.tsx",
      "src/app/admin/tenants/[id]/tenant-actions.tsx",
    ]))
  })

  it("header, content and footer are side by side in every one of them", () => {
    const nested = windows.flatMap((path) => nestedSections(readFileSync(path, "utf8")).map((hit) => `${path}: ${hit}`))
    expect(nested).toEqual([])
  })
})

describe("on the screen: the sections are the panel's own", () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true, data: [{ id: "s-1", name: "Новый лид — 5 касаний", isActive: true, steps: [{ id: "st-1" }] }],
    }), { headers: { "content-type": "application/json" } })))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const panel = () => container.querySelector<HTMLElement>('[role="dialog"]')!
  const section = (name: "header" | "content" | "footer") => panel().querySelector<HTMLElement>(`[data-crm-dialog-${name}]`)

  it("a narrow window is a narrow panel, not a narrow card in the standard one", async () => {
    await act(async () => {
      root.render(createElement(SendOfferDialog, {
        open: true, onClose: () => {}, onSent: () => {}, orgId: "org-1", defaultEmail: "client@example.com",
        offer: { id: "o-1", offerNumber: "OFF-2026-014", title: "Внедрение CRM", total: 12000, currency: "AZN", clientName: "Zeytun Pharma" } as never,
      }))
    })
    expect(section("header")!.parentElement).toBe(panel())
    expect(section("content")!.parentElement).toBe(panel())
    expect(section("content")!.querySelector("[data-crm-dialog-header], [data-crm-dialog-footer]")).toBeNull()
    // The width is the panel's; the content takes what the panel gives it.
    expect(panel().className).toContain("max-w-lg")
    expect(panel().className).not.toContain("max-w-[40rem]")
    expect(section("content")!.className).not.toMatch(/max-w-/)
    // What the window says and offers is what it did.
    expect(panel().querySelector("h2")!.textContent).toBe("Отправить предложение — OFF-2026-014")
    expect(panel().querySelector<HTMLInputElement>('input[type="email"]')!.value).toBe("client@example.com")
    expect([...section("content")!.querySelectorAll("button")].map((b) => b.textContent!.trim())).toEqual(["Отмена", "Отправить"])
  })

  it("header, content and footer go top to bottom, each the panel's child", async () => {
    await act(async () => {
      root.render(createElement(EnrollInSequenceDialog, { open: true, onClose: () => {}, entityType: "lead", entityIds: ["l-1"], entityName: "Лейла Алиева" }))
    })
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
    const sections = [section("header")!, section("content")!, section("footer")!]
    for (const el of sections) expect(el.parentElement).toBe(panel())
    expect([...panel().children].filter((el) => sections.includes(el as HTMLElement))).toEqual(sections)
    // The list is in the content section and scrolls with it; it has no frame of its own any more.
    expect(section("content")!.textContent).toContain("Новый лид — 5 касаний")
    expect(section("content")!.querySelector('[class*="max-h-"]')).toBeNull()
    expect(section("footer")!.textContent!.trim()).toBe("Отмена")
  })
})
