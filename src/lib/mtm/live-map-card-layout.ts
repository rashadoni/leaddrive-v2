/**
 * How the selected employee's card on the live map is laid out: which blocks
 * it shows, in what order, and which are folded.
 *
 * Owner, 2026-10-09, of the Navixy demo: «бери почти всё, чего у нас нет» —
 * and then «добей до 100 %». Their card is made of blocks a dispatcher folds,
 * reorders and switches off; one who only ever looks at the route does not
 * scroll past the events to reach it. The choice is remembered in the browser,
 * like the list's layout.
 *
 * Pure: no React, no storage. The page reads and writes the string.
 */

/** Every block the card can have, in the order a new person sees them. */
export const CARD_BLOCKS = ["events", "route", "day", "device"] as const
export type CardBlockId = typeof CARD_BLOCKS[number]

export interface CardLayout {
  /** Every known block, in the person's order. */
  order: CardBlockId[]
  /** Blocks shown as a heading only. */
  collapsed: CardBlockId[]
  /** Blocks taken off the card altogether. */
  hidden: CardBlockId[]
}

export const CARD_LAYOUT_STORAGE_KEY = "leaddrive.mtm.live-map.card.v1"
export const DEFAULT_CARD_LAYOUT: CardLayout = { order: [...CARD_BLOCKS], collapsed: [], hidden: [] }

function isBlock(value: unknown): value is CardBlockId {
  return (CARD_BLOCKS as readonly unknown[]).includes(value)
}

function unique(values: readonly CardBlockId[]): CardBlockId[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

/**
 * Whatever was stored — by an older build, by hand — comes back as a valid
 * layout. A block that did not exist when the layout was saved was never moved
 * or hidden by anybody: it takes the place it has for a new person, after the
 * nearest block before it that the person did place.
 */
export function parseCardLayout(raw: unknown): CardLayout {
  let input: unknown = raw
  if (typeof raw === "string") {
    try { input = JSON.parse(raw) } catch { input = null }
  }
  const record = input != null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const list = (value: unknown) => unique(Array.isArray(value) ? value.filter(isBlock) : [])
  const order = list(record.order)
  for (const block of CARD_BLOCKS) {
    if (order.includes(block)) continue
    const before = CARD_BLOCKS.slice(0, CARD_BLOCKS.indexOf(block)).reverse().find((earlier) => order.includes(earlier))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, block)
  }
  return { order, collapsed: list(record.collapsed), hidden: list(record.hidden) }
}

export function serializeCardLayout(layout: CardLayout): string {
  return JSON.stringify({ order: layout.order, collapsed: layout.collapsed, hidden: layout.hidden })
}

/** The blocks to draw for this card, in order: the ones it has something for and the person has not hidden. */
export function cardBlocksShown(layout: CardLayout, available: readonly CardBlockId[]): CardBlockId[] {
  return layout.order.filter((block) => available.includes(block) && !layout.hidden.includes(block))
}

/** The same with the hidden ones — what «Настроить карточку» lists. */
export function cardBlocksOffered(layout: CardLayout, available: readonly CardBlockId[]): CardBlockId[] {
  return layout.order.filter((block) => available.includes(block))
}

function toggled(values: readonly CardBlockId[], block: CardBlockId): CardBlockId[] {
  return values.includes(block) ? values.filter((value) => value !== block) : [...values, block]
}

export function toggleCardBlockCollapsed(layout: CardLayout, block: CardBlockId): CardLayout {
  return { ...layout, collapsed: toggled(layout.collapsed, block) }
}

export function toggleCardBlockHidden(layout: CardLayout, block: CardBlockId): CardLayout {
  return { ...layout, hidden: toggled(layout.hidden, block) }
}

/**
 * Move a block one place up or down among the blocks this card offers. A
 * block the card has nothing for today (no device facts, say) keeps its place
 * in the remembered order: the move steps over it instead of trading with it.
 */
export function moveCardBlock(
  layout: CardLayout,
  block: CardBlockId,
  direction: "up" | "down",
  available: readonly CardBlockId[],
): CardLayout {
  const offered = cardBlocksOffered(layout, available)
  const from = offered.indexOf(block)
  const to = direction === "up" ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= offered.length) return layout
  const other = offered[to]
  const order = [...layout.order]
  const a = order.indexOf(block)
  const b = order.indexOf(other)
  order[a] = other
  order[b] = block
  return { ...layout, order }
}
