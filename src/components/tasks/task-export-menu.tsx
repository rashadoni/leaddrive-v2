"use client"

import { useEffect, useRef, useState } from "react"
import { Download, ChevronDown, FileSpreadsheet, FileText } from "lucide-react"

/**
 * Reusable "Export" control for the task list / board. Opens GET
 * /api/v1/tasks/export (which enforces the SAME visibility as the task list) in
 * a new tab, carrying the caller's current filters as query params + the chosen
 * format. Empty / false params are dropped so the export URL stays clean.
 */
export function TaskExportMenu({
  params,
  label = "Export",
  align = "right",
}: {
  params: Record<string, string | number | boolean | null | undefined>
  label?: string
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  const download = (format: "xlsx" | "csv") => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "" || v === false) continue
      qs.set(k, String(v))
    }
    qs.set("format", format)
    window.open(`/api/v1/tasks/export?${qs.toString()}`, "_blank")
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        <Download className="h-4 w-4" /> {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 mt-1 w-44 overflow-hidden rounded-md border bg-popover shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => download("xlsx")}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-muted"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => download("csv")}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-muted"
          >
            <FileText className="h-4 w-4 text-sky-600" /> CSV
          </button>
        </div>
      )}
    </div>
  )
}
