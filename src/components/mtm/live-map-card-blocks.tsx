"use client"

import { type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  cardBlocksOffered,
  cardBlocksShown,
  moveCardBlock,
  toggleCardBlockCollapsed,
  toggleCardBlockHidden,
  type CardBlockId,
  type CardLayout,
} from "@/lib/mtm/live-map-card-layout"

export interface LiveMapCardBlock {
  id: CardBlockId
  title: string
  /** Called only while the block is unfolded: a folded block asks the server for nothing. */
  render: () => ReactNode
}

/**
 * The blocks of the selected employee's card — his events, his route, his day
 * in numbers, his device — each under a heading that folds it, in the order
 * the dispatcher chose, with «Настроить карточку» to reorder them or take one
 * off. What a card has nothing for is simply not offered.
 */
export function LiveMapCardBlocks({ blocks, layout, onLayoutChange }: {
  blocks: LiveMapCardBlock[]
  layout: CardLayout
  onLayoutChange: (layout: CardLayout) => void
}) {
  const tMap = useTranslations("mtmMap")
  const available = blocks.map((block) => block.id)
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const shown = cardBlocksShown(layout, available)
  const offered = cardBlocksOffered(layout, available)
  if (offered.length === 0) return null

  return (
    <div className="space-y-2" data-testid="live-map-card-blocks">
      {shown.map((id) => {
        const block = byId.get(id)
        if (!block) return null
        const folded = layout.collapsed.includes(id)
        const Chevron = folded ? ChevronRight : ChevronDown
        return (
          <section key={id} className="rounded-md bg-background/80 p-2" data-testid={`live-map-card-block-${id}`} data-folded={folded ? "true" : "false"}>
            <button
              type="button"
              aria-expanded={!folded}
              onClick={() => onLayoutChange(toggleCardBlockCollapsed(layout, id))}
              data-testid={`live-map-card-block-toggle-${id}`}
              className="flex min-h-8 w-full items-center gap-1 rounded text-left font-semibold text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">{block.title}</span>
            </button>
            {folded ? null : <div className="mt-1">{block.render()}</div>}
          </section>
        )
      })}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="live-map-card-customize"
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-300 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11"
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />{tMap("card.customize")}
            {shown.length < offered.length ? <span className="tabular-nums text-muted-foreground">· {tMap("card.hiddenCount", { count: offered.length - shown.length })}</span> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={8} aria-label={tMap("card.customize")} className="max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-2" data-testid="live-map-card-customize-menu">
          <p className="px-1 pb-1 text-[11px] text-muted-foreground">{tMap("card.customizeHint")}</p>
          <ul className="space-y-0.5">
            {offered.map((id, index) => {
              const block = byId.get(id)
              if (!block) return null
              const visible = !layout.hidden.includes(id)
              return (
                <li key={id} className="flex items-center gap-1 rounded px-1 hover:bg-muted/60">
                  <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm [@media(pointer:coarse)]:min-h-11">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => onLayoutChange(toggleCardBlockHidden(layout, id))}
                      data-testid={`live-map-card-block-shown-${id}`}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                    />
                    <span className={cn("min-w-0 flex-1 truncate", !visible && "text-muted-foreground")}>{block.title}</span>
                  </label>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onLayoutChange(moveCardBlock(layout, id, "up", available))}
                    aria-label={tMap("card.moveUp", { name: block.title })}
                    title={tMap("card.moveUp", { name: block.title })}
                    data-testid={`live-map-card-block-up-${id}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-200 hover:bg-muted disabled:opacity-40 dark:border-zinc-700 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={index === offered.length - 1}
                    onClick={() => onLayoutChange(moveCardBlock(layout, id, "down", available))}
                    aria-label={tMap("card.moveDown", { name: block.title })}
                    title={tMap("card.moveDown", { name: block.title })}
                    data-testid={`live-map-card-block-down-${id}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-200 hover:bg-muted disabled:opacity-40 dark:border-zinc-700 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
