"use client"

/**
 * Reusable editor section for a configurable task axis (Task types OR Event types).
 * Encapsulates the org-types hook + CRUD/reorder handlers + the row UI, so the two
 * Bordio Configuration sections share one implementation (no duplication). Writes
 * are server-gated; this is the management UI.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react"
import { useTranslations } from "next-intl"
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import { useConfigTypes, type TaskTypeDTO } from "@/components/tasks/use-task-types"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"

const TYPE_SWATCHES = [
  "#6366f1", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e",
  "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444",
  "#ec4899", "#a855f7", "#8b5cf6", "#64748b", "#6B7280",
]

export function ConfigTypeSection({
  endpoint, title, subtitle, singular, addPlaceholder, icon: Icon, showToast,
}: {
  endpoint: "task-types" | "event-types"
  title: string
  subtitle: string
  singular: string
  addPlaceholder: string
  icon: ComponentType<{ className?: string }>
  showToast: (type: "error" | "success", msg: string) => void
}) {
  const t = useTranslations("boardConfig")
  const { types, loading, refetch } = useConfigTypes(endpoint, false)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<TaskTypeDTO | null>(null)

  const send = useCallback(async (url: string, init: RequestInit): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch(url, { credentials: "include", ...init })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showToast("error", j?.error || t("couldNotSave"))
        return false
      }
      await refetch()
      return true
    } catch {
      showToast("error", t("networkError"))
      return false
    } finally {
      setBusy(false)
    }
  }, [refetch, showToast, t])

  const addType = (displayName: string, color: string) =>
    send(`/api/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, color }),
    })

  const updateType = (id: string, patch: Partial<Pick<TaskTypeDTO, "displayName" | "color" | "isActive">>) =>
    send(`/api/v1/${endpoint}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })

  // Styled confirm (replaces native window.confirm) via ConfirmDialog.
  const confirmDelete = async () => {
    if (pendingDelete) await send(`/api/v1/${endpoint}/${pendingDelete.id}`, { method: "DELETE" })
  }

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= types.length) return
    const reordered = [...types]
    ;[reordered[idx], reordered[j]] = [reordered[j], reordered[idx]]
    send(`/api/v1/${endpoint}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reordered.map((t, i) => ({ id: t.id, sortOrder: i }))),
    })
  }

  return (
    <>
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{subtitle}</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-1.5">
          {types.map((t, i) => (
            <TypeRow
              key={t.id}
              type={t}
              first={i === 0}
              last={i === types.length - 1}
              busy={busy}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onRename={(displayName) => updateType(t.id, { displayName })}
              onRecolor={(color) => updateType(t.id, { color })}
              onToggleActive={() => updateType(t.id, { isActive: !t.isActive })}
              onDelete={() => setPendingDelete(t)}
            />
          ))}
          <AddTypeRow busy={busy} placeholder={addPlaceholder} onAdd={addType} />
        </div>
      )}
    </section>
    <ConfirmDialog
      open={!!pendingDelete}
      onOpenChange={(o) => { if (!o) setPendingDelete(null) }}
      onConfirm={confirmDelete}
      title={t("deleteTitle", { item: singular })}
      itemName={pendingDelete?.displayName}
      confirmVariant="destructive"
    />
    </>
  )
}

// ── A single editable row ────────────────────────────────────────────────────
function TypeRow({
  type, first, last, busy, onMoveUp, onMoveDown, onRename, onRecolor, onToggleActive, onDelete,
}: {
  type: TaskTypeDTO
  first: boolean
  last: boolean
  busy: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: (v: string) => void
  onRecolor: (v: string) => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const t = useTranslations("boardConfig")
  const [name, setName] = useState(type.displayName)
  const [pickOpen, setPickOpen] = useState(false)
  useEffect(() => { setName(type.displayName) }, [type.displayName])

  const synthetic = type.id.startsWith("default-") // fallback rows (org has no real entries yet)

  return (
    <div className={`flex items-center gap-2 rounded-lg border bg-background p-1.5 ${type.isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-col">
        <button type="button" onClick={onMoveUp} disabled={first || busy} aria-label="Move up" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onMoveDown} disabled={last || busy} aria-label="Move down" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => !synthetic && setPickOpen((v) => !v)}
          aria-label="Color"
          className="h-5 w-5 rounded-full border"
          style={{ background: type.color }}
        />
        {pickOpen && (
          <div className="absolute left-0 top-7 z-20 flex w-44 flex-wrap items-center gap-1 rounded-md border bg-popover p-1.5 shadow-lg">
            {TYPE_SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { onRecolor(s); setPickOpen(false) }}
                aria-label={s}
                className="h-5 w-5 rounded-full border-2"
                style={{ background: s, borderColor: type.color.toLowerCase() === s.toLowerCase() ? "#172B4D" : "transparent" }}
              />
            ))}
          </div>
        )}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { const v = name.trim(); if (v && v !== type.displayName && !synthetic) onRename(v); else setName(type.displayName) }}
        disabled={synthetic}
        maxLength={60}
        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
      />
      <span className="hidden w-28 truncate font-mono text-[11px] text-muted-foreground sm:inline" title={type.name}>{type.name}</span>

      <button
        type="button"
        onClick={onToggleActive}
        disabled={busy || synthetic}
        className={`rounded px-2 py-1 text-[11px] font-medium ${type.isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
        title={type.isActive ? t("activeHint") : t("inactiveHint")}
      >
        {type.isActive ? t("active") : t("inactive")}
      </button>

      <button type="button" onClick={onDelete} disabled={busy || synthetic} aria-label="Delete" className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ── Add-new row ──────────────────────────────────────────────────────────────
function AddTypeRow({ busy, placeholder, onAdd }: { busy: boolean; placeholder: string; onAdd: (displayName: string, color: string) => Promise<boolean> }) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(TYPE_SWATCHES[0])
  const [pickOpen, setPickOpen] = useState(false)

  const submit = async () => {
    const v = name.trim()
    if (!v || busy) return
    const ok = await onAdd(v, color)
    if (ok) { setName(""); setColor(TYPE_SWATCHES[0]) }
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed p-1.5">
      <div className="relative">
        <button type="button" onClick={() => setPickOpen((v) => !v)} aria-label="Color" className="h-5 w-5 rounded-full border" style={{ background: color }} />
        {pickOpen && (
          <div className="absolute left-0 top-7 z-20 flex w-44 flex-wrap items-center gap-1 rounded-md border bg-popover p-1.5 shadow-lg">
            {TYPE_SWATCHES.map((s) => (
              <button key={s} type="button" onClick={() => { setColor(s); setPickOpen(false) }} aria-label={s} className="h-5 w-5 rounded-full border-2" style={{ background: s, borderColor: color === s ? "#172B4D" : "transparent" }} />
            ))}
          </div>
        )}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit() }}
        maxLength={60}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/40"
      />
      <Button size="sm" className="h-7 gap-1 text-xs" onClick={submit} disabled={busy || !name.trim()}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
      </Button>
    </div>
  )
}
