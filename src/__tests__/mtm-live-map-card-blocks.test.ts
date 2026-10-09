// @vitest-environment jsdom
/**
 * The blocks of the selected employee's card on the live map (owner,
 * 2026-10-09: «добей до 100 %» of the Navixy tracking screen, whose card is
 * made of blocks a dispatcher folds, reorders and switches off).
 *
 * What is tested is what a person does with the card: fold a block and it asks
 * the server for nothing; move one above another; take one off; come back
 * tomorrow and find it as it was left.
 */
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          let node: unknown = ru
          for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
          const raw = typeof node === "string" ? node : `${namespace}.${key}`
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})

import { LiveMapCardBlocks, type LiveMapCardBlock } from "@/components/mtm/live-map-card-blocks"
import {
  CARD_BLOCKS,
  DEFAULT_CARD_LAYOUT,
  cardBlocksOffered,
  cardBlocksShown,
  moveCardBlock,
  parseCardLayout,
  serializeCardLayout,
  toggleCardBlockCollapsed,
  toggleCardBlockHidden,
  type CardLayout,
} from "@/lib/mtm/live-map-card-layout"

describe("the card's layout, as it is remembered", () => {
  it("a new person sees every block, unfolded, in the card's own order", () => {
    expect(parseCardLayout(null)).toEqual(DEFAULT_CARD_LAYOUT)
    expect(parseCardLayout("{not json")).toEqual(DEFAULT_CARD_LAYOUT)
    expect(DEFAULT_CARD_LAYOUT.order).toEqual([...CARD_BLOCKS])
    expect(cardBlocksShown(DEFAULT_CARD_LAYOUT, ["route", "events"])).toEqual(["events", "route"])
  })

  it("comes back as it was left", () => {
    const left: CardLayout = { order: ["route", "device", "events", "day"], collapsed: ["events"], hidden: ["device"] }
    expect(parseCardLayout(serializeCardLayout(left))).toEqual(left)
  })

  it("whatever else was stored comes back valid: unknown blocks dropped, repeats ignored", () => {
    expect(parseCardLayout({ order: ["route", "nonsense", "route", "events"], collapsed: ["nonsense", "route"], hidden: "all" }))
      .toEqual({ order: ["route", "day", "device", "events"], collapsed: ["route"], hidden: [] })
  })

  it("a block that did not exist when the layout was saved takes its place for a new person, after its nearest placed neighbour", () => {
    // Saved when the card had two blocks, with the route moved above the events.
    const saved = parseCardLayout({ order: ["route", "events"], collapsed: [], hidden: [] })
    // «day» follows «route» in the card's own order, «device» follows «day».
    expect(saved.order).toEqual(["route", "day", "device", "events"])
    // Saved with nothing placed at all: the card's own order.
    expect(parseCardLayout({ order: [] }).order).toEqual([...CARD_BLOCKS])
  })

  it("draws only what this card has something for and the person has not taken off", () => {
    const layout: CardLayout = { order: ["route", "events", "day", "device"], collapsed: [], hidden: ["events"] }
    expect(cardBlocksShown(layout, ["events", "route"])).toEqual(["route"])
    // «Настроить карточку» still offers what was taken off — and not what the card has nothing for.
    expect(cardBlocksOffered(layout, ["events", "route"])).toEqual(["route", "events"])
  })

  it("folds and unfolds, takes off and puts back", () => {
    const folded = toggleCardBlockCollapsed(DEFAULT_CARD_LAYOUT, "route")
    expect(folded.collapsed).toEqual(["route"])
    expect(toggleCardBlockCollapsed(folded, "route").collapsed).toEqual([])
    const hidden = toggleCardBlockHidden(DEFAULT_CARD_LAYOUT, "events")
    expect(hidden.hidden).toEqual(["events"])
    expect(toggleCardBlockHidden(hidden, "events").hidden).toEqual([])
    // Neither touches the order.
    expect([folded.order, hidden.order]).toEqual([DEFAULT_CARD_LAYOUT.order, DEFAULT_CARD_LAYOUT.order])
  })

  it("moves a block one place among the blocks the card offers, stepping over one it has nothing for today", () => {
    // Today the card has no «day» and no «device»: «route» moved up trades with «events».
    const today = ["events", "route"] as const
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "route", "up", today).order).toEqual(["route", "events", "day", "device"])
    // With all four offered, «device» up one place trades with «day», not with «events».
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "device", "up", CARD_BLOCKS).order).toEqual(["events", "route", "device", "day"])
    // «device» up when only events and device are offered: over the two the card does not have.
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "device", "up", ["events", "device"]).order).toEqual(["device", "route", "day", "events"])
    // Nothing above the first, nothing below the last.
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "events", "up", today)).toBe(DEFAULT_CARD_LAYOUT)
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "route", "down", today)).toBe(DEFAULT_CARD_LAYOUT)
    // A block the card does not offer is not moved.
    expect(moveCardBlock(DEFAULT_CARD_LAYOUT, "device", "up", today)).toBe(DEFAULT_CARD_LAYOUT)
  })
})

describe("the card's blocks on screen", () => {
  let root: Root
  let container: HTMLDivElement
  /** Every layout the card handed back to its owner (the page), newest last. */
  const handedBack = vi.fn<(layout: CardLayout) => void>()
  let rendered: string[]

  const byTestId = (testId: string) => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const press = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error("element not found")
    await act(async () => { element.click() })
  }
  const blockIds = () => [...container.querySelectorAll('[data-testid^="live-map-card-block-"]')]
    .map((block) => block.getAttribute("data-testid")!)
    .filter((id) => !id.includes("toggle"))
    .map((id) => id.replace("live-map-card-block-", ""))

  function Harness({ blocks }: { blocks: LiveMapCardBlock[] }) {
    const [layout, setLayout] = useState(DEFAULT_CARD_LAYOUT)
    return createElement(LiveMapCardBlocks, {
      blocks,
      layout,
      onLayoutChange: (next: CardLayout) => { setLayout(next); handedBack(next) },
    })
  }
  const block = (id: LiveMapCardBlock["id"], title: string): LiveMapCardBlock => ({
    id, title, render: () => { rendered.push(id); return createElement("div", { "data-testid": `content-${id}` }, `содержимое: ${title}`) },
  })
  const draw = async (blocks: LiveMapCardBlock[]) => { await act(async () => { root.render(createElement(Harness, { blocks })) }) }
  const TWO = () => [block("events", "События сегодня"), block("route", "Маршрут на сегодня")]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    handedBack.mockClear()
    rendered = []
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("shows each block under its heading, unfolded", async () => {
    await draw(TWO())
    expect(blockIds()).toEqual(["events", "route"])
    expect(byTestId("live-map-card-block-toggle-events")?.textContent).toBe("События сегодня")
    expect(byTestId("live-map-card-block-toggle-events")?.getAttribute("aria-expanded")).toBe("true")
    expect(byTestId("content-events")?.textContent).toBe("содержимое: События сегодня")
  })

  it("a folded block is a heading only — its content is not rendered at all, so it asks the server for nothing", async () => {
    await draw(TWO())
    await press(byTestId("live-map-card-block-toggle-events"))
    expect(handedBack.mock.lastCall?.[0].collapsed).toEqual(["events"])
    expect(byTestId("content-events")).toBeNull()
    expect(byTestId("live-map-card-block-toggle-events")?.getAttribute("aria-expanded")).toBe("false")
    // Drawn again from scratch while folded: its content is never asked for.
    rendered = []
    await draw(TWO())
    expect(rendered).toEqual(["route"])
    await press(byTestId("live-map-card-block-toggle-events"))
    expect(byTestId("content-events")).not.toBeNull()
  })

  it("«Настроить карточку»: move a block above another, take one off, and the button says something is hidden", async () => {
    await draw(TWO())
    const customize = byTestId("live-map-card-customize")!
    expect(customize.textContent).toBe("Настроить карточку")
    await press(customize)
    // The first cannot go higher, the last cannot go lower.
    expect((byTestId("live-map-card-block-up-events") as HTMLButtonElement).disabled).toBe(true)
    expect((byTestId("live-map-card-block-down-route") as HTMLButtonElement).disabled).toBe(true)
    await press(byTestId("live-map-card-block-up-route"))
    expect(blockIds()).toEqual(["route", "events"])
    await press(byTestId("live-map-card-block-shown-events"))
    expect(blockIds()).toEqual(["route"])
    expect(byTestId("live-map-card-customize")?.textContent).toBe("Настроить карточку· скрыто: 1")
    // Still offered, to be put back.
    await press(byTestId("live-map-card-block-shown-events"))
    expect(blockIds()).toEqual(["route", "events"])
  })

  it("offers nothing where the card has nothing", async () => {
    await draw([])
    expect(byTestId("live-map-card-blocks")).toBeNull()
  })
})
