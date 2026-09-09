"use client"

/**
 * Saved-view chip bar — Roadmap #20.
 *
 * Sits at the top of a list page. Shows the user's saved views as
 * clickable chips, plus a "Save current as…" button that captures the
 * page's current filter state into a new view.
 *
 * The bar is entity-agnostic: the consumer page tells it
 *   - `entityType` so we know which views to fetch
 *   - `currentFilters` — the live filter state to snapshot on save
 *   - `onApply(view)` — called when a chip is clicked
 *
 * The consumer interprets the JSON filters when applying — this component
 * doesn't know what tasks-vs-leads filters mean.
 */

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Star, StarOff, Plus, X, Save, Trash2, Globe, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { SavedViewEntityType } from "@/lib/saved-views/entity-types"

export interface SavedView {
  id: string
  organizationId: string
  userId: string
  entityType: string
  name: string
  filters: Record<string, unknown>
  isDefault: boolean
  isShared: boolean
  sortOrder: number
  createdAt: string
  user?: { id: string; name: string } | null
}

interface Props {
  // Imported from `@/lib/saved-views/entity-types` so adding a new entity
  // is a one-line change in the shared const, not a sync chore between
  // here and the server route.
  entityType: SavedViewEntityType
  /** Current filter state — captured into a new view on Save */
  currentFilters: Record<string, unknown>
  /** Called when the user clicks a view chip. The page applies the filters. */
  onApply: (view: SavedView) => void
  /** Called once on mount with the default view (if any) so the page can auto-apply it. */
  onDefaultLoad?: (view: SavedView) => void
}

export function SavedViewBar({ entityType, currentFilters, onApply, onDefaultLoad }: Props) {
  const { data: session } = useSession()
  const t = useTranslations("savedViews")
  const tc = useTranslations("common")
  const orgId = session?.user?.organizationId
  const currentUserId = session?.user?.id

  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [draft, setDraft] = useState({ name: "", isDefault: false, isShared: false })
  const [saving, setSaving] = useState(false)

  const fetchViews = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/saved-views?entityType=${entityType}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        // "__"-prefixed names are reserved internal views (e.g. __table_default__,
        // the org-wide column default) — never shown as user chips.
        const arr = (json.data as SavedView[]).filter((v) => !v.name.startsWith("__"))
        setViews(arr)
        const def = arr.find((v) => v.isDefault)
        if (def && onDefaultLoad) onDefaultLoad(def)
      }
    } catch (e) {
      console.error("[saved-views] fetch failed", e)
    } finally {
      setLoading(false)
    }
    // onDefaultLoad ref is stable from parent in practice; including it
    // in deps would re-fire the fetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, orgId])

  useEffect(() => { void fetchViews() }, [fetchViews])

  const handleApply = (view: SavedView) => {
    setActiveViewId(view.id)
    onApply(view)
  }

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error(t("nameRequired"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/v1/saved-views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          entityType,
          name: draft.name.trim(),
          filters: currentFilters,
          isDefault: draft.isDefault,
          isShared: draft.isShared,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("error")
        throw new Error(err)
      }
      toast.success(t("savedToast"))
      setSaveOpen(false)
      setDraft({ name: "", isDefault: false, isShared: false })
      void fetchViews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("error"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (view: SavedView, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t("deleteConfirm", { name: view.name }))) return
    try {
      const res = await fetch(`/api/v1/saved-views/${view.id}`, {
        method: "DELETE",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("error")
        throw new Error(err)
      }
      toast.success(t("deletedToast"))
      if (activeViewId === view.id) setActiveViewId(null)
      void fetchViews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("error"))
    }
  }

  const handleSetDefault = async (view: SavedView, e: React.MouseEvent) => {
    e.stopPropagation()
    const newDefault = !view.isDefault
    try {
      const res = await fetch(`/api/v1/saved-views/${view.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ isDefault: newDefault }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("error")
        throw new Error(err)
      }
      void fetchViews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("error"))
    }
  }

  if (loading && views.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {views.map((view) => {
        const isActive = view.id === activeViewId
        const canManage = view.userId === currentUserId
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => handleApply(view)}
            className={cn(
              "group/chip inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-xs transition-colors",
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-zinc-200 dark:border-zinc-700 bg-card hover:bg-muted",
            )}
            title={view.isShared ? t("sharedBy", { name: view.user?.name || "—" }) : undefined}
          >
            {view.isDefault && <Star className="h-3 w-3 fill-amber-400 stroke-amber-500" />}
            {view.isShared && <Globe className="h-3 w-3 text-muted-foreground" />}
            <span className="truncate max-w-[140px]">{view.name}</span>
            {canManage && (
              <span className="flex items-center gap-0.5 -mr-1 opacity-0 group-hover/chip:opacity-100 transition-opacity">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleSetDefault(view, e)}
                  className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  aria-label={view.isDefault ? t("unsetDefault") : t("setDefault")}
                >
                  {view.isDefault
                    ? <StarOff className="h-3 w-3 text-muted-foreground" />
                    : <Star className="h-3 w-3 text-muted-foreground" />}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(view, e)}
                  className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                  aria-label={t("delete")}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                </span>
              </span>
            )}
          </button>
        )
      })}

      {saveOpen ? (
        <div className="inline-flex items-center gap-1.5 h-8 px-2 rounded-full border border-primary bg-card">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={t("namePlaceholder")}
            autoFocus
            disabled={saving}
            className="h-6 w-32 px-1 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave()
              if (e.key === "Escape") setSaveOpen(false)
            }}
          />
          <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
              disabled={saving}
              className="h-3 w-3"
            />
            {t("defaultCheckbox")}
          </label>
          <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isShared}
              onChange={(e) => setDraft((d) => ({ ...d, isShared: e.target.checked }))}
              disabled={saving}
              className="h-3 w-3"
            />
            {t("sharedCheckbox")}
          </label>
          <Button
            size="sm"
            disabled={saving || !draft.name.trim()}
            onClick={handleSave}
            className="h-6 px-2 text-xs gap-0.5"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          </Button>
          <button
            type="button"
            onClick={() => setSaveOpen(false)}
            disabled={saving}
            className="p-0.5 rounded hover:bg-muted"
            aria-label={tc("cancel")}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 text-xs text-muted-foreground hover:bg-muted hover:text-foreground hover:border-zinc-400"
        >
          <Plus className="h-3 w-3" />
          {t("saveCurrent")}
        </button>
      )}
    </div>
  )
}
