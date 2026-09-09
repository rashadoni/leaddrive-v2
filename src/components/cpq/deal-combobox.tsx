"use client"
import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export interface DealOption {
  id: string
  name: string
  company: { name: string } | null
}

interface DealComboboxProps {
  /** Display label of the currently-selected deal ("" when none). */
  value: string
  /** Fired when a deal is picked. */
  onSelect: (deal: DealOption) => void
  /** Fired to clear the selection (user empties the field). */
  onClear: () => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function DealCombobox({ value, onSelect, onClear, disabled, placeholder, className }: DealComboboxProps) {
  const [deals, setDeals] = useState<DealOption[]>([])
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  // Debounced server-side search: fires on every query/open change.
  // When closed or no query typed, search="" returns recent rows so the user
  // sees options immediately on open. The seq-guard drops responses that arrive
  // out of order (e.g. "a" response arrives after "ac" has already resolved).
  useEffect(() => {
    const q = (open ? query : "").trim()
    const seq = ++seqRef.current
    const handle = setTimeout(() => {
      fetch(`/api/v1/deals?search=${encodeURIComponent(q)}&limit=20`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: { deals?: DealOption[] } } | null) => {
          if (seq !== seqRef.current) return // stale — a newer query superseded this response
          const arr = j?.data?.deals ?? []
          setDeals(Array.isArray(arr) ? arr : [])
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(handle) // cancel pending debounce on each keystroke/unmount
  }, [query, open])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <Input
        value={open ? query : value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (e.target.value === "") onClear() }}
        onFocus={() => { setQuery(value); setOpen(true) }}
      />
      {open && !disabled && deals.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {deals.slice(0, 8).map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onSelect(d); setQuery(""); setOpen(false) }}
              >
                <span className="truncate">{d.company?.name ?? d.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{d.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
