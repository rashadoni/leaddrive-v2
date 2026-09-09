"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react"

// A column being edited (no sortOrder — array order is it). `key` is absent for a
// not-yet-saved column (the server generates it on PUT /divisions/[id]/columns).
export interface EditCol { key?: string; label: string; mapsToStatus: string; color: string | null }

// Standard board stages (canonical order). A board's columns are a subset / rename
// of these; mapsToStatus is always one of these 6 keys (status stays load-bearing).
export const COLUMN_STAGES: { key: string; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "testing", label: "Testing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
]

// Default accent per stage for the color-dot preview when a column has no color.
const DEFAULT_STAGE_ACCENT: Record<string, string> = {
  backlog: "#C1C7D0", todo: "#C1C7D0", in_progress: "#EA580C",
  testing: "#6554C0", review: "#00B8D9", done: "#00875A",
}

const SWATCHES = ["#EA580C", "#00875A", "#6554C0", "#00B8D9", "#FF8B00", "#DE350B", "#172B4D"]

/**
 * Controlled board-columns editor (the "Task statuses" flow). The PARENT owns the
 * column array + the save (PUT /api/v1/divisions/[id]/columns); this component
 * renders the reorder / rename / recolor / add / remove UI and reports every edit
 * via onChange. Shared by the board-edit dialog (boards/page.tsx) and the board
 * Configuration page so there is a single column editor (no duplication).
 */
export function BoardColumnsEditor({ value, onChange }: { value: EditCol[]; onChange: (cols: EditCol[]) => void }) {
  const t = useTranslations("board")
  const [colorPicker, setColorPicker] = useState<number | null>(null)

  // Polish: close the per-column color popover on Escape.
  useEffect(() => {
    if (colorPicker === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setColorPicker(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [colorPicker])

  const updateCol = (i: number, patch: Partial<EditCol>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const moveCol = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const n = [...value]
    ;[n[i], n[j]] = [n[j], n[i]]
    onChange(n)
  }
  const removeCol = (i: number) => onChange(value.length <= 1 ? value : value.filter((_, idx) => idx !== i))
  const addCol = () => onChange(value.length >= 12 ? value : [...value, { label: "", mapsToStatus: "todo", color: null }])

  return (
    <>
      <div className="mb-1 max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
        {value.map((c, i) => {
          const dotColor = c.color || DEFAULT_STAGE_ACCENT[c.mapsToStatus] || "#C1C7D0"
          return (
            <div key={c.key ?? `new-${i}`} className="flex items-center gap-1.5 rounded-md border bg-background p-1.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => moveCol(i, -1)} disabled={i === 0} aria-label={t("moveUp")} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => moveCol(i, 1)} disabled={i === value.length - 1} aria-label={t("moveDown")} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="relative">
                <button type="button" onClick={() => setColorPicker(colorPicker === i ? null : i)} aria-label={t("autoColor")} className="h-5 w-5 rounded-full border" style={{ background: dotColor }} />
                {colorPicker === i && (
                  <div className="absolute left-0 top-7 z-20 flex w-36 flex-wrap items-center gap-1 rounded-md border bg-popover p-1.5 shadow-lg">
                    <button type="button" onClick={() => { updateCol(i, { color: null }); setColorPicker(null) }} className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">
                      {t("autoColor")}
                    </button>
                    {SWATCHES.map((s) => (
                      <button key={s} type="button" onClick={() => { updateCol(i, { color: s }); setColorPicker(null) }} aria-label={s} className="h-5 w-5 rounded-full border-2" style={{ background: s, borderColor: c.color === s ? "#172B4D" : "transparent" }} />
                    ))}
                  </div>
                )}
              </div>
              <input value={c.label} onChange={(e) => updateCol(i, { label: e.target.value })} maxLength={40} placeholder={t("columnNamePlaceholder")} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/40" />
              <select value={c.mapsToStatus} onChange={(e) => updateCol(i, { mapsToStatus: e.target.value })} title={t("countsAs")} aria-label={t("countsAs")} className="rounded border bg-background px-1 py-1 text-xs outline-none">
                {COLUMN_STAGES.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
              </select>
              <button type="button" onClick={() => removeCol(i)} disabled={value.length <= 1} aria-label={t("removeColumn")} className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" onClick={addCol} disabled={value.length >= 12} className="mb-1 inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> {t("addColumn")}
      </button>
    </>
  )
}
