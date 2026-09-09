"use client"
import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export interface CatalogProduct {
  id: string
  name: string
  sku: string | null
  productType: string
  price: number
  currency: string
}

interface ProductComboboxProps {
  /** Current free-text product name (controlled). */
  value: string
  /** Fired on every keystroke (ad-hoc typing). */
  onNameChange: (name: string) => void
  /** Fired when a catalog product is picked. */
  onSelect: (p: CatalogProduct) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Free-text input + filtered catalog dropdown. Typing = ad-hoc line;
 *  picking an item = catalog line (parent autofills sku/type/price). */
export function ProductCombobox({ value, onNameChange, onSelect, disabled, placeholder, className }: ProductComboboxProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  // Debounced server-side search: keys on value (which is the typed text) and open.
  // When closed or empty, search="" returns the first active products so the user
  // sees options immediately on open. The seq-guard drops responses that arrive
  // out of order (e.g. "s" response arrives after "se" has already resolved).
  useEffect(() => {
    const q = (open ? value : "").trim()
    const seq = ++seqRef.current
    const handle = setTimeout(() => {
      fetch(`/api/v1/products?active=1&search=${encodeURIComponent(q)}&limit=20`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((j: { data?: CatalogProduct[] }) => {
          if (seq !== seqRef.current) return // stale — a newer query superseded this response
          setProducts(Array.isArray(j.data) ? j.data : [])
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(handle) // cancel pending debounce on each keystroke/unmount
  }, [value, open])

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
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onNameChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && !disabled && products.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {products.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onSelect(p); setOpen(false) }}
              >
                <span className="truncate">{p.name}</span>
                {p.sku && <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
