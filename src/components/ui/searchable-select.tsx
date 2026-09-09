"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Input } from "@/components/ui/input"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SearchableOption {
  value: string
  label: string
}

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SearchableOption[]
  /** Label shown when nothing is selected; also the clear/none row at the top of the list. */
  placeholder?: string
  /** Placeholder inside the type-to-filter input. */
  searchPlaceholder?: string
  /** Text shown when the filter matches nothing. */
  noResultsLabel?: string
  disabled?: boolean
  id?: string
}

interface Rect {
  top: number
  left: number
  width: number
}

/**
 * Searchable single-select combobox for long entity lists (company/contact/deal).
 * Client-side filters `options` by label as the user types.
 *
 * The dropdown is rendered through a portal to <body> with fixed positioning
 * derived from the trigger's bounding rect — this sidesteps the overflow-hidden
 * clipping that a plain absolute dropdown suffers inside a scrollable Dialog
 * (the contract form's Dialog wraps the form in overflow-hidden). Position is
 * recomputed on open and on scroll/resize while open so it tracks the trigger.
 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  noResultsLabel,
  disabled,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [rect, setRect] = useState<Rect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  function measure() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom, left: r.left, width: r.width })
  }

  function toggle() {
    if (!open) measure() // measure synchronously before the portal paints (no flicker)
    setOpen((o) => !o)
  }

  // Re-track the trigger while open (dialog scroll, window resize).
  useEffect(() => {
    if (!open) return
    function replace() {
      measure()
    }
    window.addEventListener("scroll", replace, true)
    window.addEventListener("resize", replace)
    return () => {
      window.removeEventListener("scroll", replace, true)
      window.removeEventListener("resize", replace)
    }
  }, [open])

  // Close on click outside BOTH the trigger and the (portaled) dropdown.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const selected = options.find((o) => o.value === value)
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  function pick(v: string) {
    onValueChange(v)
    setOpen(false)
    setQuery("")
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : (placeholder ?? "—")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && rect && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: rect.top + 4, left: rect.left, width: rect.width }}
            className="z-[70] rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            <div className="p-2 border-b">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8"
              />
            </div>
            <div className="max-h-60 overflow-auto p-1">
              {placeholder !== undefined && (
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={cn(
                    // bg-muted (not bg-accent): the theme's accent is a saturated
                    // lavender — as a persistent selected state it screams and the
                    // muted text on it is unreadable. Match the quiet native-select
                    // look: subtle row highlight + checkmark.
                    "flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted text-left",
                    value === "" && "bg-muted",
                  )}
                >
                  {placeholder}
                </button>
              )}
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground text-center">
                  {noResultsLabel ?? "—"}
                </div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left",
                      o.value === value && "bg-muted font-medium",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
