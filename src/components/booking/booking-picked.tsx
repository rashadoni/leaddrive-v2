"use client"

/**
 * «Everything», or the few that were picked — never the whole list as chips.
 *
 * Twenty-seven names in three rows is a wall: it tells nobody which of them a
 * setting actually covers, because the answer was always «all of them». The
 * owner said so twice — about the WhatsApp rules on 2026-11-10 («не красиво,
 * дилетантно… никто не скролит»), and about the wall-screen panel on
 * 2026-11-11, where the same wall had been drawn again. It lives here so the
 * two screens cannot drift apart a third time.
 */
import { useState } from "react"
import { X } from "lucide-react"
import { SearchableSelect } from "@/components/ui/searchable-select"

/**
 * «Everything», or the few that were picked — never the whole staff list as
 * chips. Twenty-seven names in three rows is the wall the day view already
 * learned not to draw (booking-day-timeline), and it taught nobody which of
 * them the agent may book: the answer was always «all of them».
 */
export function Picked({ items, chosen, allLabel, addLabel, searchLabel, emptyLabel, pickLabel, resetLabel, onToggle, onReset }: {
  items: { id: string; name: string }[]
  chosen: string[] | null
  allLabel: string
  addLabel: string
  searchLabel: string
  emptyLabel: string
  pickLabel: string
  resetLabel: string
  onToggle: (id: string) => void
  onReset: () => void
}) {
  const [picking, setPicking] = useState(false)
  const ids = chosen ?? items.map((item) => item.id)
  const everything = chosen === null || ids.length === items.length
  if (everything && !picking) {
    return <>
      <span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-xs font-semibold">{allLabel}</span>
      <button type="button" className="text-xs font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setPicking(true)}>{pickLabel}</button>
    </>
  }
  const rest = items.filter((item) => !ids.includes(item.id))
  return <>
    {items.filter((item) => ids.includes(item.id)).map((item) => <button
      key={item.id}
      type="button"
      onClick={() => onToggle(item.id)}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/15"
    >{item.name}<X className="h-3 w-3" aria-hidden="true" /></button>)}
    {rest.length ? <div className="w-56 max-w-full">
      <SearchableSelect
        value=""
        onValueChange={(id) => { if (id) onToggle(id) }}
        options={rest.map((item) => ({ value: item.id, label: item.name }))}
        placeholder={addLabel}
        searchPlaceholder={searchLabel}
        noResultsLabel={emptyLabel}
      />
    </div> : null}
    <button type="button" className="text-xs font-semibold text-primary underline-offset-4 hover:underline" onClick={() => { setPicking(false); onReset() }}>{resetLabel}</button>
  </>
}
